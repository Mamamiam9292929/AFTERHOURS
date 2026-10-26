/**
 * V2 Etappe 3i · Jede Crew hat ihre eigene Farbwelt (Aurora je Crew): zwei Lichter aus Violett, Pink,
 * Lime und Amber. Fest aus der Crew-ID abgeleitet, damit eine Crew auf jedem Gerät und bei jedem Besuch
 * gleich aussieht – ohne Spalte in der Datenbank.
 */
export const CREW_WORLDS = ["violet", "pink", "lime", "amber"] as const;
export type CrewWorld = (typeof CREW_WORLDS)[number];

export function crewWorld(crewId: string): CrewWorld {
  // FNV-1a über die ID: gleichmäßig verteilt, schnell, ohne Abhängigkeit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < crewId.length; i++) {
    hash ^= crewId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return CREW_WORLDS[(hash >>> 0) % CREW_WORLDS.length];
}

/** Was auf der Crew-Zeile hervorgehoben wird: laufende Abstimmung vor anstehendem Plan vor Ruhe. */
export type CrewPulse = "polls" | "plans" | "quiet";

export function crewPulse(openPolls: number, upcomingPlans: number): CrewPulse {
  if (openPolls > 0) return "polls";
  if (upcomingPlans > 0) return "plans";
  return "quiet";
}
