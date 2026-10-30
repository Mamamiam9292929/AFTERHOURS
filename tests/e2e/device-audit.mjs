/**
 * AFTERHOURS – Geräte-Audit (Roadmap D5): die wichtigsten Seiten in Safari (WebKit) und Chrome auf
 * typischen Geräten von 320 px bis Desktop, mit den Regeln aus tests/e2e/audit-rules.mjs.
 *
 *   npm run test:devices      (nach tests/e2e/journey.mjs – nutzt deren Konten und Daten)
 *
 * WebKit von Playwright ist die Engine von Safari, aber nicht Safari auf dem iPhone: Werkzeugleisten,
 * Notch, Tastatur und echtes Scrollverhalten fehlen. Das bleibt eine Prüfung auf echten Geräten (README).
 *
 * Lässt den Lauf scheitern:
 *   - horizontaler Überlauf (Inhalt breiter als der Bildschirm),
 *   - Eingabefelder unter 16 px Schrift (iOS Safari zoomt dann beim Antippen hinein),
 *   - Bedienelemente unter 24 × 24 px ohne Ausnahme (WCAG 2.2, 2.5.8),
 *   - JavaScript-Fehler auf der Seite (z. B. nur in WebKit).
 * Nur Bericht: Bedienelemente unter 44 × 44 px (Empfehlung von Apple), Text unter 11 px.
 *
 * Umgebungsvariablen: APP_URL, E2E_DB_URL (findet Alices Konto, Crew, Plan, Abstimmung), E2E_SCREENSHOTS
 * (Bilder `geraet-<gerät>-<seite>.png` und Bericht `geraete-audit.md`), E2E_DEVICES (Auswahl, z. B. „iphone-se,pixel-7“).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, webkit } from "playwright";
import { auditPage, undersizedTargets } from "./audit-rules.mjs";

const APP = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const DB_URL = process.env.E2E_DB_URL ?? "";
const SHOTS = process.env.E2E_SCREENSHOTS ?? "";
const PASSWORD = "Sehr-geheim-2031!"; // wie in journey.mjs

const pick = (...names) => {
  for (const name of names) if (devices[name]) return devices[name];
  throw new Error(`Playwright kennt keines der Geräte ${names.join(", ")}`);
};
const DEVICES = [
  { id: "iphone-se", label: "iPhone SE (320 px, Safari)", engine: webkit, descriptor: pick("iPhone SE") },
  { id: "iphone-15", label: "iPhone 15 (393 px, Safari)", engine: webkit, descriptor: pick("iPhone 15", "iPhone 14", "iPhone 13") },
  { id: "ipad-mini", label: "iPad Mini (768 px, Safari)", engine: webkit, descriptor: pick("iPad Mini") },
  { id: "mac-safari", label: "Mac (1280 px, Safari)", engine: webkit, descriptor: pick("Desktop Safari") },
  { id: "galaxy-s8", label: "Galaxy S8 (360 px, Chrome)", engine: chromium, descriptor: pick("Galaxy S8") },
  { id: "pixel-7", label: "Pixel 7 (412 px, Chrome)", engine: chromium, descriptor: pick("Pixel 7") },
].filter((d) => !process.env.E2E_DEVICES || process.env.E2E_DEVICES.split(",").includes(d.id));

// ---- Konto und Daten aus der Journey ----------------------------------------------------------------
const psql = (sql) => (DB_URL ? execFileSync("psql", [DB_URL, "-Atqc", sql], { encoding: "utf8" }).trim() : "");
const email = psql("select email from auth.users where email like 'alice.%@example.com' order by created_at desc limit 1");
if (!email) {
  console.log("Kein Konto aus der Journey gefunden (E2E_DB_URL fehlt oder Journey lief nicht) – Audit übersprungen.");
  process.exit(1);
}
const me = `(select id from auth.users where email = '${email}')`;
const ids = {
  crew: psql(`select m.crew_id from public.crew_members m where m.user_id = ${me} order by (select count(*) from public.plans p where p.crew_id = m.crew_id) desc limit 1`),
  plan: psql(`select p.id from public.plans p join public.crew_members m on m.crew_id = p.crew_id and m.user_id = ${me} order by p.created_at desc limit 1`),
  poll: psql(`select p.id from public.polls p join public.crew_members m on m.crew_id = p.crew_id and m.user_id = ${me} order by p.created_at desc limit 1`),
  activity: psql("select id from public.activities order by (name = 'Strike District Bowling') desc, name limit 1"),
};

const PUBLIC = [
  ["startseite", "/"],
  ["anmelden", "/login"],
  ["registrieren", "/register"],
  ["datenschutz", "/privacy"],
];
const APP_PAGES = [
  ["home", "/home"],
  ["discover", "/discover"],
  ["ort", ids.activity && `/activities/${ids.activity}`],
  ["crews", "/crews"],
  ["crew", ids.crew && `/crews/${ids.crew}`],
  ["plaene", "/plans"],
  ["plan", ids.plan && `/plans/${ids.plan}`],
  ["plan-neu", "/plans/new"],
  ["abstimmung", ids.poll && `/polls/${ids.poll}`],
  ["abstimmung-neu", "/polls/new"],
  ["benachrichtigungen", "/notifications"],
  ["profil", "/profile"],
  ["einstellungen", "/settings"],
  ["punkte", "/rewards"],
  ["admin", "/admin"],
].filter(([, url]) => url);

// ---- Lauf -------------------------------------------------------------------------------------------
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
/** Befunde je Art und Element über alle Geräte/Seiten: key → { kind, el, detail, where[] } */
const findings = new Map();
const note = (kind, el, detail, where) => {
  const key = `${kind}|${el}`;
  const entry = findings.get(key) ?? { kind, el, detail, where: [] };
  if (!entry.where.includes(where)) entry.where.push(where);
  findings.set(key, entry);
};
const stats = [];
const BLOCKING = new Set(["overflow", "zoom", "target", "error"]);

