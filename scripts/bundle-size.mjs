#!/usr/bin/env node
/*
 * Größenwächter für den Produktionsbuild (Roadmap F3).
 *
 * Misst nach `npm run build` die gzip-Größe dessen, was beim ersten Öffnen geladen wird
 * (Skripte, Modul-Preloads und Stylesheets aus dist/index.html), und den größten Seiten-Chunk.
 * Grenzen stehen in scripts/bundle-budget.json. Überschreitung = Exit-Code 1.
 *
 *   node scripts/bundle-size.mjs            # Tabelle ausgeben, Grenzen prüfen
 *   node scripts/bundle-size.mjs --dist out # anderer Ausgabeordner
 *
 * In GitHub Actions landet die Tabelle zusätzlich in der Zusammenfassung des Laufs
 * ($GITHUB_STEP_SUMMARY) und als Hinweis-Annotation (über die Checks-API lesbar).
 * Ohne Abhängigkeiten, damit es auch ohne npm-Registry läuft.
 */
import { readdirSync, readFileSync, appendFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const distArg = process.argv.indexOf("--dist");
const dist = distArg > 0 ? process.argv[distArg + 1] : join(here, "..", "dist");
const budget = JSON.parse(readFileSync(join(here, "bundle-budget.json"), "utf8"));

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const gz = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;

let html;
try {
  html = readFileSync(join(dist, "index.html"), "utf8");
} catch {
  console.error(`Kein Build gefunden (${join(dist, "index.html")}). Zuerst: npm run build`);
  process.exit(2);
}

// Alles, was index.html direkt lädt: <script src>, <link rel="modulepreload">, <link rel="stylesheet">.
const initial = new Set();
for (const m of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
  const tag = m[0];
  const isScript = tag.startsWith("<script");
  const rel = /rel="([^"]+)"/.exec(tag)?.[1] ?? "";
  if (!isScript && rel !== "modulepreload" && rel !== "stylesheet") continue;
  const url = /(?:src|href)="([^"]+)"/.exec(tag)?.[1];
  if (!url || /^[a-z]+:\/\//i.test(url) || !url.includes("/assets/")) continue;
  initial.add(url.replace(/^\//, ""));
}

const assets = readdirSync(join(dist, "assets")).map((name) => {
  const file = `assets/${name}`;
  return { file, raw: statSync(join(dist, file)).size, gzip: gz(file) };
});

const initialJs = assets.filter((a) => initial.has(a.file) && a.file.endsWith(".js"));
const initialCss = assets.filter((a) => initial.has(a.file) && a.file.endsWith(".css"));
const lazyJs = assets.filter((a) => !initial.has(a.file) && a.file.endsWith(".js")).sort((a, b) => b.gzip - a.gzip);
const sum = (list) => list.reduce((n, a) => n + a.gzip, 0);

const checks = [
  { label: "Start: JavaScript (gzip)", value: sum(initialJs), limit: budget.initialJsGzipKb * 1024 },
  { label: "Start: CSS (gzip)", value: sum(initialCss), limit: budget.initialCssGzipKb * 1024 },
  { label: `Größter Seiten-Chunk (gzip)${lazyJs[0] ? `: ${lazyJs[0].file}` : ""}`, value: lazyJs[0]?.gzip ?? 0, limit: budget.largestLazyChunkGzipKb * 1024 },
  { label: "Alle Skripte zusammen (gzip)", value: sum(assets.filter((a) => a.file.endsWith(".js"))), limit: budget.totalJsGzipKb * 1024 },
];

const rows = checks.map((c) => ({ ...c, ok: c.value <= c.limit }));
const table = [
  "| Messung | Größe | Grenze | |",
  "|---|---:|---:|---|",
  ...rows.map((r) => `| ${r.label} | ${kb(r.value)} | ${kb(r.limit)} | ${r.ok ? "✅" : "❌"} |`),
  "",
  "Beim Start geladen: " + [...initialJs, ...initialCss].map((a) => `\`${a.file}\` ${kb(a.gzip)}`).join(", "),
  "",
  "Größte Seiten-Chunks: " + lazyJs.slice(0, 5).map((a) => `\`${a.file}\` ${kb(a.gzip)}`).join(", "),
].join("\n");

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Build-Größe\n\n${table}\n`);
if (process.env.GITHUB_ACTIONS) {
  const line = rows.map((r) => `${r.label}: ${kb(r.value)} / ${kb(r.limit)}`).join(" · ");
  console.log(`::notice title=Build-Größe::${line.replace(/%/g, "%25")}`);
}

const failed = rows.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\nGrenze überschritten: ${failed.map((r) => r.label).join(", ")}.`);
  console.error("Seiten aufteilen (lazy import) oder – wenn bewusst – scripts/bundle-budget.json anheben und im PR begründen.");
  process.exit(1);
}
