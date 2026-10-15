-- P3 Etappe 2 · Ungleich aufteilen
-- „Carol hatte nur ein Wasser“: Statt gleichmäßig zu teilen, gibt die eintragende Person für jede
-- beteiligte Person einen eigenen Betrag an. Der Server prüft, dass die Anteile auf den Cent den
-- Betrag ergeben – sonst würde die Abrechnung nicht mehr aufgehen. Gespeichert wird im selben Modell
-- wie bisher (plan_expense_shares), damit Stand, „Wer gibt wem?“ und Rückzahlungen unverändert bleiben.
--
-- Bestehende Funktionen bleiben unverändert; add_plan_expense teilt weiterhin gleichmäßig.

-- p_user_ids und p_amounts gehören paarweise zusammen (gleiche Länge, 1–50 Einträge, jede Person
-- nur einmal, jeder Anteil mindestens 1 Cent). p_amount_cents ist der Gesamtbetrag, den die Person
-- eingegeben hat – stimmt die Summe der Anteile nicht, wird nichts gespeichert.
create function public.add_plan_expense_custom(
  p_plan_id uuid, p_description text, p_amount_cents integer, p_paid_by uuid, p_user_ids uuid[], p_amounts integer[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_description text := app_private.clean_line(p_description, 80);
  v_payer uuid := coalesce(p_paid_by, v_uid);
  v_count integer := coalesce(cardinality(p_user_ids), 0);
  v_id uuid;
  v_share record;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_description is null or char_length(v_description) < 2 then
    perform app_private.fail('invalid_expense_description');
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 1000000 then
    perform app_private.fail('invalid_expense_amount');
  end if;

  -- Form der Eingabe: gleich lange Listen, 1–50 Personen, keine leeren oder doppelten Einträge.
  if v_count = 0 or v_count > 50 or v_count <> coalesce(cardinality(p_amounts), -1)
     or array_ndims(p_user_ids) <> 1 or array_ndims(p_amounts) <> 1
     or exists (select 1 from unnest(p_user_ids) as s(u) where u is null)
     or (select count(distinct u) from unnest(p_user_ids) as s(u)) <> v_count then
    perform app_private.fail('invalid_expense_split');
  end if;
  if not app_private.is_member_of(v_plan.crew_id, v_payer)
     or exists (select 1 from unnest(p_user_ids) as s(u) where not app_private.is_member_of(v_plan.crew_id, u)) then
    perform app_private.fail('invalid_expense_split');
  end if;
  if exists (select 1 from unnest(p_amounts) as a(c) where c is null or c < 1 or c > p_amount_cents) then
    perform app_private.fail('invalid_expense_share');
  end if;
  if (select sum(c::bigint) from unnest(p_amounts) as a(c)) <> p_amount_cents then
    perform app_private.fail('expense_shares_mismatch');
  end if;
  if (select count(*) from public.plan_expenses e where e.plan_id = p_plan_id) >= 200 then
    perform app_private.fail('expense_limit');
  end if;
  perform app_private.rate_limit('plan_expense', 60, interval '1 hour');

  insert into public.plan_expenses (plan_id, kind, description, amount_cents, paid_by, created_by)
  values (p_plan_id, 'expense', v_description, p_amount_cents, v_payer, v_uid)
  returning id into v_id;

  insert into public.plan_expense_shares (expense_id, plan_id, user_id, amount_cents)
  select v_id, p_plan_id, s.u, s.c
  from unnest(p_user_ids, p_amounts) as s(u, c);

  -- Benachrichtigungen wie bei add_plan_expense: Beteiligte erfahren ihren eigenen Anteil (nicht die
  -- der anderen), die zahlende Person erfährt, dass sie eingetragen wurde.
  for v_share in
    select sh.user_id, sh.amount_cents from public.plan_expense_shares sh
    where sh.expense_id = v_id and sh.user_id <> v_uid and sh.user_id <> v_payer
    union all
    select v_payer, null::integer where v_payer <> v_uid
  loop
    perform app_private.notify(v_share.user_id, 'plan_expense', v_uid, v_plan.crew_id, 'plan', v_plan.id,
      jsonb_build_object('title', v_plan.title, 'description', v_description, 'amount_cents', p_amount_cents,
                         'share_cents', v_share.amount_cents, 'you_paid', v_share.user_id = v_payer));
  end loop;
  return v_id;
end $$;

revoke all on function public.add_plan_expense_custom(uuid, text, integer, uuid, uuid[], integer[]) from public, anon, authenticated;
grant execute on function public.add_plan_expense_custom(uuid, text, integer, uuid, uuid[], integer[]) to authenticated, service_role;
