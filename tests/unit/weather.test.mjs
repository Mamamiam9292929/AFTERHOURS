// P5 · Wetter zum Plan (src/lib/weather.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTemperature, outdoorHint, weatherKind } from "../../src/lib/weather.ts";

test("WMO-Codes → Art, Unbekanntes bleibt unbekannt", () => {
  const cases = [
    [0, "clear"], [1, "partly"], [2, "partly"], [3, "cloudy"], [45, "fog"], [48, "fog"],
    [51, "drizzle"], [55, "drizzle"], [56, "freezing"], [66, "freezing"], [61, "rain"], [65, "rain"],
    [71, "snow"], [77, "snow"], [85, "snow"], [80, "showers"], [82, "showers"], [95, "thunder"], [99, "thunder"],
    [4, "unknown"], [100, "unknown"], [null, "unknown"], [undefined, "unknown"],
  ];
  for (const [code, kind] of cases) assert.equal(weatherKind(code), kind, `Code ${code}`);
});

test("Temperatur gerundet, ohne „-0“", () => {
  assert.equal(formatTemperature(14.2), "14 °C");
  assert.equal(formatTemperature(14.5), "15 °C");
  assert.equal(formatTemperature(-0.4), "0 °C");
  assert.equal(formatTemperature(-2.6), "-3 °C");
});

const w = (extra) => ({ setting: "outdoor", precipitation_probability: 10, weather_code: 1, temperature: 18, ...extra });

test("Hinweis nur draußen", () => {
  assert.equal(outdoorHint(w({ setting: "indoor", weather_code: 95 })), null);
  assert.equal(outdoorHint(w({ setting: null, precipitation_probability: 90 })), null);
  assert.equal(outdoorHint(w({ setting: "both", precipitation_probability: 90 })), "rain");
});

test("Hinweis bei klaren Signalen – Gewitter vor Schnee vor Regen vor Kälte", () => {
  assert.equal(outdoorHint(w({})), null);
  assert.equal(outdoorHint(w({ weather_code: 95, precipitation_probability: 90, temperature: 1 })), "thunder");
  assert.equal(outdoorHint(w({ weather_code: 73, temperature: -1 })), "snow");
  assert.equal(outdoorHint(w({ weather_code: 66 })), "snow");
  assert.equal(outdoorHint(w({ precipitation_probability: 50 })), "rain");
  assert.equal(outdoorHint(w({ precipitation_probability: 49 })), null);
  assert.equal(outdoorHint(w({ weather_code: 61, precipitation_probability: null })), "rain");
  assert.equal(outdoorHint(w({ temperature: 3 })), "cold");
  assert.equal(outdoorHint(w({ temperature: null })), null);
});
