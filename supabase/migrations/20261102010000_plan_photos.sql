-- P10 Etappe 1a · Fotos zum Plan (Datenbank und Speicher)
-- Fotos vom Abend landen bei der Crew statt verstreut in Chats. Sie liegen im privaten Storage-Bucket
-- `plan-photos` unter `<crew>/<plan>/<foto>.webp` (bzw. `.jpg`); wer sie sehen darf, entscheidet allein die Zeile in
-- `public.plan_photos` zusammen mit der Mitgliedschaft in der Crew des Plans.
--
-- Ablauf beim Hochladen (Browser verkleinert vorher auf höchstens 1600 px und speichert neu – als WebP,
-- wo der Browser das kann, sonst als JPEG (Safari); beim Neuzeichnen fallen EXIF und Standort weg):
--   1. `reserve_plan_photo(plan, breite, höhe, typ)` prüft Crew, Beginn des Plans und Grenzen und vergibt
--      Pfad und ID.
--   2. Der Browser lädt die Datei über die Storage-API genau an diesen Pfad – die Policy auf
--      `storage.objects` lässt nur die reservierende Person und nur reservierte, noch leere Pfade zu.
--   3. `confirm_plan_photo(foto)` prüft, dass die Datei da ist; erst dann sieht die Crew das Foto.
-- Löschen: erst die Datei über die Storage-API (Policy: hochladende Person, Organisator:in, Owner/Admins),
-- dann `delete_plan_photo(foto)`.
--
-- Ohne Zeile ist eine Datei für niemanden lesbar: Plan gelöscht, Konto gelöscht oder Reservierung
-- verfallen → Foto weg für alle. Das physische Aufräumen der Dateien folgt in Etappe 3.
-- Grenzen: 50 Fotos je Plan, 10 je Person und Plan, erst ab Beginn des Plans, nicht bei abgesagten.

-- ---- Bucket -----------------------------------------------------------------------------------
-- Größen- und Typgrenze nur, wo die Storage-Tabellen sie kennen (gehostetes Supabase: immer; lokal
-- ohne laufenden Storage-Dienst gibt es nur die Grundspalten).
insert into storage.buckets (id, name) values ('plan-photos', 'plan-photos') on conflict (id) do nothing;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $q$ update storage.buckets set public = false where id = 'plan-photos' $q$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$ update storage.buckets set file_size_limit = 2097152 where id = 'plan-photos' $q$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $q$ update storage.buckets set allowed_mime_types = array['image/webp', 'image/jpeg'] where id = 'plan-photos' $q$;
  end if;
end $$;

-- ---- Tabelle ----------------------------------------------------------------------------------
create table public.plan_photos (
  id uuid primary key,
  plan_id uuid not null references public.plans (id) on delete cascade,
  -- Konto gelöscht → Fotos weg (Zeile weg = Datei für niemanden mehr lesbar).
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  path text not null unique
    check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'),
  width smallint not null check (width between 1 and 1600),
  height smallint not null check (height between 1 and 1600),
  uploaded_at timestamptz,
  created_at timestamptz not null default now()
);
create index plan_photos_plan_idx on public.plan_photos (plan_id, created_at);
create index plan_photos_uploaded_by_idx on public.plan_photos (uploaded_by);

alter table public.plan_photos enable row level security;
revoke all on table public.plan_photos from public, anon, authenticated;
grant select on table public.plan_photos to authenticated;

-- Die Crew sieht fertige Fotos; eine noch laufende Reservierung nur die Person, die gerade hochlädt.
create policy plan_photos_select_member on public.plan_photos for select to authenticated
  using (app_private.can_access_plan(plan_id) and (uploaded_at is not null or uploaded_by = (select auth.uid())));

-- ---- Policies auf storage.objects -------------------------------------------------------------
-- p_action: 'read' (Crew des Plans), 'upload' (nur die reservierende Person, solange nicht bestätigt),
-- 'delete' (hochladende Person, Organisator:in, Owner/Admins). Läuft in der Rolle der anfragenden Person.
create function app_private.plan_photo_allowed(p_name text, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.plan_photos ph
    join public.plans p on p.id = ph.plan_id
    where ph.path = p_name
      and app_private.is_crew_member(p.crew_id)
      and case p_action
            when 'read' then true
            when 'upload' then ph.uploaded_by = (select auth.uid()) and ph.uploaded_at is null and p.status <> 'cancelled'
            when 'delete' then ph.uploaded_by = (select auth.uid()) or app_private.can_manage_plan(p)
            else false
          end
  );
