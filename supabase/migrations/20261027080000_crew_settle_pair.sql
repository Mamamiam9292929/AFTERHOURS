-- P3 Etappe 3c · Alles auf einmal ausgleichen
-- Wer bei mehreren Abenden derselben Crew mit derselben Person Geld offen hat, gibt es in einer
-- Überweisung zurück und tippt nur einmal „Erledigt“. Der Server rechnet dafür je Abend „Wer gibt wem?“
-- genau wie die App (`settleBalances` in `src/lib/settle.ts`: wer am meisten schuldet, zahlt an die
-- Person, die am meisten bekommt; bei gleichen Beträgen entscheidet die ID) und trägt bei jedem Abend,
-- an dem eine Überweisung zwischen den beiden steht, die Rückzahlung ein – im bestehenden Modell
-- (kind = 'settlement'), sodass jeder Abend für sich ausgeglichen ist.
--
-- Beträge kommen nie vom Gerät: Die App schickt nur, was sie als Summe angezeigt hat
-- (`p_expected_cents`, aus Sicht der aufrufenden Person: positiv = bekommt, negativ = gibt). Weicht
-- die Rechnung des Servers davon ab (inzwischen kam eine Ausgabe dazu), wird nichts eingetragen.
-- Gegenseitige Beträge werden verrechnet (bei Abend A gibst du 10 €, bei Abend B bekommst du 4 € →
-- eine Überweisung über 6 €); gehen sie genau auf, seid ihr quitt, ohne dass Geld fließt.

create function public.settle_crew_balances_with(p_crew_id uuid, p_other uuid, p_expected_cents integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_crew_name text;
  v_plan record;
  v_cred_ids uuid[];
  v_cred_amt integer[];
  v_deb_ids uuid[];
  v_deb_amt integer[];
  i integer;
  j integer;
  v_cents integer;
  v_from uuid[] := '{}';
  v_to uuid[] := '{}';
  v_plans uuid[] := '{}';
  v_amounts integer[] := '{}';
  v_net integer := 0;
  v_count integer;
  v_id uuid;
  k integer;
begin
  if p_crew_id is null or not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;
  if p_other is null or p_other = v_uid or not app_private.is_member_of(p_crew_id, p_other) then
    perform app_private.fail('invalid_settlement');
  end if;
  if p_expected_cents is null or p_expected_cents not between -100000000 and 100000000 then
    perform app_private.fail('invalid_settlement');
  end if;
  perform app_private.rate_limit('plan_expense', 60, interval '1 hour');

  -- Zwei gleichzeitige Tipps (beide Seiten oder zwei Geräte) tragen nicht doppelt ein.
  perform pg_advisory_xact_lock(hashtextextended(
    'crew_settle:' || p_crew_id::text || ':' || least(v_uid, p_other)::text || ':' || greatest(v_uid, p_other)::text, 0));

  select c.name into v_crew_name from public.crews c where c.id = p_crew_id;

  -- Nur Abende, bei denen beide etwas offen haben; Salden wie in crew_open_balances.
  for v_plan in
    with bal as (
      select e.plan_id, x.user_id, sum(x.cents)::integer as cents
      from public.plan_expenses e
      join public.plans p on p.id = e.plan_id and p.crew_id = p_crew_id
      join public.plan_expense_shares s on s.expense_id = e.id and s.user_id <> e.paid_by and s.amount_cents > 0
      cross join lateral (values (e.paid_by, s.amount_cents), (s.user_id, -s.amount_cents)) as x(user_id, cents)
      group by e.plan_id, x.user_id
      having sum(x.cents) <> 0
    )
    select b.plan_id from bal b
    where b.user_id in (v_uid, p_other)
    group by b.plan_id
    having count(*) = 2
    order by b.plan_id
  loop
    -- Gläubiger und Schuldner sortiert wie in der App: höchster Betrag zuerst, dann ID aufsteigend.
    with bal as (
      select x.user_id, sum(x.cents)::integer as cents
      from public.plan_expenses e
      join public.plan_expense_shares s on s.expense_id = e.id and s.user_id <> e.paid_by and s.amount_cents > 0
      cross join lateral (values (e.paid_by, s.amount_cents), (s.user_id, -s.amount_cents)) as x(user_id, cents)
      where e.plan_id = v_plan.plan_id
      group by x.user_id
      having sum(x.cents) <> 0
    )
    select
      array_agg(b.user_id order by b.cents desc, b.user_id::text collate "C") filter (where b.cents > 0),
      array_agg(b.cents order by b.cents desc, b.user_id::text collate "C") filter (where b.cents > 0),
      array_agg(b.user_id order by -b.cents desc, b.user_id::text collate "C") filter (where b.cents < 0),
      array_agg(-b.cents order by -b.cents desc, b.user_id::text collate "C") filter (where b.cents < 0)
    into v_cred_ids, v_cred_amt, v_deb_ids, v_deb_amt
    from bal b;

    i := 1;
    j := 1;
    while i <= coalesce(cardinality(v_cred_ids), 0) and j <= coalesce(cardinality(v_deb_ids), 0) loop
      v_cents := least(v_cred_amt[i], v_deb_amt[j]);
      if (v_deb_ids[j] = v_uid and v_cred_ids[i] = p_other) or (v_deb_ids[j] = p_other and v_cred_ids[i] = v_uid) then
        v_plans := v_plans || v_plan.plan_id;
        v_from := v_from || v_deb_ids[j];
        v_to := v_to || v_cred_ids[i];
        v_amounts := v_amounts || v_cents;
        v_net := v_net + case when v_cred_ids[i] = v_uid then v_cents else -v_cents end;
      end if;
      v_cred_amt[i] := v_cred_amt[i] - v_cents;
      v_deb_amt[j] := v_deb_amt[j] - v_cents;
      if v_cred_amt[i] = 0 then i := i + 1; end if;
      if v_deb_amt[j] = 0 then j := j + 1; end if;
    end loop;
  end loop;

  v_count := coalesce(cardinality(v_plans), 0);
  if v_count = 0 then
    perform app_private.fail('nothing_to_settle');
  end if;
  if v_net <> p_expected_cents then
    perform app_private.fail('settlement_changed');
  end if;
  if exists (
    select 1 from unnest(v_plans) as u(plan_id)
    where (select count(*) from public.plan_expenses e where e.plan_id = u.plan_id) >= 200
  ) then
    perform app_private.fail('expense_limit');
  end if;

  for k in 1 .. v_count loop
    insert into public.plan_expenses (plan_id, kind, description, amount_cents, paid_by, created_by)
    values (v_plans[k], 'settlement', null, v_amounts[k], v_from[k], v_uid)
    returning id into v_id;
    insert into public.plan_expense_shares (expense_id, plan_id, user_id, amount_cents)
    values (v_id, v_plans[k], v_to[k], v_amounts[k]);
  end loop;

  -- Eine Nachricht an die andere Person statt einer je Abend.
  perform app_private.notify(p_other, 'plan_settlement', v_uid, p_crew_id, 'crew', p_crew_id,
    jsonb_build_object('bundle', true, 'crew_name', v_crew_name, 'amount_cents', abs(v_net), 'plan_count', v_count,
                       'direction', case when v_net < 0 then 'paid_you' when v_net > 0 then 'received' else 'offset' end));

  return jsonb_build_object('plans', v_count, 'net_cents', v_net);
end $$;

revoke all on function public.settle_crew_balances_with(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.settle_crew_balances_with(uuid, uuid, integer) to authenticated, service_role;
