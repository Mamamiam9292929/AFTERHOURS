-- AFTERHOURS · 2/5 · Zugriffskontrolle: Hilfsfunktionen, Row Level Security, Rechte
--
-- Grundsätze
--   1. Ohne Anmeldung ist nichts lesbar (anon erhält keinerlei Rechte).
--   2. Lesen läuft über RLS-Policies, Schreiben fast ausschließlich über geprüfte RPC-Funktionen
--      (20261011100200_api.sql). Direkte Schreibrechte gibt es nur dort, wo eine Policy genügt.
--   3. Alle SECURITY-DEFINER-Funktionen laufen mit leerem search_path und voll qualifizierten Namen.

-- ---------------------------------------------------------------------------------------------
-- Hilfsfunktionen für Policies (app_private ist nicht über die API erreichbar)
-- ---------------------------------------------------------------------------------------------
create function app_private.is_crew_member(p_crew_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crew_members m
    where m.crew_id = p_crew_id and m.user_id = (select auth.uid())
  );
$$;

create function app_private.has_crew_role(p_crew_id uuid, p_roles public.crew_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crew_members m
    where m.crew_id = p_crew_id and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

create function app_private.shares_crew_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.crew_members mine
    join public.crew_members theirs on theirs.crew_id = mine.crew_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

create function app_private.can_access_poll(p_poll_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.polls p
    join public.crew_members m on m.crew_id = p.crew_id
    where p.id = p_poll_id and m.user_id = (select auth.uid())
  );
$$;

create function app_private.can_access_plan(p_plan_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans p
    join public.crew_members m on m.crew_id = p.crew_id
    where p.id = p_plan_id and m.user_id = (select auth.uid())
  );
$$;

create function app_private.can_access_ride_offer(p_offer_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ride_offers o
    join public.plans p on p.id = o.plan_id
    join public.crew_members m on m.crew_id = p.crew_id
    where o.id = p_offer_id and m.user_id = (select auth.uid())
  );
$$;

create function app_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.app_admins enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.crew_invitations enable row level security;
alter table public.crew_messages enable row level security;
alter table public.activities enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.plans enable row level security;
alter table public.plan_participants enable row level security;
alter table public.booking_requests enable row level security;
alter table public.ride_offers enable row level security;
alter table public.ride_requests enable row level security;
alter table public.reward_transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limit_hits enable row level security;
alter table public.reports enable row level security;

-- Profile: man selbst und Personen, mit denen man mindestens eine Crew teilt.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app_private.shares_crew_with(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Private Einstellungen: ausschließlich man selbst. Eine Crew für die Standortfreigabe muss die eigene sein.
create policy user_settings_select_own on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_update_own on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (location_sharing_crew_id is null or app_private.is_crew_member(location_sharing_crew_id))
  );

-- Crews und Mitgliedschaften: nur Mitglieder.
create policy crews_select_member on public.crews for select to authenticated
  using (app_private.is_crew_member(id));
create policy crews_update_admin on public.crews for update to authenticated
  using (app_private.has_crew_role(id, array['owner', 'admin']::public.crew_role[]))
  with check (app_private.has_crew_role(id, array['owner', 'admin']::public.crew_role[]));
create policy crews_delete_owner on public.crews for delete to authenticated
  using (app_private.has_crew_role(id, array['owner']::public.crew_role[]));

create policy crew_members_select_member on public.crew_members for select to authenticated
  using (app_private.is_crew_member(crew_id));

-- Einladungen sehen nur Owner und Admins (der Token-Hash ist zusätzlich per Spaltenrecht gesperrt).
create policy crew_invitations_select_admin on public.crew_invitations for select to authenticated
  using (app_private.has_crew_role(crew_id, array['owner', 'admin']::public.crew_role[]));

create policy crew_messages_select_member on public.crew_messages for select to authenticated
  using (app_private.is_crew_member(crew_id));
create policy crew_messages_delete on public.crew_messages for delete to authenticated
  using (
    (user_id = (select auth.uid()) and app_private.is_crew_member(crew_id))
    or app_private.has_crew_role(crew_id, array['owner', 'admin']::public.crew_role[])
  );

-- Aktivitäten: für alle angemeldeten Nutzer lesbar, Pflege nur durch Administratoren.
create policy activities_select on public.activities for select to authenticated
  using (is_active or app_private.is_admin());
create policy activities_insert_admin on public.activities for insert to authenticated
  with check (app_private.is_admin());
create policy activities_update_admin on public.activities for update to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());
create policy activities_delete_admin on public.activities for delete to authenticated
  using (app_private.is_admin());

