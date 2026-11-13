-- P50 · „Danach noch wohin?“ – Stationen am Abend
-- Ein Abend hat oft mehr als einen Ort: erst Essen um 19 Uhr, dann um 22 Uhr in die Bar, danach noch tanzen. Bisher
-- stand auf der Planseite nur der erste Ort – der Rest lief im Gruppenchat („wo gehen wir danach hin?“), und wer
-- später dazukommt, fragt dort nach. Jetzt hängt, wer organisiert (oder Owner/Admin ist), bis zu vier weitere
-- Stationen an den Plan: Name, auf Wunsch Uhrzeit und Adresse. Die Crew sieht sie unter „Wo“ in der richtigen
-- Reihenfolge, mit Route in die Karten-App.
--
-- Bewusst so gebaut:
--   * Stationen gehören zum Plan wie Titel, Adresse und Treffpunkt: Schreiben darf, wer den Plan bearbeiten darf
--     (`can_manage_plan`), lesen die Crew über RLS. Es wird keine Person gespeichert – deshalb nichts im
--     Datenexport, und eine Kontolöschung ändert nichts.
--   * Uhrzeit optional; wenn, dann nach dem Beginn und höchstens 18 Stunden danach (ein Abend, keine zweite
--     Verabredung). Ohne Uhrzeit steht die Station nach denen mit Uhrzeit, in der Reihenfolge des Eintragens.
--   * Wird der Plan verschoben, wandern die Uhrzeiten mit (gleicher Abstand zum Beginn) – sonst stünde „22:30 Bar“
--     plötzlich vor dem Essen.
--   * Auch noch am Abend selbst änderbar („wir ziehen weiter“); gesperrt erst, wenn der Plan abgeschlossen oder
--     abgesagt ist. Höchstens vier Stationen je Plan.
--   * Offen (Etappe 2): Bescheid an alle mit Zusage, wenn am Abend eine Station dazukommt; Stationen auf der
--     geteilten Karte (`/s/<token>`), im Kalender-Eintrag und in der nächsten Runde einer Serie (P8).

create table public.plan_stops (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 60),
  at timestamptz,
  address text check (address is null or char_length(address) <= 200),
  created_at timestamptz not null default now()
);
create index plan_stops_plan_idx on public.plan_stops (plan_id, at, created_at);

comment on table public.plan_stops is 'P50: „Danach noch wohin?“ – weitere Stationen eines Abends (höchstens 4 je Plan).';

alter table public.plan_stops enable row level security;
revoke all on table public.plan_stops from public, anon, authenticated;
grant select on table public.plan_stops to authenticated;

create policy plan_stops_select_member on public.plan_stops for select to authenticated
  using (app_private.can_access_plan(plan_id));

-- Neue Station erscheint bei der Crew ohne Neuladen (RLS gilt auch für Realtime).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.plan_stops;
  end if;
end $$;

-- Plan holen und prüfen: bearbeiten dürfen, weder abgeschlossen noch abgesagt.
create function app_private.plan_for_stops(p_plan_id uuid) returns public.plans
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  return v_plan;
end $$;

-- Station anhängen. Liefert die ID.
create function public.add_plan_stop(p_plan_id uuid, p_title text, p_at timestamptz default null, p_address text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_title text := app_private.clean_line(p_title, 60);
  v_address text := app_private.clean_line(p_address, 200);
  v_id uuid;
begin
  v_plan := app_private.plan_for_stops(p_plan_id);
  if v_title is null or char_length(v_title) < 2 then
    perform app_private.fail('invalid_plan_stop');
  end if;
  if p_at is not null and (p_at <= v_plan.starts_at or p_at > v_plan.starts_at + interval '18 hours') then
    perform app_private.fail('plan_stop_time');
  end if;
  -- Gleichzeitiges Anhängen zählt sauber gegen die Grenze.
  perform 1 from public.plans p where p.id = p_plan_id for update;
  if (select count(*) from public.plan_stops s where s.plan_id = p_plan_id) >= 4 then
    perform app_private.fail('plan_stop_limit');
  end if;
  perform app_private.rate_limit('plan_stop', 30, interval '1 hour');

  insert into public.plan_stops (plan_id, title, at, address)
  values (p_plan_id, v_title, p_at, v_address)
  returning id into v_id;
  return v_id;
end $$;

-- Station wieder herausnehmen.
create function public.remove_plan_stop(p_stop_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan_id uuid;
begin
  select s.plan_id into v_plan_id from public.plan_stops s where s.id = p_stop_id;
  if not found then
    perform app_private.forbid();
  end if;
  perform app_private.plan_for_stops(v_plan_id);
  perform app_private.rate_limit('plan_stop_remove', 60, interval '1 hour');
  delete from public.plan_stops s where s.id = p_stop_id;
end $$;

-- Plan verschoben: Stationen wandern mit (gleicher Abstand zum Beginn).
create function app_private.plan_stops_follow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at then
    update public.plan_stops s set at = s.at + (new.starts_at - old.starts_at)
    where s.plan_id = new.id and s.at is not null;
  end if;
  return null;
end $$;

create trigger plans_stops_follow
  after update of starts_at on public.plans
  for each row execute function app_private.plan_stops_follow();

revoke all on function app_private.plan_for_stops(uuid) from public, anon, authenticated;
revoke all on function app_private.plan_stops_follow() from public, anon, authenticated;
revoke all on function public.add_plan_stop(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.remove_plan_stop(uuid) from public, anon, authenticated;
grant execute on function public.add_plan_stop(uuid, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.remove_plan_stop(uuid) to authenticated, service_role;

comment on function public.add_plan_stop(uuid, text, timestamptz, text) is 'P50: weitere Station des Abends anhängen (Organisator:in, Owner, Admins; höchstens 4; Uhrzeit nach Beginn, höchstens 18 h danach).';
comment on function public.remove_plan_stop(uuid) is 'P50: Station wieder herausnehmen (Organisator:in, Owner, Admins).';
