-- P10 Etappe 2c · Fotos im Crew-Rückblick
-- Unter „Euer Rückblick“ liegen die letzten Abende mit Fotos als kleine Stapel. Gezeigt wird nur, was die
-- anfragende Person ohnehin auf der Planseite sieht – und strenger:
--   * nur abgeschlossene Pläne der eigenen Crew (wie der Rückblick selbst),
--   * nur fertig hochgeladene Fotos,
--   * kein Foto mit offener Meldung – auch nicht für Verwaltende oder die hochladende Person (die sehen es
--     auf der Planseite mit Hinweis, im Rückblick hat es bis zur Entscheidung nichts verloren),
--   * kein Foto, das die Person selbst gemeldet hat (auch nach „Wieder zeigen“ nicht).
-- Die Dateien holt der Browser danach wie gewohnt über signierte Adressen; die Storage-Policy prüft dabei
-- weiter selbst (`app_private.plan_photo_allowed`).
--
-- Antwort: höchstens 6 Abende, jüngster zuerst, je Abend Zahl der sichtbaren Fotos und die drei neuesten:
--   [{ plan_id, title, starts_at, count, photos: [{ id, path, width, height }] }]

create function public.crew_photo_stacks(p_crew_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_result jsonb;
begin
  if p_crew_id is null or not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;

  with visible as (
    select ph.id, ph.plan_id, ph.path, ph.width, ph.height, ph.uploaded_at
    from public.plan_photos ph
    join public.plans p on p.id = ph.plan_id
    where p.crew_id = p_crew_id
      and p.status = 'completed'
      and ph.uploaded_at is not null
      and not exists (
        select 1 from public.reports r
        where r.entity_type = 'plan_photo' and r.entity_id = ph.id
          and (r.status = 'open' or r.reporter_id = v_uid)
      )
  ),
  stacks as (
    select p.id, p.title, p.starts_at, count(*)::int as n
    from visible v
    join public.plans p on p.id = v.plan_id
    group by p.id, p.title, p.starts_at
    order by p.starts_at desc, p.id
    limit 6
  )
  select jsonb_agg(
           jsonb_build_object(
             'plan_id', s.id,
             'title', s.title,
             'starts_at', s.starts_at,
             'count', s.n,
             'photos', (
               select jsonb_agg(jsonb_build_object('id', x.id, 'path', x.path, 'width', x.width, 'height', x.height)
                                order by x.uploaded_at desc, x.id)
               from (
                 select v.id, v.path, v.width, v.height, v.uploaded_at
                 from visible v
                 where v.plan_id = s.id
                 order by v.uploaded_at desc, v.id
                 limit 3
               ) x
             )
           )
           order by s.starts_at desc, s.id)
  into v_result
  from stacks s;

  return coalesce(v_result, '[]'::jsonb);
end $$;

revoke all on function public.crew_photo_stacks(uuid) from public, anon, authenticated;
grant execute on function public.crew_photo_stacks(uuid) to authenticated, service_role;
