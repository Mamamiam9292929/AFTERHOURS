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

const { pickLocale, intlLocale } = await import("../../src/i18n/locale.ts");
const { de } = await import("../../src/i18n/de/index.ts");
const { loadEnglish } = await import("../../src/i18n/en/index.ts");
const en = await loadEnglish();

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
  for (const [type, render] of Object.entries(en.notifications.text)) {
    const view = render("Ana", { title: "Bowling", crew_name: "Weekend", starts_at: "2026-10-23T18:00:00Z", amount_cents: 1400, winner_title: "Bowling" });
    assert.equal(typeof view.title, "string", type);
    assert.doesNotMatch(`${view.title} ${view.body ?? ""}`, /\bUhr\b|\bhat\b|\bdeine?\b/, type);
  }
});
