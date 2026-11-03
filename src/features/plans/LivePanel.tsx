import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconNavigation } from "@/components/icons";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { FormMessage } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import {
  ARRIVAL_CHOICES,
  arrivalState,
  distanceMeters,
  isAtPlace,
  isStale,
  liveStage,
  liveWindow,
  roundDistance,
  shareUntil,
  shouldSend,
  walkMinutes,
  type LivePoint,
} from "@/lib/live";
import { formatAgo, formatTime } from "@/lib/time";
import type { PlanLiveLocation } from "@/lib/types";
import { PANEL_ITEM, StatusPill } from "./PlanPanel";
import type { PlanWithParticipants } from "./api";
import { LiveMap, type LiveMapPerson } from "./LiveMap";
import { usePlanLiveLocations, useSetLiveArrival, useShareLiveLocation, useStopLiveLocation } from "./liveApi";

interface LivePanelProps {
  plan: PlanWithParticipants;
  userId: string;
  now: Date;
  /** Koordinaten des Ortes, falls bekannt – Bezugspunkt, solange man selbst nicht teilt. */
  place: LivePoint | null;
  /** Name des Ortes für die Beschreibung des Stadtplans. */
  placeName?: string | null;
  lookup: (id: string | null | undefined) => Person | null;
}

type GeoProblem = "denied" | "unavailable" | "unsupported";
/** Fehler, nach denen weiteres Senden sinnlos ist (Fenster vorbei, Antwort geändert, Plan zu). */
const FINAL_CODES = ["live_location_outside_window", "live_location_not_going", "plan_locked"];

function distanceLabel(meters: number): string {
  const d = roundDistance(meters);
  if (d.kind === "near") return t.plans.live.near;
  return d.kind === "m" ? t.plans.live.meters(d.value) : t.plans.live.km(formatNumber(d.value));
}

/**
 * P13 · „Wo seid ihr?“ – Live-Standort nur rund um einen Plan. Teilen beginnt erst auf ausdrücklichen Tipp,
 * gilt höchstens 3 Stunden (nie über das Ende hinaus) und wird nur aktualisiert, solange diese Seite offen ist.
 * Wer nicht zugesagt oder „vielleicht“ gesagt hat, sieht nur den Hinweis – der Server liefert ihm auch nichts.
 */
