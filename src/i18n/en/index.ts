import type { de } from "../de";

/**
 * P11 · Englisches Wörterbuch. Wird nur geladen, wenn die Oberfläche englisch ist (eigene Chunks je Datei,
 * damit kein Seiten-Chunk über das Größenbudget wächst). Jede Datei prüft ihre Struktur mit
 * `satisfies typeof <deutsch>` – fehlt ein Schlüssel, bricht der TypeScript-Lauf der CI ab.
 */
export async function loadEnglish(): Promise<typeof de> {
  const [common, auth, crews, discover, enums, home, landing, misc, plans, polls] = await Promise.all([
    import("./common"),
    import("./auth"),
    import("./crews"),
    import("./discover"),
    import("./enums"),
    import("./home"),
    import("./landing"),
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
    landing: landing.landing,
    home: home.home,
    onboarding: home.onboarding,
    discover: discover.discover,
    crews: crews.crews,
    polls: polls.polls,
    plans: plans.plans,
    notifications: misc.notifications,
    rewards: misc.rewards,
    profile: misc.profile,
    settings: misc.settings,
    privacy: misc.privacy,
    admin: misc.admin,
    assistant: misc.assistant,
  } satisfies typeof de;
}