async function settle(page) {
  await page.locator("main, #root > *").first().waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts?.ready;
    const running = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2000))]);
  });
}

async function audit(device, page, name, url) {
  const where = `${device.id}/${name}`;
  await page.goto(`${APP}${url}`);
  await settle(page);
  const result = await page.evaluate(`(${auditPage})(${undersizedTargets})`);
  stats.push({ device: device.id, page: name, ...result });
  if (result.overflow > 1) {
    note("overflow", result.culprits.map((c) => c.el).join(" · ") || "(Element nicht gefunden)", `${result.overflow}px breiter als ${result.width}px`, where);
  }
  for (const f of result.zoomInputs) note("zoom", f.el, `${f.size}px`, where);
  for (const f of result.smallTargets) note("target", f.el, f.size, where);
  for (const f of result.tinyText) note("tiny", f.el, `${f.size}px`, where);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `geraet-${device.id}-${name}.png`), scale: "css" });
}

for (const device of DEVICES) {
  console.log(`• ${device.label}`);
  const browser = await device.engine.launch();
  const context = await browser.newContext({ ...device.descriptor, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
  // Deutsch fest (das Konto könnte in der Journey auf Englisch gestellt worden sein); Installations-Hinweis ruhig.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("afterhours.locale", "de");
    } catch {
      /* egal */
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (e) => {
    const text = String(e?.message ?? e);
    if (!/ResizeObserver loop/.test(text)) note("error", text.slice(0, 200), "", `${device.id}/${page.url().replace(APP, "")}`);
  });
  try {
    for (const [name, url] of PUBLIC) await audit(device, page, name, url);
    await page.goto(`${APP}/login`);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.waitForURL(/\/(home|onboarding|start)/, { timeout: 20_000 });
    for (const [name, url] of APP_PAGES) await audit(device, page, name, url);
  } catch (error) {
    note("error", `Lauf abgebrochen: ${String(error?.message ?? error).split("\n")[0].slice(0, 200)}`, "", `${device.id}/${page.url().replace(APP, "")}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `geraet-${device.id}-FEHLER.png`) }).catch(() => {});
  }
  await browser.close();
}

// ---- Bericht ----------------------------------------------------------------------------------------
const KINDS = {
  overflow: "Horizontaler Überlauf",
  zoom: "Eingabefeld unter 16 px (iOS zoomt)",
  target: "Bedienelement unter 24 × 24 px (WCAG 2.5.8)",
  error: "JavaScript-Fehler",
  tiny: "Text unter 11 px (Bericht)",
};
const list = [...findings.values()].sort((a, b) => Object.keys(KINDS).indexOf(a.kind) - Object.keys(KINDS).indexOf(b.kind));
const blocking = list.filter((f) => BLOCKING.has(f.kind));
const short = (where) => `${where.slice(0, 5).join(", ")}${where.length > 5 ? ` (+${where.length - 5})` : ""}`;

const lines = [
  "# Geräte-Audit (D5)",
  "",
  `${DEVICES.length} Geräte, ${stats.length} Seiten. Blockierende Befunde: ${blocking.length}. WebKit ist die Engine von Safari, nicht das iPhone selbst.`,
  "",
  "| Gerät | Seiten | Bedienelemente | davon unter 44 px |",
  "|---|---|---|---|",
  ...DEVICES.map((d) => {
    const s = stats.filter((x) => x.device === d.id);
    return `| ${d.label} | ${s.length} | ${s.reduce((n, x) => n + x.targets, 0)} | ${s.reduce((n, x) => n + x.under44, 0)} |`;
  }),
  "",
];
for (const [kind, title] of Object.entries(KINDS)) {
  const of = list.filter((f) => f.kind === kind);
  lines.push(`## ${title}: ${of.length}`, "");
  for (const f of of.slice(0, 60)) lines.push(`- ${f.el}${f.detail ? ` – ${f.detail}` : ""} · ${short(f.where)}`);
  lines.push("");
}
const report = lines.join("\n");
if (SHOTS) fs.writeFileSync(path.join(SHOTS, "geraete-audit.md"), report);

console.log("");
for (const [kind, title] of Object.entries(KINDS)) {
  const of = list.filter((f) => f.kind === kind);
  if (of.length === 0) continue;
  console.log(`${BLOCKING.has(kind) ? "✗" : "·"} ${title}: ${of.length}`);
  for (const f of of.slice(0, BLOCKING.has(kind) ? 15 : 6)) console.log(`    ${f.el.slice(0, 110)}${f.detail ? ` – ${f.detail}` : ""} · ${short(f.where)}`);
}
const tiny = list.filter((f) => f.kind === "tiny").length;
const under44 = stats.reduce((n, x) => n + x.under44, 0);
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Geräte-Audit::${stats.length} Seiten auf ${DEVICES.length} Geräten, ${blocking.length} blockierende Befunde, ${tiny} Stellen mit Text unter 11 px, ${under44} Bedienelemente unter 44 px (Bericht geraete-audit.md auf dem Screenshot-Branch)`);
console.log(`Geräte-Audit: ${stats.length} Seiten, ${blocking.length} blockierende Befunde.`);
process.exit(blocking.length > 0 || stats.length === 0 ? 1 : 0);