export function LivePanel({ plan, userId, now, place, placeName = null, lookup }: LivePanelProps) {
  const stage = liveStage(plan, now);
  const mine = plan.participants.find((p) => p.user_id === userId)?.attendance_status;
  const coming = mine === "going" || mine === "maybe";
  const open = stage === "open" && coming;
  const locations = usePlanLiveLocations(plan.id, open);
  const share = useShareLiveLocation(plan.id);
  const stop = useStopLiveLocation(plan.id);
  const toast = useToast();

  const watchId = useRef<number | null>(null);
  const lastSent = useRef<(LivePoint & { at: number }) | null>(null);
  const [watching, setWatching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [myPoint, setMyPoint] = useState<LivePoint | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function clearWatch() {
    if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    lastSent.current = null;
    setWatching(false);
    setLocating(false);
  }

  // Seite verlassen: nicht weiter senden. Die letzte Position bleibt bis zum Ablauf der Freigabe sichtbar.
  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current);
  }, []);

  const rows = locations.data ?? [];
  const myRow = rows.find((r) => r.user_id === userId) ?? null;
  const expiresAt = myRow ? new Date(myRow.expires_at) : null;

  // Ablauf, Fenster vorbei oder Antwort geändert: Beobachten beenden.
  const expired = watching && expiresAt != null && now.getTime() >= expiresAt.getTime();
  useEffect(() => {
    if ((expired || !open) && watchId.current != null) {
      clearWatch();
      if (expired) toast.success(t.plans.live.expired);
    }
    // clearWatch hängt nur an Refs und State-Settern; toast ist der Kontext-Wert.
  }, [expired, open]);

  if (stage === "hidden") return null;

  function send(point: LivePoint, accuracy: number | null, first: boolean) {
    lastSent.current = { ...point, at: Date.now() };
    share.mutate(
      { ...point, accuracy },
      {
        onSuccess: (until) => {
          setProblem(null);
          if (first) toast.success(t.plans.live.started(formatTime(until)));
        },
        onError: (error) => {
          const code = (error as { message?: string }).message ?? "";
          if (first || FINAL_CODES.includes(code)) {
            clearWatch();
            setProblem(errorMessage(error));
          }
          // Einzelne Aussetzer (Netz) beim Aktualisieren: beim nächsten Mal wieder versuchen.
          else lastSent.current = null;
        },
      },
    );
  }

  function start() {
    setProblem(null);
    if (!("geolocation" in navigator)) {
      setProblem(t.plans.live.errors.unsupported);
      return;
    }
    clearWatch();
    setLocating(true);
    let first = true;
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setMyPoint(point);
        setLocating(false);
        setWatching(true);
        if (!shouldSend(lastSent.current, point, Date.now())) return;
        const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
        send(point, accuracy, first);
        first = false;
      },
      (error) => {
        const kind: GeoProblem = error.code === 1 /* PERMISSION_DENIED */ ? "denied" : "unavailable";
        // Kurze Aussetzer während des Teilens nicht melden – nur wenn noch gar nichts ging oder gesperrt wurde.
        if (kind === "denied" || first) {
          clearWatch();
          setProblem(t.plans.live.errors[kind]);
        }
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
  }

  function stopSharing() {
    clearWatch();
    setMyPoint(null);
    stop.mutate(undefined, { onSuccess: () => toast.success(t.plans.live.stopped), onError: (error) => toast.error(error) });
  }

  if (stage === "soon") {
    return <p className="text-[15px] leading-snug text-muted">{t.plans.live.soon(formatTime(liveWindow(plan).start))}</p>;
  }
  if (!coming) return <p className="text-[15px] leading-snug text-muted">{t.plans.live.notGoing}</p>;
  if (locations.isPending) return <Skeleton className="h-28" />;
  if (locations.isError) return <ErrorState error={locations.error} onRetry={() => void locations.refetch()} />;

  // Bezugspunkt für Entfernungen: die eigene Position (frisch oder zuletzt gesendet), sonst der Ort.
  const reference: { point: LivePoint; mine: boolean } | null = myPoint
    ? { point: myPoint, mine: true }
    : myRow
      ? { point: myRow, mine: true }
      : place
        ? { point: place, mine: false }
        : null;
  const others = rows
    .filter((r) => r.user_id !== userId)
    .map((r) => ({ row: r, distance: reference ? distanceMeters(reference.point, r) : null }))
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) || b.row.updated_at.localeCompare(a.row.updated_at));
  // P13 Etappe 2a: alle, die teilen, auf dem Stadtplan – man selbst mit der frischesten bekannten Position.
  const mapPeople: LiveMapPerson[] = [
    ...(myPoint || myRow
      ? [{ userId, point: myPoint ?? myRow!, person: lookup(userId), mine: true, stale: !myPoint && myRow != null && isStale(myRow.updated_at, now) }]
      : []),
    ...others.map(({ row }) => ({ userId: row.user_id, point: row, person: lookup(row.user_id), mine: false, stale: isStale(row.updated_at, now) })),
  ];

  return (
    <div className="space-y-3">
      {myRow && expiresAt ? (
        <div className={cn(PANEL_ITEM, "space-y-3 border-lime/45 bg-lime/[0.07] p-3.5")} data-testid="live-mine">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="lime" testId="live-status">
              <span aria-hidden className={cn("size-2 rounded-full bg-lime-ink", watching && "animate-pulse")} />
              {t.plans.live.sharing(formatTime(expiresAt))}
            </StatusPill>
          </div>
          <p className="text-sm leading-snug text-muted">{watching ? t.plans.live.sharingLive : t.plans.live.sharingPaused(formatAgo(myRow.updated_at, now))}</p>
          <ArrivalPicker planId={plan.id} row={myRow} point={myPoint ?? myRow} place={place} now={now} />
          <div className="flex flex-wrap gap-2">
            {!watching && (
              <Button size="sm" loading={locating} onClick={start} icon={<IconNavigation className="size-4" aria-hidden />}>
                {t.plans.live.resume}
              </Button>
            )}
            <Button size="sm" variant="secondary" loading={stop.isPending} onClick={stopSharing}>
              {t.plans.live.stop}
            </Button>
          </div>
        </div>
      ) : (
        <div className={cn(PANEL_ITEM, "space-y-3 p-3.5")}>
          <p className="text-[15px] leading-snug text-fg">{t.plans.live.intro(formatTime(shareUntil(plan, now)))}</p>
          <Button loading={locating || (share.isPending && !myRow)} onClick={start} icon={<IconNavigation className="size-4" aria-hidden />}>
            {locating ? t.plans.live.starting : t.plans.live.start(formatTime(shareUntil(plan, now)))}
          </Button>
        </div>
      )}
      {problem && <FormMessage>{problem}</FormMessage>}

      {others.length > 0 && <LiveMap place={place} placeName={placeName} people={mapPeople} />}

      {others.length === 0 ? (
        <p className="text-[15px] text-muted">{t.plans.live.empty}</p>
      ) : (
        <ul className="space-y-2" aria-label={t.plans.live.listLabel}>
          {others.map(({ row, distance }) => (
            <LiveRow key={row.user_id} row={row} person={lookup(row.user_id)} distance={distance} fromYou={reference?.mine ?? false} place={place} now={now} />
          ))}
        </ul>
      )}
      <p className="text-[13px] leading-snug text-faint">{t.plans.live.privacy}</p>
    </div>
  );
}

/** Kleine Pille in der Zeile einer Person: „Ist da“, „da gegen 20:15“ oder ehrlich „wollte 20:15 da sein“. */
function ArrivalTag({ tone, children }: { tone: "lime" | "glass"; children: ReactNode }) {
  return (
    <span
      data-testid="live-arrival"
      data-tone={tone}
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-bold whitespace-nowrap",
        tone === "lime" ? "bg-lime text-lime-ink" : "border border-white/15 bg-white/[0.06] text-muted",
      )}
    >
      {children}
    </span>
  );
}

