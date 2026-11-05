import type { de, PageTexts } from "../de";
import type { deCore } from "../de/core";

/**
 * P11 · Englisches Wörterbuch. Wird nur geladen, wenn die Oberfläche englisch ist (eigene Chunks je Datei,
 * damit kein Seiten-Chunk über das Größenbudget wächst). Jede Datei prüft ihre Struktur mit
 * `satisfies typeof <deutsch>` – fehlt ein Schlüssel, bricht der TypeScript-Lauf der CI ab.
 *
 * F7 · `loadEnglish` lädt nur den Kern. Seitentexte kommen wie auf Deutsch erst mit ihrer Seite
 * (`loadTexts` in src/i18n/index.ts); `loadEnglishFull` ist für die Unit-Tests.
 */
export async function loadEnglish(): Promise<typeof deCore> {
  const [common, auth, crews, discover, enums, home, misc, plans, polls] = await Promise.all([
    import("./common"),
    import("./auth"),
    import("./crews"),
    import("./discover"),
    import("./enums"),
    import("./home"),
    import("./misc"),
    import("./plans"),
    import("./polls"),
  ]);
  return {
    ...common.common,
    validation: common.validation,
    errors: common.errors,
    enums: enums.enums,
    auth: auth.auth,
    home: home.home,
    onboarding: home.onboarding,
    discover: discover.discover,
    crews: crews.crews,
    polls: polls.polls,
    plans: plans.plans,
    notifications: misc.notifications,
    profile: misc.profile,
  } satisfies typeof deCore;
}

/** Englische Seitentexte – je Bereich ein eigener Chunk. */
export const englishPageTexts: { [K in PageTexts]: () => Promise<(typeof de)[K]> } = {
  landing: () => import("./landing").then((m) => m.landing),
  rewards: () => import("./rewards").then((m) => m.rewards),
  privacy: () => import("./privacy").then((m) => m.privacy),
  admin: () => import("./admin").then((m) => m.admin),
  assistant: () => import("./assistant").then((m) => m.assistant),
  settings: () => import("./settings").then((m) => m.settings),
  planGuests: () => import("./planGuests").then((m) => m.planGuests),
  planQuorum: () => import("./planQuorum").then((m) => m.planQuorum),
};

/** Ganzes englisches Wörterbuch (Kern und alle Seitentexte) – für die Unit-Tests. */
export async function loadEnglishFull(): Promise<typeof de> {
  const core = await loadEnglish();
  const entries = await Promise.all(
    (Object.keys(englishPageTexts) as PageTexts[]).map(async (name) => [name, await englishPageTexts[name]()] as const),
  );
  return { ...core, ...Object.fromEntries(entries) } as typeof de;
}
