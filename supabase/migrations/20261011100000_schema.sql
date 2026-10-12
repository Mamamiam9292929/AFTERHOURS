-- AFTERHOURS · 1/5 · Tabellen, Typen, Constraints, Indizes
-- Geldbeträge sind Cent-Integer (EUR). Zeitpunkte sind timestamptz (UTC); Anzeige in Europe/Berlin.
-- Zugriff wird in 20261011100100_security.sql geregelt – diese Datei vergibt keinerlei Rechte.

create schema if not exists app_private;

-- ---------------------------------------------------------------------------------------------
-- Typen
-- ---------------------------------------------------------------------------------------------
create type public.crew_role as enum ('owner', 'admin', 'member');
create type public.location_sharing_mode as enum ('off', 'during_activity', 'selected_friends', 'crew');
create type public.activity_category as enum (
  'restaurant', 'cafe', 'bar', 'cinema', 'bowling', 'minigolf', 'swimming', 'lasertag',
  'escape_room', 'karting', 'sport', 'outdoor', 'concert', 'event', 'trip', 'other'
);
create type public.activity_source as enum ('demo', 'provider', 'partner', 'manual');
create type public.activity_setting as enum ('indoor', 'outdoor', 'both');
create type public.poll_status as enum ('open', 'closed');
create type public.vote_response as enum ('yes', 'maybe', 'no');
create type public.plan_status as enum ('proposed', 'confirmed', 'booking_pending', 'booked', 'completed', 'cancelled');
create type public.attendance_status as enum ('invited', 'going', 'maybe', 'declined');
create type public.booking_status as enum (
  'not_started', 'in_progress', 'awaiting_response', 'confirmed', 'unavailable', 'failed', 'cancelled_by_user'
);
create type public.ride_offer_status as enum ('open', 'cancelled', 'completed');
create type public.ride_request_status as enum ('requested', 'accepted', 'declined', 'cancelled');
create type public.report_status as enum ('open', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------------------------------
-- Nutzer
-- ---------------------------------------------------------------------------------------------
-- "users" aus dem Konzept: Die Zugangsdaten liegen in auth.users (Supabase Auth). profiles enthält
-- ausschließlich das, was Crew-Mitglieder voneinander sehen dürfen.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  avatar_url text check (
    avatar_url is null
    or (char_length(avatar_url) <= 60000 and avatar_url ~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$')
    or (char_length(avatar_url) <= 500 and avatar_url ~ '^https://')
  ),
  city text check (city is null or char_length(city) between 1 and 80),
  interests text[] not null default '{}' check (
    cardinality(interests) <= 10
    and interests <@ array['food', 'sport', 'cinema', 'outdoor', 'nightlife', 'music', 'gaming', 'adventure', 'culture', 'relax']::text[]
  ),
  favorite_categories public.activity_category[] not null default '{}' check (cardinality(favorite_categories) <= 16),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Private Einstellungen: nur für die Person selbst lesbar.
create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  location_sharing_mode public.location_sharing_mode not null default 'off',
  location_sharing_crew_id uuid,
  typical_budget_cents integer check (typical_budget_cents is null or typical_budget_cents between 0 and 100000),
  preferred_distance_km integer check (preferred_distance_km is null or preferred_distance_km between 1 and 200),
  notification_preferences jsonb not null default '{}'::jsonb check (
    jsonb_typeof(notification_preferences) = 'object' and char_length(notification_preferences::text) < 4000
  ),
  privacy_preferences jsonb not null default '{}'::jsonb check (
    jsonb_typeof(privacy_preferences) = 'object' and char_length(privacy_preferences::text) < 4000
  ),
  updated_at timestamptz not null default now()
);

-- Administratorrolle: bewusst eine eigene Tabelle ohne jeden API-Zugriff (nicht im Profil, nicht im JWT änderbar).
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text
);

