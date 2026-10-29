// P11 Etappe 2c · Termine von „Wann könnt ihr?“ in der Sprache der Oberfläche (src/lib/datelabel.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { dateLabel, germanDateLabel, localizeDateOptions, localizedDateTitle } from "../../src/lib/datelabel.ts";

test("deutscher Titel genau wie app_private.german_date_label auf dem Server", () => {
  assert.equal(germanDateLabel("2026-10-17"), "Samstag, 17. Oktober");
  assert.equal(germanDateLabel("2026-11-02"), "Montag, 2. November");
  assert.equal(germanDateLabel("2026-03-01"), "Sonntag, 1. März");
  assert.equal(germanDateLabel("2028-02-29"), "Dienstag, 29. Februar", "Schaltjahr");
  assert.equal(germanDateLabel("2026-02-30"), null, "ungültiges Datum");
  assert.equal(germanDateLabel("17.10.2026"), null);
});

test("englisch britisch ohne Komma und ohne Punkt", () => {
  assert.equal(dateLabel("2026-10-17", "en"), "Saturday 17 October");
  assert.equal(dateLabel("2026-12-31", "en"), "Thursday 31 December");
  assert.equal(dateLabel("2026-10-17", "de"), "Samstag, 17. Oktober");
});

test("nur der Titel vom Server wird übersetzt", () => {
  assert.equal(localizedDateTitle("Samstag, 17. Oktober", "2026-10-17", "en"), "Saturday 17 October");
  assert.equal(localizedDateTitle("Samstag, 17. Oktober", "2026-10-17", "de"), "Samstag, 17. Oktober");
  assert.equal(localizedDateTitle("Bowling", "2026-10-17", "en"), "Bowling", "eigener Titel bleibt");
  assert.equal(localizedDateTitle("Freitag, 16. Oktober", "2026-10-17", "en"), "Freitag, 16. Oktober", "passt nicht zum Datum – bleibt");
  assert.equal(localizedDateTitle("Samstag, 17. Oktober", null, "en"), "Samstag, 17. Oktober", "ohne Datum bleibt");
});

test("Abstimmung: nur „Wann könnt ihr?“ und nur auf Englisch, sonst dieselben Objekte", () => {
  const options = [
    { id: "a", title: "Freitag, 16. Oktober", proposed_date: "2026-10-16", proposed_time: "20:00" },
    { id: "b", title: "Samstag, 17. Oktober", proposed_date: "2026-10-17", proposed_time: null },
  ];
  const en = localizeDateOptions("date", options, "en");
  assert.deepEqual(en.map((o) => o.title), ["Friday 16 October", "Saturday 17 October"]);
  assert.equal(en[0].proposed_time, "20:00", "übrige Felder bleiben");
  assert.equal(options[0].title, "Freitag, 16. Oktober", "Original unverändert");
  assert.equal(localizeDateOptions("date", options, "de"), options);
  assert.equal(localizeDateOptions("place", options, "en"), options);
  assert.equal(localizeDateOptions(undefined, options, "en"), options);
  const own = [{ id: "c", title: "Bowling", proposed_date: "2026-10-17" }];
  assert.equal(localizeDateOptions("date", own, "en")[0], own[0], "eigener Titel: gleiches Objekt");
});
