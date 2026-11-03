// F6 · AFTERHOURS in Zahlen: Zählung je Bereich, Datenbank-Kennzahlen und Ersetzen im README.
// Läuft ohne Netz: node --test tests/unit/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { END, START, ersetzen, markdown, zahlen } from "../../scripts/zahlen.mjs";

const dateien = {
  "src/main.tsx": "import x from 'y';\n\nconsole.log(x);\n",
  "src/styles/index.css": ":root {}\n",
  "src/i18n/de/common.json": "{}\n",
  "supabase/migrations/1_a.sql":
    "create table public.crews (id uuid);\ncreate table if not exists app_private.rate (k text);\ncreate or replace function public.join_crew() returns void as $$ $$;\n",
  "supabase/migrations/2_b.sql": "create or replace function public.join_crew() returns void as $$ $$;\ncreate function app_private.helper() returns void as $$ $$;\n",
  "supabase/functions/places/index.ts": "a\nb\n",
  "supabase/functions/places/osm_test.ts": "t\n",
  "supabase/functions/_shared/cors.ts": "c\n",
  "supabase/tests/database/01_x.test.sql": "select plan(1);\n",
  "tests/unit/a.test.mjs": "x\ny\n",
  "README.md": "egal\n",
};
const z = zahlen(Object.keys(dateien), (f) => dateien[f]);
const bereich = (name) => z.bereiche.find((b) => b.name === name);

test("Zeilen je Bereich ohne Leerzeilen, nur passende Dateiendungen", () => {
  assert.deepEqual(bereich("App (Oberfläche)"), { name: "App (Oberfläche)", dateien: 2, zeilen: 3 });
  assert.equal(bereich("Datenbank (Migrationen)").zeilen, 5);
  assert.equal(bereich("Edge Functions").dateien, 2, "Funktion und _shared, ohne _test.ts");
  assert.equal(bereich("Tests App und Funktionen").zeilen, 3, "Unit-Test und Deno-Test");
  assert.equal(z.codeZeilen, 3 + 5 + 3);
  assert.equal(z.testZeilen, 1 + 3);
});

test("Datenbank: Tabellen und RPCs einmalig gezählt, nur public als RPC", () => {
  assert.equal(z.migrationen, 2);
  assert.equal(z.tabellen, 2);
  assert.equal(z.rpcs, 1, "join_crew zweimal angelegt, helper liegt in app_private");
  assert.equal(z.edgeFunctions, 1, "_shared ist keine Function");
  assert.equal(z.pgtap, 1);
  assert.equal(z.unit, 1);
});

test("Markdown: deutsche Tausender, Markierungen, PR-Zeile nur wenn angegeben", () => {
  const groß = { ...z, codeZeilen: 38743 };
  const md = markdown(groß, { stand: "02.11.2026" });
  assert.ok(md.startsWith(START) && md.endsWith(END));
  assert.match(md, /\*\*38\.743\*\*/);
  assert.match(md, /Stand: 02\.11\.2026/);
  assert.doesNotMatch(md, /Pull Requests/);
  assert.match(markdown(z, { prs: 1540 }), /\| Pull Requests gemergt \| 1\.540 \|/);
});

test("Ersetzen: nur zwischen den Markierungen, ohne Markierungen ein Fehler", () => {
  const alt = `oben\n${START}\nalt\n${END}\nunten\n`;
  assert.equal(ersetzen(alt, `${START}\nneu\n${END}`), `oben\n${START}\nneu\n${END}\nunten\n`);
  assert.throws(() => ersetzen("ohne", "x"), /Markierungen/);
});

test("README enthält die Markierungen genau einmal", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  assert.equal(readme.split(START).length, 2);
  assert.equal(readme.split(END).length, 2);
});