-- ---------------------------------------------------------------------------------------------
-- Crews
-- ---------------------------------------------------------------------------------------------
create table public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  emoji text not null default '🌙' check (char_length(emoji) between 1 and 16),
  image_url text check (image_url is null or (char_length(image_url) <= 500 and image_url ~ '^https://')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings
  add constraint user_settings_location_crew_fkey
  foreign key (location_sharing_crew_id) references public.crews (id) on delete set null;

create table public.crew_members (
  crew_id uuid not null references public.crews (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.crew_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index crew_members_user_idx on public.crew_members (user_id);
-- Genau ein Owner pro Crew.
create unique index crew_members_one_owner_idx on public.crew_members (crew_id) where role = 'owner';

-- Einladungslinks: gespeichert wird nur der SHA-256-Hash des Tokens. Links laufen ab, haben ein
-- Nutzungslimit und sind widerrufbar.
create table public.crew_invitations (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses integer not null default 20 check (max_uses between 1 and 50),
  use_count integer not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now(),
  check (use_count <= max_uses)
);
create index crew_invitations_crew_idx on public.crew_invitations (crew_id);

create table public.crew_messages (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index crew_messages_crew_created_idx on public.crew_messages (crew_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Aktivitäten (Orte und Angebote)
-- ---------------------------------------------------------------------------------------------
-- data_source hält fest, woher ein Datensatz stammt. Demo-Daten sind über is_demo jederzeit
-- von echten Anbieterdaten unterscheidbar und werden in der Oberfläche gekennzeichnet.
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null default 'demo' check (char_length(provider_id) between 1 and 40),
  external_id text check (external_id is null or char_length(external_id) <= 200),
  name text not null check (char_length(name) between 2 and 120),
  category public.activity_category not null,
  description text check (description is null or char_length(description) <= 2000),
  address text check (address is null or char_length(address) <= 200),
  city text check (city is null or char_length(city) <= 80),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  price_min_cents integer check (price_min_cents is null or price_min_cents >= 0),
  price_max_cents integer check (price_max_cents is null or price_max_cents >= 0),
  currency char(3) not null default 'EUR',
  opening_hours jsonb check (opening_hours is null or jsonb_typeof(opening_hours) = 'object'),
  booking_url text check (booking_url is null or booking_url ~ '^https://'),
  website_url text check (website_url is null or website_url ~ '^https://'),
  phone text check (phone is null or char_length(phone) <= 40),
  image_url text check (image_url is null or image_url ~ '^https://'),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 10 and 1440),
  setting public.activity_setting,
  min_age integer check (min_age is null or min_age between 0 and 21),
  group_min integer check (group_min is null or group_min >= 1),
  group_max integer check (group_max is null or group_max >= 1),
  rating numeric(2, 1) check (rating is null or rating between 0 and 5),
  rating_count integer check (rating_count is null or rating_count >= 0),
  rating_source text check (rating_source is null or char_length(rating_source) <= 80),
  data_source public.activity_source not null,
  is_demo boolean generated always as (data_source = 'demo') stored,
  is_active boolean not null default true,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, external_id),
  check (price_min_cents is null or price_max_cents is null or price_min_cents <= price_max_cents),
  check (group_min is null or group_max is null or group_min <= group_max),
  -- Eine Bewertung ohne Quelle wird nicht gespeichert.
  check (rating is null or rating_source is not null)
);
create index activities_category_idx on public.activities (category) where is_active;
create index activities_city_idx on public.activities (lower(city)) where is_active;

-- ---------------------------------------------------------------------------------------------
-- Abstimmungen
-- ---------------------------------------------------------------------------------------------
create table public.polls (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  parent_poll_id uuid references public.polls (id) on delete set null,
  title text not null check (char_length(title) between 3 and 80),
  description text check (description is null or char_length(description) <= 500),
  meeting_point text check (meeting_point is null or char_length(meeting_point) <= 160),
  budget_cents integer check (budget_cents is null or budget_cents between 0 and 1000000),
  min_participants integer check (min_participants is null or min_participants between 1 and 50),
  ends_at timestamptz not null,
  status public.poll_status not null default 'open',
  winning_option_id uuid,
  is_tie boolean not null default false,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'closed') = (closed_at is not null))
);
create index polls_crew_status_idx on public.polls (crew_id, status, ends_at);
create index polls_due_idx on public.polls (ends_at) where status = 'open';

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  activity_id uuid references public.activities (id) on delete set null,
  -- Titel wird immer mitgespeichert: eigene Vorschläge haben keine activity_id, und ein Ort kann später entfallen.
  title text not null check (char_length(title) between 1 and 120),
  proposed_date date,
  proposed_time time,
  estimated_price_cents integer check (estimated_price_cents is null or estimated_price_cents between 0 and 1000000),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index poll_options_poll_idx on public.poll_options (poll_id, position);

alter table public.polls
  add constraint polls_winning_option_fkey
  foreign key (winning_option_id) references public.poll_options (id) on delete set null;

create table public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  poll_option_id uuid not null references public.poll_options (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  response public.vote_response not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Eine Stimme pro Person und Option: doppelte Stimmen sind auf Datenbankebene ausgeschlossen.
  unique (poll_option_id, user_id)
);
create index poll_votes_poll_idx on public.poll_votes (poll_id);
create index poll_votes_user_idx on public.poll_votes (user_id);

