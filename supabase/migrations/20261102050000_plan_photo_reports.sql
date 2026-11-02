-- P10 Etappe 2a · Fotos melden
-- Wer aus der Crew ein Foto vom Abend nicht sehen will (man ist selbst drauf und will das nicht, es ist
-- unangemessen …), meldet es. Das wirkt sofort und ohne Namen:
--   * Für die meldende Person ist das Foto weg – auch dann, wenn es später bleibt.
--   * Für die übrige Crew ist es ausgeblendet, bis Organisator:in, Owner oder Admins entscheiden.
--     Die hochladende Person sieht es weiter, mit dem Hinweis „gemeldet“.
--   * Organisator:in, Owner und Admins bekommen eine Benachrichtigung (ohne Namen der meldenden Person),
--     sehen das Foto mit den Gründen und entscheiden: „Wieder zeigen“ (`keep_plan_photo`) oder löschen
--     (bisheriger Weg; `delete_plan_photo` schließt die Meldungen jetzt mit).
-- Wer das Foto selbst hochgeladen hat, entscheidet nicht über die eigene Meldung – das tut jemand anderes
-- mit Verwaltungsrecht oder ein Admin der App (Admin → Meldungen); löschen geht immer.
-- Meldungen landen wie bisher in `public.reports` (Art `plan_photo`), damit Admins der App sie sehen.

-- ---- Meldungen: neue Art ----------------------------------------------------------------------
alter table public.reports drop constraint reports_entity_type_check;
alter table public.reports add constraint reports_entity_type_check
  check (entity_type in ('activity', 'crew', 'crew_message', 'profile', 'plan', 'plan_photo'));
create index reports_entity_idx on public.reports (entity_type, entity_id);

