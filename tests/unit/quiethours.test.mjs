// P49 · Nachtruhe fürs Handy (src/lib/quiethours.ts) – gleiche Regel wie app_private.in_quiet_hours.
import assert from "node:assert/strict";
import { test } from "node:test";
import { berlinHour, inQuietHours, QUIET_PRESETS, quietFromSettings, quietNow, samePreset } from "../../src/lib/quiethours.ts";
import { settings as de } from "../../src/i18n/de/settings.ts";
import { settings as en } from "../../src/i18n/en/settings.ts";

test("Fenster über Mitternacht und am Tag", () => {
  const night = { from: 23, to: 8 };
  assert.equal(inQuietHours(night, 23), true);
  assert.equal(inQuietHours(night, 0), true);
  assert.equal(inQuietHours(night, 7), true);
  assert.equal(inQuietHours(night, 8), false, "„bis 8“ heißt: um 8 ist Schluss");
  assert.equal(inQuietHours(night, 22), false);
  const day = { from: 13, to: 15 };
  assert.equal(inQuietHours(day, 14), true);
  assert.equal(inQuietHours(day, 15), false);
  assert.equal(inQuietHours({ from: 0, to: 9 }, 0), true);
  assert.equal(inQuietHours(null, 3), false);
});

test("Berliner Stunde, auch in der Sommerzeit", () => {
  assert.equal(berlinHour(new Date("2026-11-12T22:30:00Z")), 23);
  assert.equal(berlinHour(new Date("2026-07-01T21:30:00Z")), 23);
  assert.equal(berlinHour(new Date("2026-11-12T23:10:00Z")), 0);
  assert.equal(quietNow({ from: 23, to: 8 }, new Date("2026-07-01T21:30:00Z")), 8, "gerade Nachtruhe, bis 8");
  assert.equal(quietNow({ from: 23, to: 8 }, new Date("2026-07-01T06:30:00Z")), null, "8:30 in Berlin");
});

test("Einstellung aus der Datenbank", () => {
  assert.deepEqual(quietFromSettings(23, 8), { from: 23, to: 8 });
  assert.deepEqual(quietFromSettings(0, 9), { from: 0, to: 9 }, "0 ist eine gültige Stunde");
  assert.equal(quietFromSettings(null, null), null);
  assert.equal(quietFromSettings(undefined, undefined), null, "ältere Antwort ohne Spalten");
  assert.equal(quietFromSettings(8, 8), null);
  assert.equal(quietFromSettings(24, 8), null);
  assert.equal(samePreset(null, null), true);
  assert.equal(samePreset({ from: 23, to: 8 }, { from: 23, to: 8 }), true);
  assert.equal(samePreset({ from: 23, to: 8 }, null), false);
});

test("Texte für jede Auswahl in beiden Sprachen", () => {
  for (const texts of [de, en]) {
    for (const preset of QUIET_PRESETS) assert.ok(texts.quiet.range(preset.from, preset.to).length > 0);
    assert.ok(texts.quiet.until(8).includes("8"));
  }
  assert.equal(de.quiet.range(23, 8), "23–8 Uhr");
  assert.equal(en.quiet.range(23, 8), "11 pm – 8 am");
  assert.equal(en.quiet.range(0, 9), "midnight – 9 am");
});
