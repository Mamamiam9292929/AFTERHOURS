/**
 * P35 · Crew stummschalten. Die eigene Zeile aus `crew_push_mutes` (oder keine) wird zum Stand der Karte –
 * gleiche Regel wie `app_private.queue_push`: ohne Ende stumm, mit Ende nur bis dahin, danach wieder laut.
 */
export type CrewMuteMode = "8h" | "week" | "always";
export const CREW_MUTE_MODES: readonly CrewMuteMode[] = ["8h", "week", "always"];

export type CrewMuteState =
  | { kind: "on" }
  | { kind: "always" }
  /** `sameDay`: Ende heute (Berliner Zeit) – dann reicht die Uhrzeit. */
  | { kind: "until"; until: Date; sameDay: boolean };

const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

export function crewMuteState(row: { muted_until: string | null } | null | undefined, now: Date): CrewMuteState {
  if (!row) return { kind: "on" };
  if (row.muted_until === null) return { kind: "always" };
  const until = new Date(row.muted_until);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return { kind: "on" };
  return { kind: "until", until, sameDay: berlinDay.format(until) === berlinDay.format(now) };
}

/**
 * P35 Etappe 2 · Stand je Crew aus allen eigenen Zeilen (Crew-Liste, Kopf der Crew-Seite).
 * Nur Crews, die jetzt stumm sind – abgelaufene Zeilen fallen weg wie in `app_private.queue_push`.
 */
export function mutedCrews(rows: readonly { crew_id: string; muted_until: string | null }[] | null | undefined, now: Date): Map<string, CrewMuteState> {
  const map = new Map<string, CrewMuteState>();
  for (const row of rows ?? []) {
    const state = crewMuteState(row, now);
    if (state.kind !== "on") map.set(row.crew_id, state);
  }
  return map;
}

/** Welche Dauer ist gerade gewählt? „Bis ich’s ändere“ eindeutig; bei begrenzter Stille nach der Restzeit (über 8 h = Woche). */
export function activeCrewMuteMode(state: CrewMuteState, now: Date): CrewMuteMode | null {
  if (state.kind === "on") return null;
  if (state.kind === "always") return "always";
  return state.until.getTime() - now.getTime() > 8 * 3_600_000 + 60_000 ? "week" : "8h";
}
