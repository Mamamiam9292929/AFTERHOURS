-- P10 Etappe 3 · Fotos aufräumen (Dateien wirklich löschen, nicht nur Zeilen)
-- Bisher galt: ohne Zeile in `public.plan_photos` ist eine Datei für niemanden lesbar. Die Datei selbst blieb
-- aber im Bucket liegen – nach gelöschtem Plan, gelöschter Crew, gelöschtem Konto oder verfallener
-- Reservierung. Ab jetzt:
--   1. Jede gelöschte Foto-Zeile, zu der noch eine Datei im Bucket liegt, landet in der Warteschlange
--      `app_private.plan_photo_trash` (Trigger; greift auch bei Löschungen per Kaskade über Plan, Crew, Konto).
--   2. Fotos verfallen 12 Monate nach dem Abend (Ende, sonst Beginn des Plans); nie bestätigte Reservierungen
--      nach einem Tag. Beides erledigt `app_private.expire_plan_photos()` – die Zeilen verschwinden, die
--      Dateien gehen über Schritt 1 in die Warteschlange.
--   3. Die Edge Function `photo-cleanup` holt fällige Pfade (`claim_plan_photo_trash`, nur service_role),
--      löscht die Dateien über die Storage-API (direktes Löschen in storage.objects entfernt die Datei im
--      Speicher nicht) und meldet zurück (`finish_plan_photo_trash`). Ein Eintrag verschwindet erst, wenn
--      die Datei tatsächlich weg ist – sonst kommt er später noch einmal dran.
-- Angestoßen von der App beim Start (`plan_photo_cleanup_kick`, Rate Limit), optional per pg_cron mit dem
-- Service-Schlüssel (README Abschnitt 3).

-- ---- Warteschlange ----------------------------------------------------------------------------
create table app_private.plan_photo_trash (
  path text primary key,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0)
);
alter table app_private.plan_photo_trash enable row level security;
revoke all on table app_private.plan_photo_trash from public, anon, authenticated;

create function app_private.queue_plan_photo_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from storage.objects o where o.bucket_id = 'plan-photos' and o.name = old.path) then
    insert into app_private.plan_photo_trash (path) values (old.path) on conflict (path) do nothing;
  end if;
  return old;
end $$;
revoke all on function app_private.queue_plan_photo_file() from public, anon, authenticated;

create trigger plan_photos_queue_file after delete on public.plan_photos
  for each row execute function app_private.queue_plan_photo_file();

-- Dateien, deren Zeile schon vor dieser Migration verschwunden ist.
insert into app_private.plan_photo_trash (path)
select o.name from storage.objects o
where o.bucket_id = 'plan-photos'
  and not exists (select 1 from public.plan_photos ph where ph.path = o.name)
on conflict (path) do nothing;

-- ---- Fristen ----------------------------------------------------------------------------------
create function app_private.expire_plan_photos() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.plan_photos ph
  using public.plans p
  where p.id = ph.plan_id
    and (coalesce(p.ends_at, p.starts_at) < now() - interval '12 months'
         or (ph.uploaded_at is null and ph.created_at < now() - interval '1 day'));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function app_private.expire_plan_photos() from public, anon, authenticated;

-- ---- Anstoß aus der App -----------------------------------------------------------------------
-- Prüft Fristen und sagt, ob Dateien zu löschen sind. Die Edge Function ruft danach mit dem
-- Service-Schlüssel die eigentlichen Schritte auf.
create function public.plan_photo_cleanup_kick() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_user();
  perform app_private.rate_limit('plan_photo_cleanup', 12, interval '1 hour');
  perform app_private.expire_plan_photos();
  return exists (
    select 1 from app_private.plan_photo_trash t
    where t.claimed_at is null or t.claimed_at < now() - greatest(least(t.attempts, 24), 1) * interval '10 minutes');
end $$;

-- Bis zu p_limit fällige Pfade, als in Arbeit vorgemerkt. Wer mehrmals scheitert, wartet länger
-- (10 Minuten je Versuch, höchstens 4 Stunden). Pfade, zu denen es wieder eine Zeile gibt, fallen weg.
create function public.claim_plan_photo_trash(p_limit integer default 100) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_paths text[];
begin
  perform app_private.expire_plan_photos();
  delete from app_private.plan_photo_trash t
  where exists (select 1 from public.plan_photos ph where ph.path = t.path);

  with due as (
    select t.path from app_private.plan_photo_trash t
    where t.claimed_at is null or t.claimed_at < now() - greatest(least(t.attempts, 24), 1) * interval '10 minutes'
    order by t.queued_at, t.path
    limit v_limit
    for update of t skip locked
  ), claimed as (
    update app_private.plan_photo_trash t set claimed_at = now(), attempts = t.attempts + 1
    from due where t.path = due.path
    returning t.path
  )
  select coalesce(array_agg(c.path order by c.path), '{}') into v_paths from claimed c;
  return v_paths;
end $$;

-- Nach dem Löschen über die Storage-API: Einträge verschwinden nur, wenn die Datei wirklich weg ist.
create function public.finish_plan_photo_trash(p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if p_paths is null or cardinality(p_paths) > 1000 then
    perform app_private.fail('invalid_plan_photo_trash');
  end if;
  delete from app_private.plan_photo_trash t
  where t.path = any (p_paths)
    and not exists (select 1 from storage.objects o where o.bucket_id = 'plan-photos' and o.name = t.path);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.plan_photo_cleanup_kick() from public, anon, authenticated;
revoke all on function public.claim_plan_photo_trash(integer) from public, anon, authenticated;
revoke all on function public.finish_plan_photo_trash(text[]) from public, anon, authenticated;
grant execute on function public.plan_photo_cleanup_kick() to authenticated;
grant execute on function public.claim_plan_photo_trash(integer) to service_role;
grant execute on function public.finish_plan_photo_trash(text[]) to service_role;