$$;
revoke all on function app_private.plan_photo_allowed(text, text) from public, anon;
grant execute on function app_private.plan_photo_allowed(text, text) to authenticated, service_role;

create policy plan_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'plan-photos' and app_private.plan_photo_allowed(name, 'read'));
create policy plan_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'plan-photos' and app_private.plan_photo_allowed(name, 'upload'));
create policy plan_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'plan-photos' and app_private.plan_photo_allowed(name, 'delete'));
-- Kein Update: Fotos werden nicht überschrieben (kein upsert), sondern gelöscht und neu hochgeladen.

-- ---- RPCs -------------------------------------------------------------------------------------
-- p_type: 'image/webp' oder 'image/jpeg' (Safari kann kein WebP speichern); bestimmt die Dateiendung.
create function public.reserve_plan_photo(p_plan_id uuid, p_width integer, p_height integer, p_type text default 'image/webp') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  -- Sperre auf dem Plan: zwei gleichzeitige Reservierungen können die Grenzen nicht überholen.
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status = 'cancelled' then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at > now() then
    perform app_private.fail('plan_photos_not_yet');
  end if;
  if p_width is null or p_height is null or p_width not between 1 and 1600 or p_height not between 1 and 1600
     or p_type is null or p_type not in ('image/webp', 'image/jpeg') then
    perform app_private.fail('invalid_plan_photo');
  end if;

  -- Abgebrochene Uploads geben ihren Platz nach einer Stunde frei.
  delete from public.plan_photos ph
  where ph.plan_id = p_plan_id and ph.uploaded_at is null and ph.created_at < now() - interval '1 hour';

  if (select count(*) from public.plan_photos ph where ph.plan_id = p_plan_id) >= 50 then
    perform app_private.fail('plan_photo_limit');
  end if;
  if (select count(*) from public.plan_photos ph where ph.plan_id = p_plan_id and ph.uploaded_by = v_uid) >= 10 then
    perform app_private.fail('plan_photo_user_limit');
  end if;
  perform app_private.rate_limit('plan_photo', 30, interval '1 hour');

  v_path := v_plan.crew_id::text || '/' || v_plan.id::text || '/' || v_id::text || case p_type when 'image/jpeg' then '.jpg' else '.webp' end;
  insert into public.plan_photos (id, plan_id, uploaded_by, path, width, height)
  values (v_id, v_plan.id, v_uid, v_path, p_width, p_height);
  return jsonb_build_object('id', v_id, 'path', v_path);
end $$;

create function public.confirm_plan_photo(p_photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_photo public.plan_photos%rowtype;
begin
  select * into v_photo from public.plan_photos ph where ph.id = p_photo_id for update;
  if not found or v_photo.uploaded_by <> v_uid or not app_private.can_access_plan(v_photo.plan_id) then
    perform app_private.forbid();
  end if;
  if v_photo.uploaded_at is not null then
    return;
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'plan-photos' and o.name = v_photo.path) then
    perform app_private.fail('plan_photo_missing');
  end if;
  update public.plan_photos ph set uploaded_at = now() where ph.id = p_photo_id;
end $$;