-- Abstimmungen, Optionen, Stimmen: nur Crew-Mitglieder; geschrieben wird ausschließlich per RPC.
create policy polls_select_member on public.polls for select to authenticated
  using (app_private.is_crew_member(crew_id));
create policy poll_options_select_member on public.poll_options for select to authenticated
  using (app_private.can_access_poll(poll_id));
create policy poll_votes_select_member on public.poll_votes for select to authenticated
  using (app_private.can_access_poll(poll_id));

-- Pläne, Teilnahmen, Reservierungen: nur Crew-Mitglieder; geschrieben wird ausschließlich per RPC.
create policy plans_select_member on public.plans for select to authenticated
  using (app_private.is_crew_member(crew_id));
create policy plan_participants_select_member on public.plan_participants for select to authenticated
  using (app_private.can_access_plan(plan_id));
create policy booking_requests_select_member on public.booking_requests for select to authenticated
  using (app_private.can_access_plan(plan_id));

create policy ride_offers_select_member on public.ride_offers for select to authenticated
  using (app_private.can_access_plan(plan_id));
create policy ride_requests_select_member on public.ride_requests for select to authenticated
  using (app_private.can_access_ride_offer(ride_offer_id));

-- Eigene Punkte und Benachrichtigungen.
create policy reward_transactions_select_own on public.reward_transactions for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Meldungen: eigene lesen; Administratoren lesen und bearbeiten alle.
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or app_private.is_admin());
create policy reports_update_admin on public.reports for update to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());

create policy audit_log_select_admin on public.audit_log for select to authenticated
  using (app_private.is_admin());

-- app_admins und rate_limit_hits haben bewusst keine Policy: kein Zugriff über die API.

-- ---------------------------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------------------------
-- Supabase vergibt für neue Tabellen in "public" standardmäßig alle Rechte an anon/authenticated.
-- Das wird hier vollständig zurückgenommen und durch die kleinstmögliche Menge ersetzt.
revoke all on
  public.profiles, public.user_settings, public.app_admins, public.crews, public.crew_members,
  public.crew_invitations, public.crew_messages, public.activities, public.polls, public.poll_options,
  public.poll_votes, public.plans, public.plan_participants, public.booking_requests, public.ride_offers,
  public.ride_requests, public.reward_transactions, public.notifications, public.audit_log,
  public.rate_limit_hits, public.reports
from public, anon, authenticated;

grant usage on schema app_private to authenticated;
grant execute on function
  app_private.is_crew_member(uuid), app_private.has_crew_role(uuid, public.crew_role[]),
  app_private.shares_crew_with(uuid), app_private.can_access_poll(uuid), app_private.can_access_plan(uuid),
  app_private.can_access_ride_offer(uuid), app_private.is_admin()
to authenticated;
revoke execute on function
  app_private.is_crew_member(uuid), app_private.has_crew_role(uuid, public.crew_role[]),
  app_private.shares_crew_with(uuid), app_private.can_access_poll(uuid), app_private.can_access_plan(uuid),
  app_private.can_access_ride_offer(uuid), app_private.is_admin()
from public;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, city, interests, favorite_categories, onboarded_at) on public.profiles to authenticated;

grant select on public.user_settings to authenticated;
grant update (location_sharing_mode, location_sharing_crew_id, typical_budget_cents, preferred_distance_km,
              notification_preferences, privacy_preferences) on public.user_settings to authenticated;

grant select, delete on public.crews to authenticated;
grant update (name, emoji) on public.crews to authenticated;
grant select on public.crew_members to authenticated;
grant select (id, crew_id, invited_by, expires_at, revoked_at, max_uses, use_count, created_at)
  on public.crew_invitations to authenticated;
grant select, delete on public.crew_messages to authenticated;

grant select, insert, update, delete on public.activities to authenticated;

grant select on public.polls, public.poll_options, public.poll_votes to authenticated;
grant select on public.plans, public.plan_participants, public.booking_requests to authenticated;
grant select on public.ride_offers, public.ride_requests to authenticated;
grant select on public.reward_transactions to authenticated;
grant select, delete on public.notifications to authenticated;
grant select on public.reports, public.audit_log to authenticated;
grant update (status, resolved_by, resolved_at) on public.reports to authenticated;

-- Server-seitige Dienste (service_role) behalten vollen Zugriff, z. B. für Edge Functions und Cron-Jobs.
grant all on all tables in schema public to service_role;
grant usage on schema app_private to service_role;

-- ---------------------------------------------------------------------------------------------
-- Realtime (nur, wenn die Publication existiert – auf Supabase ist das der Fall)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.poll_votes, public.polls, public.plans, public.plan_participants,
      public.notifications, public.crew_messages, public.crew_members;
  end if;
end $$;
