// P11 · Englische Oberfläche: Sprachwahl (src/i18n/locale.ts) und Vollständigkeit des englischen Wörterbuchs.
// Die Wörterbücher importieren ohne Dateiendung und über „@/“ – ein kleiner Resolver-Hook ergänzt beides.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const src = pathToFileURL(new URL("../../src/", import.meta.url).pathname).href;
const hook = `
const SRC = ${JSON.stringify(src)};
export async function resolve(specifier, context, next) {
  let spec = specifier.startsWith("@/") ? SRC + specifier.slice(2) : specifier;
  const relative = spec.startsWith(".") || spec.startsWith("file:");
  if (relative && !/\\.[cm]?[jt]sx?$/.test(spec)) {
    try { return await next(spec + ".ts", context); } catch { /* weiter ohne Endung */ }
  }
  return next(spec, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);

const { pickLocale, intlLocale, localeSyncStep } = await import("../../src/i18n/locale.ts");
const { de } = await import("../../src/i18n/de/index.ts");
const { loadEnglishFull } = await import("../../src/i18n/en/index.ts");
const en = await loadEnglishFull();

test("Sprachwahl: eigene Wahl vor Browser-Sprache, sonst Deutsch", () => {
  assert.equal(pickLocale("en", ["de-DE"]), "en");
  assert.equal(pickLocale("de", ["en-US"]), "de");
  assert.equal(pickLocale(null, ["en-US", "de-DE"]), "en");
  assert.equal(pickLocale(null, ["fr-FR", "de-AT", "en"]), "de");
  assert.equal(pickLocale(null, ["fr-FR", "en_GB"]), "en");
  assert.equal(pickLocale("xx", ["fr", "es"]), "de");
  assert.equal(pickLocale(undefined, undefined), "de");
  assert.equal(intlLocale("en"), "en-GB");
  assert.equal(intlLocale("de"), "de-DE");
});

/** Alle Pfade mit Art des Werts: Text, Funktion (mit Parameterzahl), Liste (mit Länge), Objekt. */
function shape(value, path = "", out = new Map()) {
  if (typeof value === "function") out.set(path, `fn/${value.length}`);
  else if (Array.isArray(value)) {
    out.set(path, `array/${value.length}`);
    value.forEach((v, i) => shape(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) shape(v, path ? `${path}.${k}` : k, out);
  else out.set(path, typeof value);
  return out;
}

test("Englisch hat genau die Struktur von Deutsch (Schlüssel, Funktionen, Listenlängen)", () => {
  const a = shape(de);
  const b = shape(en);
  assert.deepEqual([...a.keys()].filter((k) => !b.has(k)), [], "fehlt auf Englisch");
  assert.deepEqual([...b.keys()].filter((k) => !a.has(k)), [], "nur auf Englisch");
  const differs = [...a].filter(([k, kind]) => b.get(k) !== kind && !(kind.startsWith("fn/") && b.get(k)?.startsWith("fn/")));
  assert.deepEqual(differs, []);
});

test("Englische Texte sind nicht leer und nicht einfach deutsch geblieben", () => {
  const texts = [];
  (function walk(v, path) {
    if (typeof v === "string") texts.push([path, v]);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  })(en, "");
  const deTexts = new Map();
  (function walk(v, path) {
    if (typeof v === "string") deTexts.set(path, v);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  })(de, "");
  // Leer nur, wo auch der deutsche Text leer ist.
  assert.deepEqual(texts.filter(([p, v]) => v.trim() === "" && (deTexts.get(p) ?? "").trim() !== ""), []);
  // Typisch deutsche Zeichen in englischen Texten deuten auf vergessene Übersetzung (Eigennamen ausgenommen).
  const ALLOWED = /München|Köln|Düsseldorf|Nürnberg|Lokal starten|KI-Assistent|Straße|Bahnstraße/;
  const leftovers = texts.filter(([, v]) => /[äöüßÄÖÜ„]/.test(v) && !ALLOWED.test(v));
  assert.deepEqual(leftovers, []);
});

test("Englische Funktionen liefern Text ohne „Uhr“ und ohne deutsche Pluralformen", () => {
  assert.equal(en.people(1), "1 person");
  assert.equal(en.people(3), "3 people");
  assert.equal(en.members(1), "1 member");
  assert.equal(en.settings.account.deleteConfirmWord, "DELETE");
  for (const [type, render] of Object.entries(en.notificationText)) {
    const view = render("Ana", { title: "Bowling", crew_name: "Weekend", starts_at: "2026-10-23T18:00:00Z", amount_cents: 1400, winner_title: "Bowling" });
    assert.equal(typeof view.title, "string", type);
    assert.doesNotMatch(`${view.title} ${view.body ?? ""}`, /\bUhr\b|\bhat\b|\bdeine?\b/, type);
  }
});

// P11 Etappe 2a: Abgleich mit der Sprache im Profil.
test("Sprache im Profil: speichern, übernehmen oder nichts tun", () => {
  // Konto kennt noch keine Sprache → die des Geräts speichern (eigene Wahl vor Browser-Sprache).
  assert.deepEqual(localeSyncStep(null, null, "en"), { kind: "save", locale: "en" });
  assert.deepEqual(localeSyncStep(null, "de", "de"), { kind: "save", locale: "de" });
  assert.deepEqual(localeSyncStep(undefined, "en", "en"), { kind: "save", locale: "en" });
  assert.deepEqual(localeSyncStep("fr", null, "de"), { kind: "save", locale: "de" }, "Unbekanntes im Konto zählt wie nichts");
  // Neues Gerät ohne eigene Wahl übernimmt die Sprache des Kontos.
  assert.deepEqual(localeSyncStep("en", null, "de"), { kind: "adopt", locale: "en" });
  assert.deepEqual(localeSyncStep("de", "xx", "en"), { kind: "adopt", locale: "de" }, "kaputte Wahl auf dem Gerät zählt nicht");
  // Gleich oder eigene Wahl auf dem Gerät → nichts (kein Neuladen, kein Hin und Her zwischen Geräten).
  assert.deepEqual(localeSyncStep("en", null, "en"), { kind: "none" });
  assert.deepEqual(localeSyncStep("en", "de", "de"), { kind: "none" });
  assert.deepEqual(localeSyncStep("de", "en", "en"), { kind: "none" });
  // Nach dem Übernehmen ist die Sprache die eigene Wahl: der zweite Start lädt nicht noch einmal neu.
  assert.deepEqual(localeSyncStep("en", "en", "en"), { kind: "none" });
});

test("P11 Etappe 2e: Benachrichtigungen zeigen „Stichwahl: …“ auf Englisch als „Runoff: …“", async () => {
  const created = en.notificationText.poll_created("Ana", { title: "Stichwahl: Bowling", runoff: true, auto: true });
  assert.equal(created.body, "Runoff: Bowling");
  assert.equal(en.notificationText.poll_vote("Ana", { title: "Stichwahl: Bowling" }).body, "Runoff: Bowling");
  assert.equal(en.notificationText.poll_vote("Ana", { title: "Bowling" }).body, "Bowling");
  assert.equal(de.notificationText.poll_vote("Ana", { title: "Stichwahl: Bowling" }).body, "Stichwahl: Bowling");
});

test("P45: Nachfrage an „Vielleicht“ hat eigenen Text, die normale Nachfrage bleibt", () => {
  const payload = { title: "Bowling", starts_at: "2026-11-20T19:00:00Z" };
  const plain = de.notificationText.plan_reminder("Bob", payload);
  assert.equal(plain.title, "Bob fragt: Bist du dabei?");
  assert.ok(plain.body.startsWith("Bowling · "));
  const maybe = de.notificationText.plan_reminder("Bob", { ...payload, maybe: true });
  assert.equal(maybe.title, "Bob fragt: Bist du jetzt dabei?");
  assert.ok(maybe.body.startsWith("Du hast „vielleicht“ gesagt · Bowling · "));
  assert.equal(en.notificationText.plan_reminder("Bob", { ...payload, maybe: true }).title, "Bob asks: are you in now?");
  assert.ok(en.notificationText.plan_reminder("Bob", { ...payload, maybe: true }).body.startsWith("You said maybe · Bowling · "));
  assert.equal(en.notificationText.plan_reminder("Bob", payload).title, "Bob asks: are you in?");
});

test("P42 Etappe 2: Hinweis, wenn jemand deinen Vorschlag rausnimmt – Termin oder Ort im Text", () => {
  const slot = de.notificationText.poll_reminder("Alice", { title: "Wann könnt ihr?", removed: true, date: "2026-11-21", time: "20:00" });
  assert.match(slot.title, /^Alice hat .*21\.? November, 20:00 wieder aus der Abstimmung genommen$/);
  assert.equal(slot.body, "Wann könnt ihr?");
  const noTime = de.notificationText.poll_reminder("Alice", { title: "Wann?", removed: true, date: "2026-11-21", time: null });
  assert.match(noTime.title, /21\.? November wieder aus/);
  assert.equal(de.notificationText.poll_reminder("Alice", { title: "Was machen wir?", removed: true, place: "Karaoke" }).title,
    "Alice hat Karaoke wieder aus der Abstimmung genommen");
  assert.equal(en.notificationText.poll_reminder("Alice", { title: "Was machen wir?", removed: true, place: "Karaoke" }).title,
    "Alice took Karaoke back out of the poll");
  assert.match(en.notificationText.poll_reminder("Alice", { title: "x", removed: true, date: "2026-11-21", time: "20:00" }).title, /November.*20:00 back out/);
  // Nachgereicht (P40) bleibt unverändert.
  assert.match(de.notificationText.poll_reminder("Bob", { title: "x", added: true, place: "Kino" }).title, /^Bob schlägt noch Kino vor/);
});

test("F7: Kern ohne Seitentexte, Seitentexte vollständig nachladbar – auf Deutsch und Englisch", async () => {
  const { deCore } = await import("../../src/i18n/de/core.ts");
  const { germanPageTexts } = await import("../../src/i18n/de/pages.ts");
  const { loadEnglish, englishPageTexts } = await import("../../src/i18n/en/index.ts");
  const pageKeys = Object.keys(de).filter((key) => !(key in deCore)).sort();
  // Diese Bereiche liegen nicht im Start-Bundle – jeder neue gehört bewusst hierher (und in den Router).
  assert.deepEqual(pageKeys, ["admin", "assistant", "crewMute", "landing", "notificationText", "planArrival", "planCapacity", "planCards", "planFeedback", "planGuests", "planHome", "planQuorum", "pollExtend", "pollOutcome", "pollSlot", "pollStanding", "privacy", "rewards", "settings"]);
  assert.deepEqual(Object.keys(germanPageTexts).sort(), pageKeys);
  assert.deepEqual(Object.keys(englishPageTexts).sort(), pageKeys);
  // Kern + nachgeladene Bereiche ergeben genau das ganze Wörterbuch.
  const deParts = { ...deCore };
  for (const key of pageKeys) deParts[key] = await germanPageTexts[key]();
  assert.deepEqual([...shape(deParts)].sort(), [...shape(de)].sort());
  const enCore = await loadEnglish();
  assert.deepEqual(Object.keys(enCore).sort(), Object.keys(deCore).sort(), "englischer Kern ohne Seitentexte");
  for (const key of pageKeys) assert.equal((await englishPageTexts[key]()).constructor, Object);
});

test("F8: Einstellungs-Texte nur dort, wo sie vorher geladen werden", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");
  const root = new URL("../../", import.meta.url).pathname;
  // Jede dieser Dateien wartet vor dem ersten Lesen auf `loadTexts("settings")` – bzw. nutzt nur den Typ.
  const allowed = new Map([
    ["src/features/profile/SettingsPage.tsx", "await loadTexts(\"settings\")"],
    ["src/features/onboarding/OnboardingPage.tsx", "await loadTexts(\"settings\")"],
    ["src/lib/push.ts", "await loadTexts(\"settings\")"],
    ["src/features/profile/notificationGroups.ts", "keyof typeof t.settings"],
  ]);
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  }
  await walk(join(root, "src"));
  const users = [];
  for (const file of files) {
    const name = relative(root, file);
    if (name.startsWith("src/i18n/")) continue;
    const source = await readFile(file, "utf8");
    if (!/\bt\.settings\b/.test(source)) continue;
    users.push(name);
    assert.ok(allowed.has(name), `${name} liest t.settings, lädt die Einstellungs-Texte aber nicht`);
    assert.ok(source.includes(allowed.get(name)), `${name}: ${allowed.get(name)} fehlt`);
  }
  assert.deepEqual(users.sort(), [...allowed.keys()].sort());
});

test("F9: Texte der Benachrichtigungen nur dort, wo sie vorher geladen werden – und fest im Push-Skript", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");
  const root = new URL("../../", import.meta.url).pathname;
  const { deCore } = await import("../../src/i18n/de/core.ts");
  assert.equal("text" in deCore.notifications, false, "Kern ohne Texte je Art");
  assert.equal("notificationText" in deCore, false);
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  }
  await walk(join(root, "src"));
  const users = [];
  for (const file of files) {
    const name = relative(root, file);
    if (name.startsWith("src/i18n/")) continue;
    const source = await readFile(file, "utf8");
    if (/\bt\.notifications\.text\b/.test(source)) assert.fail(`${name} liest noch t.notifications.text`);
    if (!/\bt\.notificationText\b/.test(source)) continue;
    users.push(name);
    assert.ok(source.includes('await loadTexts("notificationText")'), `${name} liest t.notificationText ohne loadTexts`);
  }
  assert.deepEqual(users, ["src/features/notifications/NotificationsPage.tsx"]);
  const router = await readFile(join(root, "src/app/router.tsx"), "utf8");
  assert.match(router, /NotificationsPage", \["notificationText"\]\)/, "Router lädt die Texte parallel zur Seite");
  const push = await readFile(join(root, "src/push/render.ts"), "utf8");
  assert.match(push, /from "@\/i18n\/de\/notificationText"/);
  assert.match(push, /from "@\/i18n\/en\/notificationText"/);
  // Deutsch und Englisch kennen dieselben Arten.
  const { notificationText: deText } = await import("../../src/i18n/de/notificationText.ts");
  const { notificationText: enText } = await import("../../src/i18n/en/notificationText.ts");
  assert.deepEqual(Object.keys(enText).sort(), Object.keys(deText).sort());
  assert.ok(Object.keys(deText).length >= 28, "alle Arten in einer Datei");
});

test("F10: Texte der Planseiten-Karten nur dort, wo sie vorher geladen werden – nicht mehr im Kern", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");
  const root = new URL("../../", import.meta.url).pathname;
  const { deCore } = await import("../../src/i18n/de/core.ts");
  const moved = ["booking", "rides", "photos", "live", "items", "expenses"];
  for (const key of moved) assert.equal(key in deCore.plans, false, `t.plans.${key} liegt nicht mehr im Kern`);
  assert.equal("planCards" in deCore, false);
  const { planCards: deCards } = await import("../../src/i18n/de/planCards.ts");
  const { planCards: enCards } = await import("../../src/i18n/en/planCards.ts");
  // P37: „Zwischenstand teilen“ und P46: Antwortfrist kamen neu dazu und lagen nie im Kern.
  assert.deepEqual(Object.keys(deCards).sort(), [...moved, "standing", "answerBy"].sort());
  assert.deepEqual(Object.keys(enCards).sort(), [...moved, "standing", "answerBy"].sort());
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  }
  await walk(join(root, "src"));
  const users = [];
  const old = new RegExp(`\\bt\\.plans\\.(${moved.join("|")})\\b`);
  for (const file of files) {
    const name = relative(root, file);
    if (name.startsWith("src/i18n/")) continue;
    const source = await readFile(file, "utf8");
    if (old.test(source)) assert.fail(`${name} liest noch ${source.match(old)[0]}`);
    // Nur Code zählt – ein Verweis im Kommentar (src/lib/bring.ts) lädt nichts.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (!/\bt\.planCards\b/.test(code)) continue;
    users.push(name);
    assert.ok(source.includes('await loadTexts("planCards")'), `${name} liest t.planCards ohne loadTexts`);
  }
  assert.deepEqual(users.sort(), [
    "src/features/plans/BookingPanel.tsx",
    "src/features/plans/BringPanel.tsx",
    "src/features/plans/ExpensesPanel.tsx",
    "src/features/plans/LiveMap.tsx",
    "src/features/plans/LivePanel.tsx",
    "src/features/plans/PhotosPanel.tsx",
    "src/features/plans/PlanAnswerBy.tsx",
    "src/features/plans/PlanDetailPage.tsx",
    "src/features/plans/RidesPanel.tsx",
  ]);
  const router = await readFile(join(root, "src/app/router.tsx"), "utf8");
  assert.match(router, /PlanDetailPage", \["planCards"\]\)/, "Router lädt die Texte parallel zur Planseite");
});
