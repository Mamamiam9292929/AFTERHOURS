/**
 * P13 · Live-Standort nur während eines Plans. Reine Regeln ohne Browser-APIs, damit sie sich ohne DOM testen
 * lassen. Die gleichen Grenzen prüft der Server (`share_plan_live_location`); hier dienen sie nur der Anzeige
 * und dem sparsamen Senden.
 */

/** Teilen geht ab 2 Stunden vor Beginn … */
export const LIVE_BEFORE_MS = 2 * 60 * 60 * 1000;
/** … bis zum Ende, ohne Ende bis 4 Stunden nach Beginn. */
export const LIVE_AFTER_MS = 4 * 60 * 60 * 1000;
/** Eine Freigabe gilt höchstens 3 Stunden. */
export const LIVE_MAX_MS = 3 * 60 * 60 * 1000;
/** Ab hier zeigt die Planseite schon, wann das Teilen losgeht. */
export const LIVE_TEASER_MS = 12 * 60 * 60 * 1000;
/** Neue Position frühestens nach 20 s senden (Server: höchstens 240 je Stunde) … */
export const LIVE_MIN_GAP_MS = 20_000;
/** … und nur, wenn man sich mindestens so weit bewegt hat … */
export const LIVE_MIN_MOVE_M = 25;
/** … oder spätestens nach 90 s, damit „zuletzt vor …“ stimmt. */
export const LIVE_KEEPALIVE_MS = 90_000;
/** Ältere Positionen zeigt die App als „älter“ an. */
export const LIVE_STALE_MS = 10 * 60 * 1000;

export interface LivePlan {
  starts_at: string;
  ends_at: string | null;
  status: string;
}

export interface LivePoint {
  latitude: number;
  longitude: number;
}

export function liveWindow(plan: LivePlan): { start: Date; end: Date } {
  const starts = new Date(plan.starts_at).getTime();
  const end = plan.ends_at ? new Date(plan.ends_at).getTime() : starts + LIVE_AFTER_MS;
  return { start: new Date(starts - LIVE_BEFORE_MS), end: new Date(end) };
}

/**
 * Wo steht der Plan für den Live-Standort?
 *   hidden – zu weit weg, vorbei, abgesagt oder abgeschlossen: kein Bereich
 *   soon   – innerhalb von 12 Stunden vor dem Fenster: Hinweis, ab wann
 *   open   – Teilen möglich
 */
export function liveStage(plan: LivePlan, now: Date): "hidden" | "soon" | "open" {
  if (plan.status === "cancelled" || plan.status === "completed") return "hidden";
  const { start, end } = liveWindow(plan);
  const t = now.getTime();
  if (t >= end.getTime()) return "hidden";
  if (t >= start.getTime()) return "open";
  return start.getTime() - t <= LIVE_TEASER_MS ? "soon" : "hidden";
}

/** Bis wann eine jetzt begonnene Freigabe gilt (so rechnet auch der Server). */
export function shareUntil(plan: LivePlan, now: Date): Date {
  return new Date(Math.min(liveWindow(plan).end.getTime(), now.getTime() + LIVE_MAX_MS));
}

/** Luftlinie in Metern (Haversine). */
export function distanceMeters(a: LivePoint, b: LivePoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Entfernung zum Anzeigen: unter 50 m „nah“, bis 1 km auf 10 m, darüber in Kilometern mit einer Stelle. */
export function roundDistance(meters: number): { kind: "near" } | { kind: "m"; value: number } | { kind: "km"; value: number } {
  if (!Number.isFinite(meters) || meters < 50) return { kind: "near" };
  if (meters < 995) return { kind: "m", value: Math.round(meters / 10) * 10 };
  return { kind: "km", value: meters < 9_950 ? Math.round(meters / 100) / 10 : Math.round(meters / 1000) };
}

/** Soll eine neue Position zum Server? Erste immer; danach bei Bewegung oder als Lebenszeichen. */
export function shouldSend(last: (LivePoint & { at: number }) | null, next: LivePoint, now: number): boolean {
  if (!last) return true;
  const gap = now - last.at;
  if (gap < LIVE_MIN_GAP_MS) return false;
  if (gap >= LIVE_KEEPALIVE_MS) return true;
  return distanceMeters(last, next) >= LIVE_MIN_MOVE_M;
}

export function isStale(updatedAt: string, now: Date): boolean {
  return now.getTime() - new Date(updatedAt).getTime() > LIVE_STALE_MS;
}

/** P13 Etappe 2a · Abstand, ab dem zwei Personen auf dem Stadtplan auseinandergerückt werden (Pixel, Mitte zu Mitte; Marker sind 36 px groß). */
export const LIVE_MARKER_GAP = 40;

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Personen am selben Fleck (z. B. beide schon am Treffpunkt) sollen sich auf dem kleinen Stadtplan nicht
 * verdecken: Wer näher als `gap` Pixel beieinandersteht, wird zu einer Gruppe; die Gruppe wird auf einem
 * Kreis um ihre Mitte verteilt, mit mindestens `gap` Abstand zwischen Nachbarn. Einzelne bleiben, wo sie sind.
 * Reihenfolge der Ausgabe = Reihenfolge der Eingabe; die erste Person einer Gruppe steht oben (12 Uhr).
 */
export function spreadMarkers(points: ScreenPoint[], gap = LIVE_MARKER_GAP): ScreenPoint[] {
  const group = points.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < gap) group[find(j)] = find(i);
    }
  }
  const members = new Map<number, number[]>();
  points.forEach((_, i) => {
    const root = find(i);
    members.set(root, [...(members.get(root) ?? []), i]);
  });
  const out: ScreenPoint[] = points.map((p) => ({ x: p.x, y: p.y }));
  for (const list of members.values()) {
    if (list.length < 2) continue;
    const cx = list.reduce((s, i) => s + points[i]!.x, 0) / list.length;
    const cy = list.reduce((s, i) => s + points[i]!.y, 0) / list.length;
    // Sehne zwischen Nachbarn = gap → Radius gap / (2·sin(π/n)).
    const radius = gap / (2 * Math.sin(Math.PI / list.length));
    list.forEach((i, k) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * k) / list.length;
      out[i] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });
  }
  return out;
}
