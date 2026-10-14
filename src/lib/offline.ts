import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

/*
 * W4 Etappe 2 · Pläne offline lesbar.
 *
 * Was du zuletzt gesehen hast (Pläne, Crews, Namen der Mitglieder, Orte deiner Pläne, Abstimmungen),
 * liegt zusätzlich im Speicher dieses Geräts (localStorage) – nur für die angemeldete Person, höchstens
 * 7 Tage alt, höchstens ~1,5 MB. Beim Abmelden und beim Löschen des Kontos wird er sofort gelöscht.
 * Nichts davon verlässt das Gerät; der Service Worker sieht diese Daten nie.
 *
 * Gelesen wird er nur ohne Netz (Start offline oder Netz bricht weg): Dann füllt er die leeren Abfragen,
 * und der Offline-Streifen nennt die Uhrzeit, von der der Stand stammt. Mit Netz lädt die App wie gewohnt
 * und überschreibt ihn – online blitzt nie ein veralteter Stand auf.
 */

const KEY = "afterhours.offline";
const VERSION = 1;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_CHARS = 1_500_000;
const SAVE_DELAY_MS = 800;

interface Entry {
  key: QueryKey;
  updatedAt: number;
  data: unknown;
}
interface Snapshot {
  v: number;
  userId: string;
  /** jüngster Ladezeitpunkt der gespeicherten Abfragen */
  savedAt: number;
  entries: Entry[];
}

/**
 * Welche Abfragen auf dem Gerät bleiben – in dieser Reihenfolge, falls der Platz knapp wird.
 * Bewusst nicht: Einladungslinks (Tokens), Chat, Benachrichtigungen, Einstellungen, Admin, Suche.
 */
function priority(key: QueryKey, userId: string): number | null {
  const [root, second] = key as unknown[];
  if (root === "plans" && key.length <= 2) return key.length === 1 ? 0 : 1;
  if (root === "crews" && key.length === 1) return 2;
  if (root === "profile" && second === userId && key.length === 2) return 3;
  if (root === "polls" && key.length <= 2) return key.length === 1 ? 4 : 6;
  if (root === "activities" && key.length === 2 && second !== "search" && typeof second === "string") return 5;
  if (root === "people" && key.length === 1) return 7;
  return null;
}

// Map (z. B. die Namensliste) übersteht JSON nicht von selbst.
const replacer = (_: string, value: unknown) => (value instanceof Map ? { __map: [...value.entries()] } : value);
const reviver = (_: string, value: unknown) =>
  value && typeof value === "object" && Array.isArray((value as { __map?: unknown }).__map) ? new Map((value as { __map: [unknown, unknown][] }).__map) : value;

let userId: string | null = null;
let client: QueryClient | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let restoredAt: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function read(): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw, reviver) as Snapshot;
    return snapshot?.v === VERSION && Array.isArray(snapshot.entries) ? snapshot : null;
  } catch {
    return null;
  }
}

function save(): void {
  timer = null;
  if (!client || !userId) return;
  const owner = userId;
  const now = Date.now();
  // Zusammenführen statt überschreiben: Wer die App direkt auf einer Planseite öffnet, lädt die Liste
  // nicht – der gespeicherte Stand der Liste bleibt trotzdem erhalten.
  const merged = new Map<string, Entry>();
  const stored = read();
  if (stored?.userId === owner) {
    for (const entry of stored.entries) if (now - entry.updatedAt <= MAX_AGE_MS) merged.set(JSON.stringify(entry.key), entry);
  }
  for (const query of client.getQueryCache().getAll() as Query[]) {
    if (query.state.status !== "success" || query.state.data === undefined) continue;
    merged.set(JSON.stringify(query.queryKey), { key: query.queryKey, updatedAt: query.state.dataUpdatedAt, data: query.state.data });
  }
  const picked = [...merged.values()]
    .map((entry) => ({ entry, rank: priority(entry.key, owner) }))
    .filter((item): item is { entry: Entry; rank: number } => item.rank !== null)
    .sort((a, b) => a.rank - b.rank || b.entry.updatedAt - a.entry.updatedAt);
  const entries: Entry[] = [];
  let size = 0;
  for (const { entry } of picked) {
    const length = JSON.stringify(entry, replacer).length;
    if (size + length > MAX_CHARS) continue;
    size += length;
    entries.push(entry);
  }
  if (entries.length === 0) return;
  try {
    // „Stand von …“ = wann zuletzt etwas davon frisch aus dem Netz kam, nicht wann gespeichert wurde.
    const savedAt = Math.max(...entries.map((entry) => entry.updatedAt));
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, userId: owner, savedAt, entries } satisfies Snapshot, replacer));
  } catch {
    /* Speicher voll oder gesperrt (privates Fenster) – dann eben ohne Offline-Stand. */
  }
}

function removeStored(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nichts zu tun */
  }
}

/** Gespeicherten Stand in leere Abfragen füllen – nur ohne Netz, damit online nie Veraltetes aufblitzt. */
function restore(): void {
  if (!client || !userId || navigator.onLine) return;
  const snapshot = read();
  if (!snapshot) return;
  if (snapshot.userId !== userId || Date.now() - snapshot.savedAt > MAX_AGE_MS) {
    // Fremder oder zu alter Stand: weg damit, nie anzeigen.
    removeStored();
    return;
  }
  let filled = 0;
  for (const entry of snapshot.entries) {
    if (client.getQueryData(entry.key) !== undefined) continue;
    client.setQueryData(entry.key, entry.data, { updatedAt: entry.updatedAt });
    filled++;
  }
  if (filled > 0) {
    restoredAt = snapshot.savedAt;
    emit();
  }
}

/**
 * Nach der Anmeldung (bzw. beim Start mit gespeicherter Sitzung) aufrufen – vor dem ersten Rendern der
 * geschützten Seiten. Ohne Netz füllt der Gerätespeicher leere Abfragen (auch, wenn das Netz erst später
 * wegbricht); ab dann merkt sich die App jede frisch geladene Abfrage aus der Liste oben.
 */
export function startOfflineCache(queryClient: QueryClient, owner: string): void {
  if (userId === owner && client === queryClient) return;
  stopOfflineCache();
  userId = owner;
  client = queryClient;

  const stored = read();
  if (stored && stored.userId !== owner) removeStored();
  restore();
  window.addEventListener("offline", restore);

  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (priority(event.query.queryKey, owner) === null) return;
    // Frische Daten aus dem Netz: der angezeigte Stand ist nicht mehr „gespeichert“.
    if (restoredAt !== null && !event.action.manual) {
      restoredAt = null;
      emit();
    }
    if (timer === null) timer = setTimeout(save, SAVE_DELAY_MS);
  });
  unsubscribe = () => {
    unsubscribeCache();
    window.removeEventListener("offline", restore);
  };
}

export function stopOfflineCache(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  userId = null;
  client = null;
  if (restoredAt !== null) {
    restoredAt = null;
    emit();
  }
}

/** Beim Abmelden und Löschen des Kontos: nichts von dieser Person bleibt auf dem Gerät. */
export function clearOfflineCache(): void {
  stopOfflineCache();
  removeStored();
}

/** Zeitpunkt des angezeigten gespeicherten Stands – `null`, sobald frische Daten aus dem Netz da sind. */
export function useOfflineSnapshotTime(): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => restoredAt,
    () => null,
  );
}