-- Die Datei löscht der Browser vorher über die Storage-API (gleiche Berechtigung wie hier).
create function public.delete_plan_photo(p_photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_photo public.plan_photos%rowtype;
  v_plan public.plans%rowtype;
begin
  perform app_private.require_user();
  select * into v_photo from public.plan_photos ph where ph.id = p_photo_id for update;
  if not found then
    perform app_private.forbid();
  end if;
  select * into v_plan from public.plans p where p.id = v_photo.plan_id;
  if not app_private.is_crew_member(v_plan.crew_id)
     or not (v_photo.uploaded_by = (select auth.uid()) or app_private.can_manage_plan(v_plan)) then
    perform app_private.forbid();
  end if;
  perform app_private.rate_limit('plan_photo_remove', 60, interval '1 hour');
  delete from public.plan_photos ph where ph.id = p_photo_id;
end $$;

revoke all on function public.reserve_plan_photo(uuid, integer, integer, text) from public, anon;
revoke all on function public.confirm_plan_photo(uuid) from public, anon;
revoke all on function public.delete_plan_photo(uuid) from public, anon;
grant execute on function public.reserve_plan_photo(uuid, integer, integer, text) to authenticated, service_role;
grant execute on function public.confirm_plan_photo(uuid) to authenticated, service_role;
grant execute on function public.delete_plan_photo(uuid) to authenticated, service_role;

-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher (Stand P14 Etappe 1), dazu die eigenen Plan-Fotos (Angaben; die Bilder selbst lädt man in der App).
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = v_uid),
    'calendar_feed', (select jsonb_build_object('active', true, 'created_at', f.created_at, 'last_used_at', f.last_used_at)
                      from public.calendar_feeds f where f.user_id = v_uid),
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('label', d.label, 'created_at', d.created_at, 'last_success_at', d.last_success_at, 'muted_types', d.muted_types) order by d.created_at)
                              from public.push_subscriptions d where d.user_id = v_uid), '[]'::jsonb),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('crew_id', c.id, 'name', c.name, 'role', m.role, 'joined_at', m.joined_at) order by m.joined_at)
                       from public.crew_members m join public.crews c on c.id = m.crew_id where m.user_id = v_uid), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('crew_id', cm.crew_id, 'body', cm.body, 'created_at', cm.created_at) order by cm.created_at)
                          from public.crew_messages cm where cm.user_id = v_uid), '[]'::jsonb),
    'polls_created', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'created_at', p.created_at) order by p.created_at)
                               from public.polls p where p.created_by = v_uid), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('poll_id', v.poll_id, 'option', o.title, 'response', v.response, 'updated_at', v.updated_at) order by v.updated_at)
                       from public.poll_votes v join public.poll_options o on o.id = v.poll_option_id where v.user_id = v_uid), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'starts_at', pl.starts_at, 'attendance_status', pp.attendance_status,
                                                           'organizer', pl.created_by = v_uid) order by pl.starts_at)
                       from public.plan_participants pp join public.plans pl on pl.id = pp.plan_id where pp.user_id = v_uid), '[]'::jsonb),
    'plan_expenses', coalesce((select jsonb_agg(jsonb_build_object('plan_id', e.plan_id, 'kind', e.kind, 'description', e.description,
                                                                   'amount_cents', e.amount_cents, 'paid_by_me', e.paid_by = v_uid,
                                                                   'created_by_me', e.created_by = v_uid, 'created_at', e.created_at) order by e.created_at)
                               from public.plan_expenses e where e.paid_by = v_uid or e.created_by = v_uid), '[]'::jsonb),
    'plan_expense_shares', coalesce((select jsonb_agg(jsonb_build_object('plan_id', s.plan_id, 'kind', e.kind, 'description', e.description,
                                                                         'share_cents', s.amount_cents, 'created_at', e.created_at) order by e.created_at)
                                     from public.plan_expense_shares s join public.plan_expenses e on e.id = s.expense_id where s.user_id = v_uid), '[]'::jsonb),
    'plan_items', coalesce((select jsonb_agg(jsonb_build_object('plan_id', i.plan_id, 'label', i.label, 'created_by_me', i.created_by = v_uid,
                                                                'bringing', i.claimed_by = v_uid, 'created_at', i.created_at) order by i.created_at)
                            from public.plan_items i where i.created_by = v_uid or i.claimed_by = v_uid), '[]'::jsonb),
    'plan_photos', coalesce((select jsonb_agg(jsonb_build_object('plan_id', ph.plan_id, 'path', ph.path, 'width', ph.width, 'height', ph.height,
                                                                 'uploaded_at', ph.uploaded_at) order by ph.created_at)
                             from public.plan_photos ph where ph.uploaded_by = v_uid and ph.uploaded_at is not null), '[]'::jsonb),
    'spontaneous_asks', coalesce((select jsonb_agg(jsonb_build_object('crew_id', a.crew_id, 'note', a.note, 'created_at', a.created_at,
                                                                      'expires_at', a.expires_at, 'closed_at', a.closed_at) order by a.created_at)
                                  from public.spontaneous_asks a where a.created_by = v_uid), '[]'::jsonb),
    'spontaneous_answers', coalesce((select jsonb_agg(jsonb_build_object('crew_id', a.crew_id, 'answer', s.answer, 'answered_at', s.answered_at) order by s.answered_at)
                                     from public.spontaneous_answers s join public.spontaneous_asks a on a.id = s.ask_id where s.user_id = v_uid), '[]'::jsonb),
    'booking_requests', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.booking_requests b where b.created_by = v_uid), '[]'::jsonb),
    'ride_offers', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at) from public.ride_offers o where o.driver_user_id = v_uid), '[]'::jsonb),
    'ride_requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.ride_requests r where r.passenger_user_id = v_uid), '[]'::jsonb),
    'reward_transactions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.reward_transactions t where t.user_id = v_uid), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'payload', n.payload, 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at)
                               from public.notifications n where n.user_id = v_uid), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = v_uid), '[]'::jsonb)
  );
end $$;
