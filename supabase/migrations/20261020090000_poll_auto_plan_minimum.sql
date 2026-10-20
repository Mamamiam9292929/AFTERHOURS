-- =============================================================================================
-- AFTERHOURS – Fehlerbehebung S5: kein automatischer Plan unter der Mindestteilnehmerzahl
--
-- Endete eine Abstimmung mit „Entscheidet sich selbst“ durch Fristablauf, wurde aus dem Gewinner immer
-- ein bestätigter Plan – auch wenn die Abstimmung „Mindestens 4 Zusagen“ verlangte und nur eine Person
-- dabei war. Die Crew bekam „Plan steht“, die Abstimmung zeigte gleichzeitig „Es fehlen 3 Zusagen“.
-- Jetzt entsteht der Plan von selbst nur, wenn der Gewinner die Mindestzahl erreicht (Crew und Gäste
-- zusammen, wie beim Ergebnis). Sonst bleibt es beim Ergebnis, „Plan erstellen“ funktioniert wie bisher.
-- Ersetzt app_private.on_poll_closed_auto_plan aus 20261019180000_poll_auto_decide.sql; Rechte bleiben.
-- =============================================================================================

create or replace function app_private.on_poll_closed_auto_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_option public.poll_options%rowtype;
  v_activity public.activities%rowtype;
  v_starts_at timestamptz;
  v_plan_id uuid;
  v_yes bigint;
begin
  if not (new.auto_decide and old.status = 'open' and new.status = 'closed'
          and new.closed_by is null and new.winning_option_id is not null) then
    return null;
  end if;
  select * into v_option from public.poll_options o where o.id = new.winning_option_id;
  if v_option.proposed_date is null then
    return null; -- ohne Termin kein Plan; „Plan erstellen“ fragt dann nach dem Tag
  end if;
  -- Mindestteilnehmerzahl: Sind beim Gewinner weniger dabei, als die Abstimmung verlangt, entsteht kein
  -- bestätigter Plan von selbst. Das Ergebnis bleibt, die Seite zeigt „Es fehlen … Zusagen“, und
  -- „Plan erstellen“ geht wie bisher von Hand. (Die klare Mehrheit prüft die Mindestzahl schon vorher.)
  select c.yes_count into v_yes from app_private.poll_yes_counts(new.id) c where c.option_id = new.winning_option_id;
  if coalesce(v_yes, 0) < coalesce(new.min_participants, 1) then
    return null;
  end if;
  v_starts_at := (v_option.proposed_date + coalesce(v_option.proposed_time, time '19:00')) at time zone 'Europe/Berlin';
  if v_starts_at <= now() then
    return null;
  end if;
  select * into v_activity from public.activities a where a.id = v_option.activity_id;

  -- Ein Fehler hier darf die Stimme bzw. das Ende der Abstimmung nie verhindern: dann bleibt es beim
  -- Ergebnis, und „Plan erstellen“ funktioniert wie bisher.
  begin
    insert into public.plans (crew_id, created_by, poll_id, activity_id, title, starts_at, address, meeting_point,
                              estimated_cost_per_person_cents, status)
    values (new.crew_id, new.created_by, new.id, v_option.activity_id, v_option.title, v_starts_at,
            v_activity.address, new.meeting_point, v_option.estimated_price_cents, 'confirmed')
    on conflict (poll_id) do nothing
    returning id into v_plan_id;

    if v_plan_id is not null then
      -- Wer beim Gewinner „dabei“ gesagt hat, ist zugesagt; alle anderen aus der Crew sind eingeladen.
      insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
      select v_plan_id, m.user_id,
             case when v.id is not null then 'going'::public.attendance_status else 'invited'::public.attendance_status end,
             case when v.id is not null then now() end
      from public.crew_members m
      left join public.poll_votes v on v.poll_option_id = v_option.id and v.user_id = m.user_id and v.response = 'yes'
      where m.crew_id = new.crew_id
      on conflict do nothing;

      perform app_private.notify_crew(new.crew_id, 'plan_created', null, 'plan', v_plan_id,
                                      jsonb_build_object('title', v_option.title, 'starts_at', v_starts_at,
                                                         'from_poll', true, 'auto', true),
                                      'plan_created:' || v_plan_id::text);
      insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
      values (null, 'plan_created_from_poll', 'plan', v_plan_id, new.crew_id,
              jsonb_build_object('poll_id', new.id, 'automatic', true));
    end if;
  exception when others then
    raise warning 'auto plan for poll % failed: %', new.id, sqlerrm;
  end;
  return null;
end $$;

revoke all on function app_private.on_poll_closed_auto_plan() from public, anon, authenticated;
