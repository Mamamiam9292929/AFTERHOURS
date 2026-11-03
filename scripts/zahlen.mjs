#!/usr/bin/env node
/*
 * AFTERHOURS in Zahlen (Roadmap F6).
 *
 * Zählt aus den Dateien im Git-Stand: Codezeilen je Bereich (ohne Leerzeilen), Dateien,
 * Migrationen, Tabellen, Datenbank-Funktionen, Edge Functions und Testdateien.
 * Nichts wird geschätzt – jede Zahl kommt aus `git ls-files` und dem Inhalt der Dateien.
 *
 *   node scripts/zahlen.mjs                    # Markdown-Block ausgeben
 *   node scripts/zahlen.mjs --write README.md  # Block zwischen den Markierungen ersetzen
 *   node scripts/zahlen.mjs --prs 154          # zusätzlich Zeile „Pull Requests gemergt“
 *
 * Markierungen in der Zieldatei: <!-- zahlen:start --> … <!-- zahlen:end -->
 * Ohne Abhängigkeiten, läuft auch ohne npm-Registry.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const START = "<!-- zahlen:start -->";
export const END = "<!-- zahlen:end -->";

/** Bereiche: Name, Auswahl über den Pfad. Reihenfolge = Reihenfolge in der Tabelle. */
export const BEREICHE = [
  { name: "App (Oberfläche)", test: (f) => /^src\/.*\.(tsx?|css)$/.test(f) },
  { name: "Datenbank (Migrationen)", test: (f) => /^supabase\/migrations\/.*\.sql$/.test(f) },
  { name: "Edge Functions", test: (f) => /^supabase\/functions\/.*\.ts$/.test(f) && !/_test\.ts$/.test(f) },
  { name: "Server für Vorschaukarten", test: (f) => /^api\/.*\.(m?js|ts)$/.test(f) },
  { name: "Werkzeuge", test: (f) => /^scripts\/.*\.(m?js|sh)$/.test(f) },
  { name: "Tests Datenbank (pgTAP)", test: (f) => /^supabase\/tests\/.*\.sql$/.test(f) },
  {
    name: "Tests App und Funktionen",
    test: (f) => /^tests\/.*\.(m?js|ts)$/.test(f) || /^supabase\/functions\/.*_test\.ts$/.test(f),
  },
];

const zeilen = (text) => text.split("\n").filter((z) => z.trim() !== "").length;
const unique = (xs) => new Set(xs).size;
const tausender = (n) => n.toLocaleString("de-DE");

/**
 * @param {string[]} files  Pfade relativ zum Repository
 * @param {(f: string) => string} read  liest eine Datei
 */
export function zahlen(files, read) {
  const bereiche = BEREICHE.map((b) => {
    const eigene = files.filter(b.test);
    return { name: b.name, dateien: eigene.length, zeilen: eigene.reduce((s, f) => s + zeilen(read(f)), 0) };
  });
  const migrationen = files.filter((f) => /^supabase\/migrations\/.*\.sql$/.test(f));
  const sql = migrationen.map(read).join("\n").toLowerCase();
  const tabellen = [...sql.matchAll(/create table (?:if not exists )?(public|app_private)\.([a-z0-9_]+)/g)].map((m) => `${m[1]}.${m[2]}`);
  const rpcs = [...sql.matchAll(/create (?:or replace )?function public\.([a-z0-9_]+)/g)].map((m) => m[1]);
  const functions = files
    .map((f) => f.match(/^supabase\/functions\/([^/_][^/]*)\/index\.ts$/)?.[1])
    .filter(Boolean);
  return {
    bereiche,
    codeZeilen: bereiche.filter((b) => !b.name.startsWith("Tests")).reduce((s, b) => s + b.zeilen, 0),
    testZeilen: bereiche.filter((b) => b.name.startsWith("Tests")).reduce((s, b) => s + b.zeilen, 0),
    migrationen: migrationen.length,
    tabellen: unique(tabellen),
    rpcs: unique(rpcs),
    edgeFunctions: unique(functions),
    pgtap: files.filter((f) => /^supabase\/tests\/.*\.test\.sql$/.test(f)).length,
    unit: files.filter((f) => /^tests\/unit\/.*\.test\.mjs$/.test(f)).length,
  };
}

/** Markdown-Block inklusive Markierungen. */
export function markdown(z, { stand, prs } = {}) {
  const zeilenTabelle = z.bereiche.map((b) => `| ${b.name} | ${tausender(b.zeilen)} | ${b.dateien} |`);
  const extra = prs ? [`| Pull Requests gemergt | ${tausender(prs)} |`] : [];
  return [
    START,
    `_Stand: ${stand ?? "unbekannt"} · gezählt mit \`node scripts/zahlen.mjs\` (Zeilen ohne Leerzeilen)_`,
    "",
    "| Bereich | Zeilen | Dateien |",
    "|---|---:|---:|",
    ...zeilenTabelle,
    `| **Code gesamt (ohne Tests)** | **${tausender(z.codeZeilen)}** | |`,
    `| **Tests gesamt** | **${tausender(z.testZeilen)}** | |`,
    "",
    "| Was | Anzahl |",
    "|---|---:|",
    `| Migrationen | ${z.migrationen} |`,
    `| Tabellen | ${z.tabellen} |`,
    `| Datenbank-Funktionen (RPC, \`public\`) | ${z.rpcs} |`,
    `| Edge Functions | ${z.edgeFunctions} |`,
    `| pgTAP-Testdateien | ${z.pgtap} |`,
    `| Unit-Testdateien | ${z.unit} |`,
    ...extra,
    END,
  ].join("\n");
}

/** Ersetzt den Block zwischen den Markierungen; fehlen sie, ist das ein Fehler. */
export function ersetzen(text, block) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error(`Markierungen ${START} … ${END} fehlen`);
  return text.slice(0, a) + block + text.slice(b + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
  const files = git("ls-files").split("\n").filter(Boolean);
  const stand = git("log", "-1", "--format=%cs").trim().split("-").reverse().join(".");
  const block = markdown(zahlen(files, (f) => readFileSync(f, "utf8")), { stand, prs: Number(opt("--prs")) || undefined });
  const ziel = opt("--write");
  if (ziel) {
    writeFileSync(ziel, ersetzen(readFileSync(ziel, "utf8"), block));
    console.log(`${ziel} aktualisiert`);
  } else {
    console.log(block);
  }
}