-- ---------------------------------------------------------------------------------------------
-- Pläne
-- ---------------------------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  poll_id uuid unique references public.polls (id) on delete set null,
  activity_id uuid references public.activities (id) on delete set null,
  title text not null check (char_length(title) between 2 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz,
  address text check (address is null or char_length(address) <= 200),
  meeting_point text check (meeting_point is null or char_length(meeting_point) <= 160),
  notes text check (notes is null or char_length(notes) <= 2000),
  estimated_cost_per_person_cents integer check (estimated_cost_per_person_cents is null or estimated_cost_per_person_cents between 0 and 1000000),
  estimated_total_cost_cents integer check (estimated_total_cost_cents is null or estimated_total_cost_cents between 0 and 10000000),
  currency char(3) not null default 'EUR',
  status public.plan_status not null default 'proposed',
  booking_status public.booking_status not null default 'not_started',
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index plans_crew_starts_idx on public.plans (crew_id, starts_at);

create table public.plan_participants (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  attendance_status public.attendance_status not null default 'invited',
  responded_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index plan_participants_user_idx on public.plan_participants (user_id);

-- Reservierungen: Im MVP dokumentiert die Organisatorin/der Organisator den Vorgang selbst
-- (channel = 'manual'). 'online' und 'phone_agent' sind für spätere Integrationen reserviert.
create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  activity_id uuid references public.activities (id) on delete set null,
  provider_id text,
  channel text not null default 'manual' check (channel in ('manual', 'online', 'phone_agent')),
  is_test boolean not null default false,
  requested_date date not null,
  requested_time time not null,
  party_size integer not null check (party_size between 1 and 100),
  special_requests text check (special_requests is null or char_length(special_requests) <= 500),
  status public.booking_status not null default 'not_started',
  provider_confirmation_reference text check (provider_confirmation_reference is null or char_length(provider_confirmation_reference) <= 120),
  -- Zeitpunkt der ausdrücklichen Freigabe durch den Nutzer. Ohne ihn verlässt eine Anfrage 'not_started' nicht.
  confirmed_by_user_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index booking_requests_plan_idx on public.booking_requests (plan_id, created_at desc);
-- Höchstens eine laufende Anfrage pro Plan.
create unique index booking_requests_one_active_idx on public.booking_requests (plan_id)
  where status in ('not_started', 'in_progress', 'awaiting_response');

-- ---------------------------------------------------------------------------------------------
-- Fahrgemeinschaften
-- ---------------------------------------------------------------------------------------------
create table public.ride_offers (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  driver_user_id uuid not null references public.profiles (id) on delete cascade,
  -- Bewusst nur ein grober Bereich bzw. Treffpunkt, keine Wohnadresse.
  departure_area text not null check (char_length(departure_area) between 2 and 120),
  departure_time timestamptz not null,
  available_seats integer not null check (available_seats between 1 and 8),
  destination text check (destination is null or char_length(destination) <= 160),
  return_trip boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  status public.ride_offer_status not null default 'open',
  created_at timestamptz not null default now(),
  unique (plan_id, driver_user_id)
);
create index ride_offers_plan_idx on public.ride_offers (plan_id);

create table public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  ride_offer_id uuid not null references public.ride_offers (id) on delete cascade,
  passenger_user_id uuid not null references public.profiles (id) on delete cascade,
  seats_requested integer not null default 1 check (seats_requested between 1 and 4),
  status public.ride_request_status not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ride_offer_id, passenger_user_id)
);

-- ---------------------------------------------------------------------------------------------
-- Rewards (Ledger), Benachrichtigungen, Protokolle
-- ---------------------------------------------------------------------------------------------
-- Punkte entstehen ausschließlich serverseitig per Trigger. Der Unique-Index verhindert, dass
-- dieselbe Aktion zweimal vergütet wird.
create table public.reward_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  points_delta integer not null check (points_delta <> 0),
  reason text not null check (reason in ('plan_organized', 'plan_attended', 'partner_bonus', 'admin_adjustment')),
  related_entity_id uuid,
  created_at timestamptz not null default now()
);
create unique index reward_transactions_once_idx on public.reward_transactions (user_id, reason, related_entity_id)
  where related_entity_id is not null;
create index reward_transactions_user_idx on public.reward_transactions (user_id, created_at desc);

-- Der Text einer Benachrichtigung wird in der App aus type + payload erzeugt (mehrsprachig),
-- deshalb gibt es hier keine title/body-Spalten.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'crew_member_joined', 'crew_member_removed', 'crew_role_changed',
    'poll_created', 'poll_reminder', 'poll_vote', 'poll_result',
    'plan_created', 'plan_changed', 'plan_cancelled', 'plan_attendance',
    'booking_status', 'ride_request', 'ride_confirmed', 'reward_earned'
  )),
  actor_id uuid references public.profiles (id) on delete set null,
  crew_id uuid references public.crews (id) on delete cascade,
  entity_type text check (entity_type in ('crew', 'poll', 'plan', 'ride_offer', 'reward')),
  related_entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  crew_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

create table public.rate_limit_hits (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_hits_lookup_idx on public.rate_limit_hits (user_id, action, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  entity_type text not null check (entity_type in ('activity', 'crew', 'crew_message', 'profile', 'plan')),
  entity_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at desc);
