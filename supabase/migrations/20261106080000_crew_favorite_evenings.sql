-- P29 Etappe 2 · „Eure Lieblingsabende“ im Crew-Rückblick
-- Aus den Urteilen von „Wie war’s?“ (P29) werden die Abende, bei denen die meisten „Nochmal!“ gesagt haben,
-- im Rückblick der Crew (P9) vorn gezeigt – mit Link zum Plan, wo „Nochmal?“ (P17) die nächste Runde startet.
--
-- Ein Lieblingsabend ist ein abgeschlossener Plan der Crew mit mindestens zwei „Nochmal!“, bei dem mehr als die Hälfte
-- der Urteile „Nochmal!“ sind (dieselbe Regel wie `isFavoriteEvening` in src/lib/favorites.ts).
--
-- Bewusst so gebaut:
--   * Nur Zahlen, nie Namen – wie `plan_feedback_summary`. Die Funktion verrät nichts, was ein Mitglied nicht schon auf
--     der Planseite sieht.
--   * Nur Mitglieder der Crew; Außenstehende und Ehemalige bekommen `forbidden`.
--   * `p_year` (optional) beschränkt auf ein Kalenderjahr in Berliner Zeit („Euer Jahr“).
--   * Höchstens drei Abende: meiste „Nochmal!“ zuerst, bei Gleichstand der jüngste.

create function public.crew_favorite_evenings(p_crew_id uuid, p_year int default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_user();
  if p_crew_id is null or not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('plan_id', f.id, 'title', f.title, 'starts_at', f.starts_at,
                                        'again', f.again, 'total', f.total)
                     order by f.again desc, f.starts_at desc, f.id)
    from (
      select p.id, p.title, p.starts_at,
             count(*) filter (where fb.verdict = 'again')::int as again,
             count(*)::int as total
      from public.plans p
      join public.plan_feedback fb on fb.plan_id = p.id
      where p.crew_id = p_crew_id
        and p.status = 'completed'
        and (p_year is null or extract(year from p.starts_at at time zone 'Europe/Berlin')::int = p_year)
      group by p.id, p.title, p.starts_at
      having count(*) filter (where fb.verdict = 'again') >= 2
         and count(*) filter (where fb.verdict = 'again') * 2 > count(*)
      order by again desc, p.starts_at desc, p.id
      limit 3
    ) f
  ), '[]'::jsonb);
end $$;

revoke all on function public.crew_favorite_evenings(uuid, int) from public, anon, authenticated;
grant execute on function public.crew_favorite_evenings(uuid, int) to authenticated, service_role;

comment on function public.crew_favorite_evenings(uuid, int) is
  'P29 Etappe 2: bis zu drei abgeschlossene Abende der Crew mit den meisten „Nochmal!“ (mind. 2, mehr als die Hälfte), nur Zahlen.';
