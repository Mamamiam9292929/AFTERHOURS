-- P3 Etappe 3a · Offene Beträge der ganzen Crew
-- Die Crew-Seite zeigt, bei welchen Abenden noch Geld offen ist und wie du über alle Abende hinweg
-- stehst. Der Server rechnet die Salden je Plan und Person (dieselbe Regel wie in `src/lib/settle.ts`:
-- jeder Anteil einer anderen Person ist eine Schuld gegenüber der zahlenden Person) und liefert nur
-- Zeilen mit offenem Betrag – so bleibt die Antwort klein, auch wenn eine Crew viele Abende hat.
-- Nur lesen; ausgeglichen wird weiterhin je Plan („Erledigt“ auf der Planseite).

create function public.crew_open_balances(p_crew_id uuid)
returns table (plan_id uuid, user_id uuid, balance_cents integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_user();
  if p_crew_id is null or not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;

  return query
  select e.plan_id, x.user_id, sum(x.cents)::integer
  from public.plan_expenses e
  join public.plans p on p.id = e.plan_id and p.crew_id = p_crew_id
  join public.plan_expense_shares s on s.expense_id = e.id and s.user_id <> e.paid_by and s.amount_cents > 0
  cross join lateral (values (e.paid_by, s.amount_cents), (s.user_id, -s.amount_cents)) as x(user_id, cents)
  group by e.plan_id, x.user_id
  having sum(x.cents) <> 0
  order by e.plan_id, x.user_id;
end $$;

revoke all on function public.crew_open_balances(uuid) from public, anon, authenticated;
grant execute on function public.crew_open_balances(uuid) to authenticated, service_role;