/**
 * P13 Etappe 2b · „Bin gleich da“: eigene Ansage, wann man ungefähr da ist. Die Uhrzeit rechnet der Server; die
 * Gehzeit unter den Knöpfen ist nur eine Schätzung aus der Luftlinie und steht so da. Wer schon am Ort steht,
 * braucht nichts anzusagen.
 */
function ArrivalPicker({ planId, row, point, place, now }: { planId: string; row: PlanLiveLocation; point: LivePoint; place: LivePoint | null; now: Date }) {
  const arrival = useSetLiveArrival(planId);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const state = arrivalState(row.arrival_eta, now);

  if (isAtPlace({ ...point, accuracy_m: row.accuracy_m }, place)) {
    return (
      <StatusPill tone="lime" testId="live-arrival-mine">
        {t.plans.live.arrival.youAtPlace}
      </StatusPill>
    );
  }

  function choose(minutes: number | null) {
    arrival.mutate(minutes, {
      onSuccess: (eta) => {
        setEditing(false);
        toast.success(eta ? t.plans.live.arrival.saved(formatTime(new Date(eta))) : t.plans.live.arrival.cleared);
      },
      onError: (error) => toast.error(error),
    });
  }

  if (state !== "none" && !editing) {
    const time = formatTime(new Date(row.arrival_eta!));
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={state === "upcoming" ? "lime" : "glass"} testId="live-arrival-mine">
          {state === "upcoming" ? t.plans.live.arrival.mine(time) : t.plans.live.arrival.minePast(time)}
        </StatusPill>
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          {t.plans.live.arrival.change}
        </Button>
        <Button size="sm" variant="ghost" loading={arrival.isPending && arrival.variables === null} onClick={() => choose(null)}>
          {t.plans.live.arrival.clear}
        </Button>
      </div>
    );
  }

  const walk = place ? walkMinutes(distanceMeters(point, place)) : null;
  return (
    <fieldset className="space-y-2" data-testid="live-arrival-picker">
      <legend className="mb-2 text-sm font-semibold text-fg">{t.plans.live.arrival.question}</legend>
      <div className="flex flex-wrap gap-2">
        {ARRIVAL_CHOICES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            disabled={arrival.isPending}
            onClick={() => choose(minutes)}
            className={cn(
              "inline-flex h-10 items-center rounded-full border border-line-strong px-4 text-sm font-semibold text-fg transition-colors hover:border-lime hover:text-lime disabled:opacity-50",
              arrival.isPending && arrival.variables === minutes && "border-lime bg-lime text-lime-ink",
            )}
          >
            {t.plans.live.arrival.choice(minutes)}
          </button>
        ))}
      </div>
      {walk != null && <p className="text-[13px] leading-snug text-muted">{t.plans.live.arrival.walk(walk)}</p>}
    </fieldset>
  );
}

function LiveRow({
  row,
  person,
  distance,
  fromYou,
  place,
  now,
}: {
  row: PlanLiveLocation;
  person: Person | null;
  distance: number | null;
  fromYou: boolean;
  place: LivePoint | null;
  now: Date;
}) {
  const stale = isStale(row.updated_at, now);
  const away = distance == null ? null : (fromYou ? t.plans.live.fromYou : t.plans.live.fromPlace)(distanceLabel(distance));
  const there = isAtPlace(row, place);
  const arrival = there ? "none" : arrivalState(row.arrival_eta, now);
  return (
    <li data-testid="live-person" data-stale={stale || undefined} className={cn(PANEL_ITEM, "flex min-h-14 items-center gap-3 py-2 pr-3 pl-2.5")}>
      <Avatar person={person} size="sm" decorative />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold text-fg">{person?.display_name ?? t.states.formerMember}</span>
          {there && <ArrivalTag tone="lime">{t.plans.live.arrival.atPlace}</ArrivalTag>}
          {arrival !== "none" && (
            <ArrivalTag tone={arrival === "upcoming" ? "lime" : "glass"}>
              {(arrival === "upcoming" ? t.plans.live.arrival.eta : t.plans.live.arrival.etaPast)(formatTime(new Date(row.arrival_eta!)))}
            </ArrivalTag>
          )}
        </p>
        <p className="mt-0.5 text-[13px] text-muted">
          {t.plans.live.updated(formatAgo(row.updated_at, now))}
          {row.accuracy_m != null && row.accuracy_m > 100 && ` · ${t.plans.live.accuracy(row.accuracy_m)}`}
          {stale && <span className="ml-1.5 font-semibold text-amber">· {t.plans.live.stale}</span>}
        </p>
      </div>
      {away && (
        <span data-testid="live-distance" className={cn("shrink-0 text-right text-sm font-bold", stale ? "text-muted" : "text-lime")}>
          {away}
        </span>
      )}
    </li>
  );
}