-- ---- Sichtbarkeit -----------------------------------------------------------------------------
-- Darf die anfragende Person ein fertiges Foto sehen? Eigene immer; sonst nicht, wenn sie es selbst
-- gemeldet hat, und nicht, solange eine Meldung offen ist – außer sie verwaltet den Plan.
create function app_private.plan_photo_visible(p_photo_id uuid, p_plan_id uuid, p_uploaded_by uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uploaded_by = (select auth.uid())
      or (
        not exists (select 1 from public.reports r
                    where r.entity_type = 'plan_photo' and r.entity_id = p_photo_id and r.reporter_id = (select auth.uid()))
        and (
          not exists (select 1 from public.reports r
                      where r.entity_type = 'plan_photo' and r.entity_id = p_photo_id and r.status = 'open')
          or exists (select 1 from public.plans p where p.id = p_plan_id and app_private.can_manage_plan(p))
        )
      );
$$;
revoke all on function app_private.plan_photo_visible(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.plan_photo_visible(uuid, uuid, uuid) to authenticated, service_role;

drop policy plan_photos_select_member on public.plan_photos;
create policy plan_photos_select_member on public.plan_photos for select to authenticated
  using (app_private.can_access_plan(plan_id)
         and (uploaded_by = (select auth.uid())
              or (uploaded_at is not null and app_private.plan_photo_visible(id, plan_id, uploaded_by))));

-- Dateien: Lesen folgt derselben Regel (keine signierte Adresse für ausgeblendete Fotos).
create or replace function app_private.plan_photo_allowed(p_name text, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.plan_photos ph
    join public.plans p on p.id = ph.plan_id
    where ph.path = p_name
      and app_private.is_crew_member(p.crew_id)
      and case p_action
            when 'read' then ph.uploaded_by = (select auth.uid())
                             or (ph.uploaded_at is not null and app_private.plan_photo_visible(ph.id, ph.plan_id, ph.uploaded_by))
            when 'upload' then ph.uploaded_by = (select auth.uid()) and ph.uploaded_at is null and p.status <> 'cancelled'
            when 'delete' then ph.uploaded_by = (select auth.uid()) or app_private.can_manage_plan(p)
            else false
          end
  );
$$;

-- ---- Neuer Benachrichtigungstyp ---------------------------------------------------------------
do $$
declare
  v_def text;
  v_types text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  if v_def ~ '''\{[a-z_,]+\}''' then
    v_types := substring(v_def from '''(\{[a-z_,]+\})''')::text[];
  else
    select array_agg(m.v[1] order by m.ord) into v_types
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') with ordinality as m(v, ord);
  end if;
  if v_types is null or cardinality(v_types) = 0 then
    raise exception 'notifications_type_check nicht gefunden';
  end if;
  if not ('plan_photo_reported' = any (v_types)) then
    v_types := v_types || 'plan_photo_reported'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

-- ---- RPCs -------------------------------------------------------------------------------------
-- Meldet ein fremdes, fertiges Foto. Zweites Melden derselben Person ändert nichts (kein Fehler).
create function public.report_plan_photo(p_photo_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_reason text := app_private.clean_text(p_reason, 1000);
  v_photo public.plan_photos%rowtype;
  v_plan public.plans%rowtype;
  v_manager record;
begin
  select * into v_photo from public.plan_photos ph where ph.id = p_photo_id for update;
  if not found or v_photo.uploaded_at is null or not app_private.can_access_plan(v_photo.plan_id) then
    perform app_private.forbid();
  end if;
  if v_photo.uploaded_by = v_uid then
    perform app_private.fail('plan_photo_own');
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    perform app_private.fail('invalid_report');
  end if;
  if exists (select 1 from public.reports r
             where r.entity_type = 'plan_photo' and r.entity_id = p_photo_id and r.reporter_id = v_uid) then
    return;
  end if;
  perform app_private.rate_limit('report', 10, interval '1 hour');

  insert into public.reports (reporter_id, entity_type, entity_id, reason)
  values (v_uid, 'plan_photo', p_photo_id, v_reason);

  -- Wer entscheidet, erfährt es – einmal je Foto, ohne Namen der meldenden Person.
  select * into v_plan from public.plans p where p.id = v_photo.plan_id;
  for v_manager in
    select m.user_id from public.crew_members m
    where m.crew_id = v_plan.crew_id and m.user_id <> v_uid
      and (m.user_id = v_plan.created_by or m.role in ('owner', 'admin'))
  loop
    perform app_private.notify(v_manager.user_id, 'plan_photo_reported', null, v_plan.crew_id, 'plan', v_plan.id,
                               jsonb_build_object('title', v_plan.title, 'photo_id', p_photo_id, 'own', v_manager.user_id = v_photo.uploaded_by),
                               'plan_photo_reported:' || p_photo_id::text);
  end loop;
end $$;

-- „Wieder zeigen“: Organisator:in, Owner oder Admins schließen die offenen Meldungen eines Fotos.
-- Für die meldenden Personen bleibt es ausgeblendet.
create function public.keep_plan_photo(p_photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_photo public.plan_photos%rowtype;
  v_plan public.plans%rowtype;
begin
  select * into v_photo from public.plan_photos ph where ph.id = p_photo_id for update;
  if not found then
    perform app_private.forbid();
  end if;
  select * into v_plan from public.plans p where p.id = v_photo.plan_id;
  if not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_photo.uploaded_by = v_uid then
    perform app_private.fail('plan_photo_own_review');
  end if;
  perform app_private.rate_limit('plan_photo_review', 60, interval '1 hour');
  update public.reports r set status = 'dismissed', resolved_by = v_uid, resolved_at = now()
  where r.entity_type = 'plan_photo' and r.entity_id = p_photo_id and r.status = 'open';
end $$;

-- Offene Meldungen zu den Fotos eines Plans: Verwaltende sehen Zahl und Gründe (ohne Namen), wer
-- hochgeladen hat, nur dass das eigene Foto gemeldet ist. Alle anderen bekommen eine leere Liste.
create function public.plan_photo_reports(p_plan_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_manage boolean;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.can_access_plan(p_plan_id) then
    perform app_private.forbid();
  end if;
  v_manage := app_private.can_manage_plan(v_plan);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'photo_id', x.photo_id,
             'count', x.n,
             'reasons', case when x.can_review then to_jsonb(x.reasons) else '[]'::jsonb end,
             'can_review', x.can_review
           ) order by x.photo_id)
    from (
      select ph.id as photo_id, count(*)::int as n, array_agg(r.reason order by r.created_at) as reasons,
             (v_manage and ph.uploaded_by <> v_uid) as can_review
      from public.plan_photos ph
      join public.reports r on r.entity_type = 'plan_photo' and r.entity_id = ph.id and r.status = 'open'
      where ph.plan_id = p_plan_id
        and (v_manage or ph.uploaded_by = v_uid)
        and not exists (select 1 from public.reports mine
                        where mine.entity_type = 'plan_photo' and mine.entity_id = ph.id and mine.reporter_id = v_uid)
      group by ph.id, ph.uploaded_by
    ) x
  ), '[]'::jsonb);
end $$;

-- Löschen wie bisher; offene Meldungen zum Foto gelten damit als erledigt.
create or replace function public.delete_plan_photo(p_photo_id uuid) returns void
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
  update public.reports r set status = 'resolved', resolved_by = (select auth.uid()), resolved_at = now()
  where r.entity_type = 'plan_photo' and r.entity_id = p_photo_id and r.status = 'open';
  delete from public.plan_photos ph where ph.id = p_photo_id;
end $$;

revoke all on function public.report_plan_photo(uuid, text) from public, anon, authenticated;
revoke all on function public.keep_plan_photo(uuid) from public, anon, authenticated;
revoke all on function public.plan_photo_reports(uuid) from public, anon, authenticated;
grant execute on function public.report_plan_photo(uuid, text) to authenticated, service_role;
grant execute on function public.keep_plan_photo(uuid) to authenticated, service_role;
grant execute on function public.plan_photo_reports(uuid) to authenticated, service_role;
