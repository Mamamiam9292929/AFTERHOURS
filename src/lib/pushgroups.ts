/*
 * P4 Etappe 3 · Je Gerät wählen, was als Push ankommt.
 *
 * Auf dem Server steht je Gerät eine Liste stummgeschalteter Benachrichtigungsarten
 * (`push_subscriptions.muted_types`). Die Einstellungen zeigen dieselben Gruppen wie für die App
 * (src/features/profile/notificationGroups.ts); diese Helfer rechnen zwischen Gruppen und Arten.
 * Ohne Importe, damit der Unit-Test sie direkt laden kann.
 */

export interface PushGroup {
  key: string;
  types: readonly string[];
}

/**
 * „Nur das Wichtigste“: was einen Tipp verlangt oder den Abend selbst betrifft – neue Abstimmungen,
 * Ergebnisse, Pläne, der Tag des Plans und spontane Fragen.
 */
export const ESSENTIAL_GROUPS: readonly string[] = ["polls", "results", "plans", "dayReminders", "spontaneous"];

/** Kommt diese Gruppe auf dem Gerät an? Ja, solange keine ihrer Arten stummgeschaltet ist. */
export function isGroupOnDevice(muted: readonly string[], types: readonly string[]): boolean {
  return !types.some((type) => muted.includes(type));
}

/** Gruppe auf dem Gerät an- oder ausschalten; andere Arten bleiben, wie sie sind. Sortiert, ohne Dubletten. */
export function setGroupOnDevice(muted: readonly string[], types: readonly string[], on: boolean): string[] {
  const rest = muted.filter((type) => !types.includes(type));
  return [...new Set(on ? rest : [...rest, ...types])].sort();
}

/** Stummliste für „Alles“ bzw. „Nur das Wichtigste“. */
export function devicePreset(groups: readonly PushGroup[], preset: "all" | "essentials"): string[] {
  if (preset === "all") return [];
  return [...new Set(groups.filter((group) => !ESSENTIAL_GROUPS.includes(group.key)).flatMap((group) => group.types))].sort();
}

/** Ist die Stummliste genau diese Vorgabe? (Für den gedrückten Zustand der Knöpfe.) */
export function matchesPreset(groups: readonly PushGroup[], muted: readonly string[], preset: "all" | "essentials"): boolean {
  return groups.every((group) => isGroupOnDevice(muted, group.types) === (preset === "all" || ESSENTIAL_GROUPS.includes(group.key)));
}
