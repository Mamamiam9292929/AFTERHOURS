/**
 * AFTERHOURS – End-to-End-Test der kompletten Nutzerjourney mit mehreren Konten.
 *
 *   npm run test:e2e
 *
 * Voraussetzungen
 *   - Die App läuft (npm run dev oder npm run preview) und ist mit einem Supabase-Projekt verbunden,
 *     in das Migrationen und Demo-Daten (supabase/seed.sql) eingespielt sind. Gedacht ist der Test
 *     für die lokale Supabase-Umgebung (`supabase start`), NICHT für die Produktivdatenbank:
 *     Er legt Konten, Crews, Abstimmungen und Pläne an.
 *   - E-Mail-Bestätigung: Ist sie aktiv, holt der Test die Links aus Mailpit (läuft bei
 *     `supabase start` mit). Ohne erreichbares Mailpit geht er von "Bestätigung aus" aus.
 *
 * Umgebungsvariablen (alle optional)
 *   APP_URL               Adresse der App                  (Standard http://127.0.0.1:5173)
 *   MAILPIT_URL           Adresse von Mailpit              (Standard http://127.0.0.1:54324)
 *   SUPABASE_URL          API-Adresse für Sicherheitsproben (Standard http://127.0.0.1:54321)
 *   SUPABASE_ANON_KEY     anon-Key für Sicherheitsproben   (ohne ihn entfallen die API-Proben)
 *   E2E_DB_URL            Postgres-URL; damit verschiebt der Test einen Plan in die Vergangenheit,
 *                         um "abschließen" und die Punktevergabe zu prüfen (braucht `psql`)
 *   E2E_SCREENSHOTS       Ordner für Screenshots (Smartphone, Tablet, Desktop)
 *   E2E_HEADED=1          Browser sichtbar starten
 *   E2E_BAIL=1            beim ersten abgebrochenen Schritt beenden
 *   E2E_A11Y=0            Barrierefreiheitsprüfung (axe-core) abschalten
 *
 * Barrierefreiheit (Roadmap F2)
 *   An jedem Screenshot-Punkt prüft axe-core die Seite gegen WCAG 2.1 A/AA. Verstöße der Stufe
 *   „critical“ oder „serious“ lassen den Test scheitern, „moderate“/„minor“ werden nur berichtet.
 *   Der vollständige Bericht liegt als a11y.json im Screenshot-Ordner. axe-core ist (noch) nicht im
 *   Lockfile; die CI installiert es vor dem Lauf, lokal: `npm install --no-save axe-core@4.10.3`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";
import { handleCalendar } from "../../api/calendar.js";
import { handleShare } from "../../api/share.js";

const APP = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const MAILPIT = (process.env.MAILPIT_URL ?? "http://127.0.0.1:54324").replace(/\/$/, "");
const API = (process.env.SUPABASE_URL ?? "http://127.0.0.1:54321").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const DB_URL = process.env.E2E_DB_URL ?? "";
const SHOTS = process.env.E2E_SCREENSHOTS ?? "";
const RUN = Date.now().toString(36);
const PASSWORD = "Sehr-geheim-2031!";
const VIEWPORTS = { mobile: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } };
// 8×8-PNG als Profilbild
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQI12M4+kMLK2IYWhIAuUl5wd9KDXUAAAAASUVORK5CYII=", "base64");

let passed = 0;
const failures = [];
const problems = [];
const check = (condition, message) => {
  if (condition) passed++;
  else {
    failures.push(message);
    console.log(`   ✗ ${message}`);
  }
};
const users = [];
async function step(name, fn) {
  const started = Date.now();
  process.stdout.write(`• ${name}\n`);
  try {
    await fn();
  } catch (error) {
    failures.push(`${name}: ${String(error?.message ?? error).split("\n")[0]}`);
    console.log(`   ✗ abgebrochen: ${String(error?.message ?? error).split("\n").slice(0, 4).join(" | ")}`);
    // Zur Fehlersuche: wo stand jede Person, und was meldete die Oberfläche?
    for (const user of users) {
      const alerts = await user.page.locator('[role="alert"]').allInnerTexts().catch(() => []);
      console.log(`     ${user.name}: ${user.page.url()}${alerts.length ? ` – Meldung: ${alerts.join(" / ")}` : ""}`);
      if (SHOTS) await user.page.screenshot({ path: path.join(SHOTS, `FEHLER-${user.name}.png`) }).catch(() => {});
    }
    if (process.env.E2E_BAIL) {
      for (const problem of [...new Set(problems)].slice(0, 10)) console.log(`     ! ${problem.slice(0, 600)}`);
      await browser.close();
      process.exit(1);
    }
  }
  if (process.env.E2E_VERBOSE) console.log(`   (${Date.now() - started} ms)`);
}

// ---- Hilfen -----------------------------------------------------------------------------------------
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: !process.env.E2E_HEADED });

// Service Worker (W4) sind standardmäßig blockiert, damit page.route() und Netz-Proben unverfälscht bleiben;
// der PWA-Schritt öffnet dafür einen eigenen Kontext.
async function newUser(name, viewport, { serviceWorkers = "block" } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORTS[viewport], deviceScaleFactor: viewport === "mobile" ? 2 : 1, locale: "de-DE", timezoneId: "Europe/Berlin", acceptDownloads: true, serviceWorkers });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("console", (m) => {
    if (process.env.E2E_VERBOSE && m.type() === "error") console.log(`     [${name}] ${m.text().slice(0, 800)}`);
    // Ignoriert werden nur Browser-Meldungen über fehlgeschlagene Verbindungen/Antworten (z. B. Realtime in
    // einer lokalen Umgebung ohne WebSocket-Dienst); erwartete 4xx-Antworten prüft der Test selbst.
    if (m.type() === "error" && !/WebSocket connection to|Failed to load resource/i.test(m.text())) problems.push(`[${name}] console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${name}] pageerror: ${e}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`[${name}] HTTP ${r.status()} ${r.url()}`);
  });
  const user = { name, email: `${name.toLowerCase()}.${RUN}@example.com`, viewport, context, page };
  users.push(user);
  return user;
}

let mailpitAvailable = null;
async function mailLink(email, pattern, sinceCount = 0) {
  if (mailpitAvailable === null) {
    try {
      mailpitAvailable = (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).ok;
    } catch {
      mailpitAvailable = false;
    }
    if (!mailpitAvailable) console.log("   (Mailpit nicht erreichbar – gehe von deaktivierter E-Mail-Bestätigung aus)");
  }
  if (!mailpitAvailable) return null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    if ((list.messages?.length ?? 0) > sinceCount) {
      const message = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
      const links = [...String(message.HTML ?? message.Text ?? "").matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0].replace(/&amp;/g, "&"));
      const link = links.find((l) => pattern.test(l));
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Keine E-Mail mit passendem Link für ${email}`);
}
async function mailCount(email) {
  if (!mailpitAvailable) return 0;
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  return list.messages?.length ?? 0;
}

async function noOverflow(user, label) {
  const overflow = await user.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `kein horizontaler Überlauf: ${label} (${user.viewport}) – ${overflow}px`);
}
// ---- Barrierefreiheit (axe-core) --------------------------------------------------------------------
const A11Y = process.env.E2E_A11Y !== "0";
const A11Y_BLOCKING = new Set(["critical", "serious"]);
let axeSource = null;
if (A11Y) {
  try {
    axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    console.log("axe-core fehlt: `npm install --no-save axe-core@4.10.3` ausführen oder E2E_A11Y=0 setzen.");
    process.exit(1);
  }
}
/** Befunde je Regel und Element, gesammelt über alle Bildschirme: key → { rule, impact, help, url, target, html, screens } */
const a11yFindings = new Map();
let a11yScans = 0;
async function a11y(user, name) {
  if (!A11Y) return;
  const { page } = user;
  // page.evaluate läuft außerhalb der Content-Security-Policy der App; axe liest nur, es ändert nichts.
  if (!(await page.evaluate(() => typeof window.axe !== "undefined"))) await page.evaluate(axeSource);
  // Laufende Übergänge (Farbwechsel nach einem Klick, eingeblendete Hinweise) erst abwarten – sonst misst
  // axe Zwischenfarben. Endlos-Animationen (Ladeanzeigen) zählen nicht; höchstens 2 Sekunden.
  await page.evaluate(async () => {
    const running = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2000))]);
  });
  const result = await page.evaluate(() =>
    // Fokuswächter von Headless UI (offene Dialoge) sind aria-hidden und leiten den Fokus nur zurück in den
    // Dialog – axe meldet sie fälschlich als „aria-hidden-focus“; sie sind keine Bedienelemente.
    window.axe.run({ include: [["html"]], exclude: [["[data-headlessui-focus-guard]"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
  );
  a11yScans++;
  const screen = `${name}-${user.viewport}`;
  let blocking = 0;
  for (const violation of result.violations) {
    if (A11Y_BLOCKING.has(violation.impact)) blocking += violation.nodes.length;
    for (const node of violation.nodes) {
      const target = node.target.join(" ");
      const key = `${violation.id}|${target}`;
      const finding = a11yFindings.get(key) ?? { rule: violation.id, impact: violation.impact, help: violation.help, url: violation.helpUrl, target, html: node.html.slice(0, 300), detail: node.failureSummary?.split("\n").slice(0, 3).join(" "), screens: [] };
      if (!finding.screens.includes(screen)) finding.screens.push(screen);
      a11yFindings.set(key, finding);
    }
  }
  if (blocking === 0) passed++;
  else console.log(`   ✗ Barrierefreiheit ${screen}: ${blocking} schwere Befunde (Details am Ende)`);
}

async function shot(user, name) {
  await noOverflow(user, name);
  await a11y(user, name);
  if (!SHOTS) return;
  // Laufende Übergänge (Farbwechsel, Stempel, Seitenwechsel) erst zu Ende laufen lassen – sonst zeigt das Bild einen Zwischenstand.
  await user.page
    .evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))))
    .catch(() => undefined);
  await user.page.screenshot({ path: path.join(SHOTS, `${name}-${user.viewport}.png`) });
}
const dialog = (user) => user.page.getByRole("dialog");
const toast = async (user, text) => user.page.getByText(text).first().waitFor({ state: "visible" });
const idFromUrl = (page) => page.url().split("/").pop().split("?")[0];

async function register(user, { here = false } = {}) {
  const { page } = user;
  if (!here && !page.url().includes("/register")) await page.goto(`${APP}/register`);
  await page.getByLabel("Anzeigename").fill(user.name);
  await page.getByLabel("E-Mail-Adresse").fill(user.email);
  await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  check(await page.getByText("AFTERHOURS kannst du ab 16 Jahren nutzen.").isVisible(), "Registrierung verlangt die Altersbestätigung");
  await page.getByLabel("Ich bin mindestens 16 Jahre alt.").check();
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL(/\/(check-email|onboarding)/);
  if (page.url().includes("/check-email")) {
    const link = await mailLink(user.email, /\/auth\/v1\/verify|\/auth\/confirm/);
    if (!link) throw new Error("E-Mail-Bestätigung ist aktiv, aber kein Postfach erreichbar (MAILPIT_URL setzen)");
    await page.goto(link);
  }
  await page.waitForURL(/\/onboarding/);
}

async function onboard(user, { full = false } = {}) {
  const { page } = user;
  await page.getByRole("heading", { name: "Wie sollen dich deine Freunde sehen?" }).waitFor();
  check((await page.getByLabel("Anzeigename").inputValue()) === user.name, `${user.name}: Anzeigename aus der Registrierung ist vorausgefüllt`);
  if (full) {
    await page.locator('input[type="file"]').setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Bild entfernen" }).waitFor();
    await page.getByLabel("Stadt oder Region").fill("Berlin");
    await shot(user, "02-onboarding-profil");
  }
  await page.getByRole("button", { name: "Weiter" }).click();
  if (full) {
    await page.getByRole("button", { name: "Essen & Cafés" }).click();
    await page.getByRole("button", { name: "Sport", exact: true }).first().click();
    await page.getByRole("button", { name: "Bowling" }).click();
    await shot(user, "03-onboarding-interessen");
  }
  await page.getByRole("button", { name: "Weiter" }).click();
  if (full) await page.getByRole("button", { name: "bis 20 €" }).click();
  await page.getByRole("button", { name: "Los geht’s" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"));
}

/** W1 Etappe 2: verkürztes Onboarding nach einem Einladungslink – ein Schritt, Einladung als Ticket. */
async function invitedOnboarding(user) {
  const { page } = user;
  await page.getByRole("heading", { name: "Fast drin" }).waitFor();
  check(await page.getByText("Nur ein Schritt").isVisible(), `${user.name}: Onboarding für Eingeladene hat nur einen Schritt`);
  const pass = page.getByRole("region", { name: "Deine Einladung" });
  check(await pass.getByText("Weekend Crew").isVisible(), `${user.name}: Onboarding zeigt die Crew der Einladung`);
  check(await pass.getByText("Alice lädt dich ein").isVisible(), `${user.name}: Onboarding zeigt, wer einlädt`);
  check((await page.getByLabel("Anzeigename").inputValue()) === user.name, `${user.name}: Anzeigename aus der Registrierung ist vorausgefüllt`);
  check((await page.getByRole("button", { name: "Weiter", exact: true }).count()) === 0, `${user.name}: keine Interessen- und Vorlieben-Schritte`);
  // Ohne Namen geht es nicht weiter – auch nicht in die Crew.
  await page.getByLabel("Anzeigename").fill("");
  await page.getByRole("button", { name: "Weekend Crew beitreten" }).click();
  await page.getByText("Mindestens 2 Zeichen.").first().waitFor();
  check(page.url().includes("/onboarding"), `${user.name}: leerer Name hält den Beitritt auf`);
  await page.getByLabel("Anzeigename").fill(user.name);
  check((await page.getByText("Mindestens 2 Zeichen.").count()) === 0, `${user.name}: Fehlermeldung verschwindet, sobald der Name passt`);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
}

// W8: navigator.share ersetzen, um den geteilten Inhalt zu prüfen (headless Chromium hat kein Teilen-Menü).
async function stubShare(page) {
  await page.evaluate(() => {
    window.__shared = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => void window.__shared.push(data) });
  });
}
async function unstubShare(page) {
  await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: undefined }));
}
const sharedData = (page) => page.evaluate(() => window.__shared ?? []);

async function login(user, password = PASSWORD) {
  const { page } = user;
  await page.goto(`${APP}/login`);
  await page.getByLabel("E-Mail-Adresse").fill(user.email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
}

const token = (user) => user.page.evaluate(() => JSON.parse(localStorage.getItem("afterhours.auth") ?? "{}").access_token ?? null);
async function api(user, method, pathAndQuery, body) {
  const accessToken = user ? await token(user) : null;
  const response = await fetch(`${API}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken ?? ANON}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    /* leer */
  }
  return { status: response.status, json };
}

// ---- Journey ----------------------------------------------------------------------------------------
const alice = await newUser("Alice", "desktop");
const bob = await newUser("Bob", "mobile");
const carol = await newUser("Carol", "tablet");
const mallory = await newUser("Mallory", "mobile");
const ids = {};

await step("W6 – Öffentliche Startseite ohne Anmeldung", async () => {
  for (const user of [alice, bob, carol]) {
    const { page } = user;
    await page.goto(`${APP}/`);
    await page.getByRole("heading", { level: 1, name: /Ein Satz.*Ein Abend/ }).waitFor();
    check(new URL(page.url()).pathname === "/", `„/“ ohne Konto zeigt die Startseite statt der Anmeldung (${user.viewport})`);
    check((await page.getByText("Beispiel", { exact: true }).count()) >= 3, `Satz-Probe, Kartenstapel und Plan-Karten sind als „Beispiel“ markiert (${user.viewport})`);
    await shot(user, "00-startseite");
    if (SHOTS && user !== carol) await page.screenshot({ path: path.join(SHOTS, `00-startseite-ganz-${user.viewport}.png`), fullPage: true });
  }
  const text = await bob.page.locator("main").innerText();
  check(!/\d[\d.]*\s*(Nutzer|Crews|Downloads|Bewertungen)|★|Sterne|kostenlos|gratis/i.test(text), "Startseite behauptet keine Nutzerzahlen, Bewertungen oder Preise");
  check(await bob.page.getByRole("link", { name: "Datenschutz" }).isVisible(), "Startseite verlinkt den Datenschutz");

  // V2: Die Satz-Probe nutzt den echten Zerleger der App – im Browser, ohne Konto, ohne Anfrage.
  const demo = bob.page.getByTestId("landing-demo");
  const demoChips = demo.getByRole("list", { name: "Daraus wird" });
  for (const chip of ["Bowling", "Kino", "20:00"]) await demoChips.getByText(chip, { exact: true }).waitFor();
  const writes = [];
  bob.page.on("request", (r) => r.url().includes("/rest/v1/") && writes.push(r.url()));
  await demo.getByLabel("Was habt ihr vor?").fill("billard oder bar, sa 21 uhr");
  for (const chip of ["Billard", "Bar", "21:00"]) await demoChips.getByText(chip, { exact: true }).waitFor();
  await demo.getByText("2 Vorschläge").waitFor();
  await demo.getByRole("button", { name: "Beispiel einsetzen: heute noch bar?" }).click();
  await demoChips.getByText("Bar", { exact: true }).waitFor();
  check(writes.length === 0, `Satz-Probe schickt nichts an den Server (${writes.length})`);
  await demo.getByLabel("Was habt ihr vor?").fill("");
  await demo.getByText("Schreib, was ihr machen wollt").waitFor();
  check(true, "Satz-Probe: Vorschau folgt der Eingabe, leer zeigt den Hinweis");
  // Plan-Karten tragen die Antwortfarben.
  for (const answer of ["going", "maybe", "declined"]) check((await bob.page.locator(`.ticket[data-answer="${answer}"]`).count()) === 1, `Beispiel-Karte in Antwortfarbe „${answer}“`);

  // W6 Etappe 2: Messenger und Suchmaschinen lesen nur das HTML – ohne JavaScript.
  const raw = await (await fetch(`${APP}/`)).text();
  const rawHead = raw.slice(0, raw.indexOf("</head>"));
  check(rawHead.includes('<meta property="og:title" content="AFTERHOURS – Ein Abend. Eine Crew. Kein Chat-Chaos." />'), "Startseite: Vorschau-Titel im HTML (og:title)");
  check(/<meta property="og:image" content="https?:\/\/[^"]+\/og\/home\.png" \/>/.test(rawHead), "Startseite: Vorschaubild mit absoluter Adresse (Build mit VITE_SITE_URL)");
  check(!/name="robots"/.test(rawHead), "Startseite ist für Suchmaschinen nicht gesperrt");
  const homeImage = await fetch(`${APP}/og/home.png`);
  check(homeImage.ok && homeImage.headers.get("content-type") === "image/png", "Vorschaubild der Startseite wird ausgeliefert");

  // Smartphone: „Crew gründen“ führt zur Registrierung, das Logo dort zurück zur Startseite.
  await bob.page.getByRole("link", { name: "Crew gründen" }).first().click();
  await bob.page.waitForURL(/\/register$/);
  await bob.page.getByRole("heading", { level: 1, name: "Konto erstellen" }).waitFor();
  check(true, "„Crew gründen“ führt zur Registrierung");
  await bob.page.getByRole("link", { name: "AFTERHOURS – zur Startseite" }).click();
  await bob.page.waitForURL((url) => url.pathname === "/");
  check(true, "Logo auf der Registrierung führt zurück zur Startseite");

  // Desktop: „Anmelden“ oben rechts.
  await alice.page.getByRole("link", { name: "Anmelden", exact: true }).first().click();
  await alice.page.waitForURL(/\/login$/);
  check(true, "„Anmelden“ auf der Startseite führt zur Anmeldung");
});

await step("Schutz ohne Anmeldung", async () => {
  await alice.page.goto(`${APP}/plans`);
  await alice.page.waitForURL(/\/login/);
  check(true, "geschützte Seite leitet zur Anmeldung");
  await shot(alice, "01-login");
  await bob.page.goto(`${APP}/login`);
  await shot(bob, "01-login");
  await alice.page.getByRole("button", { name: "Anmelden" }).click();
  check(await alice.page.getByText("Bitte ausfüllen.").first().isVisible(), "Login-Formular validiert leere Eingaben");
  await alice.page.getByLabel("E-Mail-Adresse").fill("niemand@example.com");
  await alice.page.getByLabel("Passwort", { exact: true }).fill("falsches-passwort");
  await alice.page.getByRole("button", { name: "Anmelden" }).click();
  await alice.page.getByText("E-Mail-Adresse oder Passwort stimmen nicht.").waitFor();
  check(true, "falsche Zugangsdaten ergeben eine verständliche Meldung");
});

await step("Barrierefreiheit – Anmeldung nur mit der Tastatur (Bob)", async () => {
  const { page } = bob;
  await page.goto(`${APP}/login`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  // Mit Tab vorwärts, bis das gesuchte Element den Fokus hat; jeder Halt muss sichtbar markiert sein.
  const focusInfo = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const label = el.labels?.[0]?.textContent?.trim() ?? el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
      const marked = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none" || style.borderColor === "rgb(200, 255, 46)";
      return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type"), label: label.slice(0, 60), marked };
    });
  const unmarked = new Set();
  async function tabTo(matches, what) {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(200); // Übergänge (transition-colors) abwarten
      const info = await focusInfo();
      if (info && !info.marked) unmarked.add(`${info.tag} „${info.label}“`);
      if (info && matches(info)) return;
    }
    throw new Error(`${what} ist mit der Tastatur nicht erreichbar`);
  }
  await tabTo((f) => f.tag === "input" && f.type === "email", "E-Mail-Feld");
  await page.keyboard.type("niemand@example.com");
  await tabTo((f) => f.tag === "input" && f.type === "password", "Passwort-Feld");
  await page.keyboard.type("falsches-passwort");
  await page.keyboard.press("Enter");
  await page.getByText("E-Mail-Adresse oder Passwort stimmen nicht.").waitFor();
  check(true, "Anmeldeformular lässt sich mit Tab und Enter bedienen");
  await tabTo((f) => f.tag === "button" && /Anmelden/.test(f.label), "Anmelden-Knopf");
  check(unmarked.size === 0, `jeder Tastatur-Halt ist sichtbar markiert${unmarked.size ? ` – ohne Markierung: ${[...unmarked].join(", ")}` : ""}`);
});

await step("Schritt 1 – Registrierung, E-Mail-Bestätigung, Onboarding (Alice)", async () => {
  await register(alice);
  await onboard(alice, { full: true });
  // Alice wollte ursprünglich zu /plans (siehe oben) – dorthin geht es nach Anmeldung und Onboarding.
  await alice.page.waitForURL(/\/plans/);
  check(true, "nach dem Onboarding geht es zum ursprünglich aufgerufenen Ziel");
  // W6: Mit Konto führt „/“ direkt zu Home statt zur Startseite.
  await alice.page.goto(`${APP}/`);
  await alice.page.waitForURL(/\/home$/);
  check(true, "„/“ führt Angemeldete direkt zu Home");
  await alice.page.getByRole("heading", { level: 1 }).waitFor();
  await alice.page.getByText("In drei Schritten zum ersten Plan").waitFor();
  check(true, "Home zeigt neuen Nutzern den Einstieg");
  await shot(alice, "04-home-neu");
});

await step("Schritt 2 – Crew erstellen", async () => {
  const { page } = alice;
  check(await page.getByRole("link", { name: "Erster Plan in 60 Sekunden" }).isVisible(), "Home bietet neuen Nutzern den geführten Start an (W5)");
  await page.getByRole("link", { name: "Nur Crew erstellen" }).click();
  await dialog(alice).getByLabel("Name der Crew").fill("Weekend Crew");
  await dialog(alice).getByRole("radio", { name: "🎳" }).click();
  await dialog(alice).getByRole("button", { name: "Crew erstellen" }).click();
  await page.waitForURL(/\/crews\/[0-9a-f-]{36}/);
  ids.crew = idFromUrl(page);
  check(Boolean(ids.crew), "Crew angelegt");
});

await step("Schritt 3 – Einladungslink erzeugen", async () => {
  await dialog(alice).getByRole("button", { name: "Link erstellen" }).click();
  const input = dialog(alice).getByLabel("Dein Einladungslink");
  await input.waitFor();
  ids.invite = await input.inputValue();
  check(/\/join\/[0-9a-f]{64}$/.test(ids.invite), "Einladungslink enthält einen 64-stelligen Token");
  await shot(alice, "05-einladung");
  await dialog(alice).getByRole("button", { name: "Schließen" }).click();
});

await step("Schritt 3 – Freunde registrieren sich über den Link und treten bei (Bob, Carol)", async () => {
  for (const friend of [bob, carol]) {
    const { page } = friend;
    await page.goto(ids.invite);
    // W1: ohne Konto führt der Link auf die Einladungs-Landingpage – Crew, wer dabei ist, nächster Abend.
    await page.waitForURL(/\/invite\/[0-9a-f]{64}$/);
    const pass = page.locator("section.ticket-feature-wrap");
    await pass.getByText("Weekend Crew").waitFor();
    check(await pass.getByText("Alice lädt dich ein").isVisible(), `${friend.name}: Landingpage zeigt, wer einlädt`);
    const already = friend === bob ? "Alice ist schon dabei" : "Alice und Bob sind schon dabei";
    check(await pass.getByText(already).isVisible(), `${friend.name}: Landingpage zeigt, wer schon dabei ist („${already}“)`);
    check(await pass.getByText("Noch kein Abend geplant").isVisible(), `${friend.name}: ohne Plan steht ehrlich „Noch kein Abend geplant“`);
    check((await page.getByRole("heading", { level: 1, name: "Sei dabei" }).count()) === 1, `${friend.name}: Registrierung direkt auf der Landingpage`);
    await shot(friend, "06a-einladung-landing");
    await register(friend, { here: true });
    // W1 Etappe 2: Eingeladene brauchen nur einen Schritt – Profil und Beitritt mit demselben Tipp.
    await invitedOnboarding(friend);
    if (friend === bob) await shot(bob, "06-einladung-annehmen");
    await page.getByRole("button", { name: "Weekend Crew beitreten" }).click();
    await page.waitForURL(new RegExp(`/crews/${ids.crew}`));
    await toast(friend, "Willkommen in Weekend Crew.");
    check(true, `${friend.name} ist der Crew direkt aus dem Onboarding beigetreten`);
  }
  await alice.page.reload();
  await alice.page.getByText("3 Mitglieder").first().waitFor();
  check(true, "Alice sieht drei Mitglieder");
  await alice.page.getByRole("tab", { name: /Mitglieder/ }).click();
  await alice.page.getByText("Bob").first().waitFor();
  await shot(alice, "07-crew-mitglieder");
});

await step("Schritt 4 – Aktivitäten in Discover auswählen", async () => {
  const { page } = alice;
  await page.goto(`${APP}/discover`);
  await page.getByRole("heading", { name: "Strike District Bowling" }).waitFor();
  check(await page.getByText("Beispieldaten").first().isVisible(), "Demo-Daten sind als solche gekennzeichnet");
  check((await page.getByLabel("Stadt", { exact: true }).inputValue()) === "Berlin", "Discover startet mit der Stadt aus dem Profil");
  // D0: Plakat-Überschrift mit der Stadt, darunter die Tageszeit in Lime; ein Ort steht groß auf der Bühne.
  const discoverTitle = page.getByRole("heading", { level: 1 });
  check((await discoverTitle.innerText()).toLowerCase().startsWith("berlin"), "Discover-Überschrift nennt die Stadt");
  check((await discoverTitle.locator(".text-lime").innerText()).toLowerCase().startsWith("heute"), "Tageszeit steht in Lime");
  check((await page.locator(".stage-card").count()) === 1, "ein Ort steht groß auf der Bühne");
  check((await page.locator(".stage-card").getByRole("link", { name: "Details" }).count()) === 1, "Bühne führt zu den Details");
  await shot(alice, "08-discover");
  // V2: Orte als Stapel – Pfeile und Wischen blättern, jeder Ort steht genau einmal auf der Seite.
  const stageName = () => page.locator(".stage-card h2").textContent();
  const deckFirst = (await stageName()).trim();
  check((await page.getByText(/^1 \/ \d+$/).count()) === 1, "Stapel zeigt die Position");
  await page.getByRole("button", { name: "Nächster Ort" }).click();
  await page.getByText(/^2 \/ \d+$/).waitFor();
  const deckSecond = (await stageName()).trim();
  check(deckSecond !== deckFirst, "„Nächster Ort“ legt einen anderen Ort nach oben");
  check((await page.getByRole("heading", { name: deckFirst, exact: true }).count()) === 1, "der vorige Ort steht jetzt in der Liste – genau einmal");
  check((await page.getByRole("heading", { name: deckSecond, exact: true }).count()) === 1, "der Ort oben im Stapel fehlt in der Liste");
  await page.getByRole("button", { name: "Vorheriger Ort" }).click();
  await page.getByText(/^1 \/ \d+$/).waitFor();
  check((await stageName()).trim() === deckFirst, "„Vorheriger Ort“ holt den ersten Ort zurück");
  const art = await page.locator(".stage-art").boundingBox();
  await page.mouse.move(art.x + art.width * 0.75, art.y + art.height / 2);
  await page.mouse.down();
  await page.mouse.move(art.x + art.width * 0.75 - 60, art.y + art.height / 2, { steps: 4 });
  await page.mouse.move(art.x + art.width * 0.75 - 160, art.y + art.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.getByText(/^2 \/ \d+$/).waitFor();
  check((await stageName()).trim() === deckSecond, "Wischen nach links blättert zum nächsten Ort");
  check(await page.locator(".stage-art .cat-world").first().isVisible(), "Kategorie-Grafik liegt auf ihrer Farbwelt");
  await shot(alice, "08b-discover-stapel");
  await page.getByRole("button", { name: "Filter" }).click();
  await dialog(alice).getByLabel("Höchstpreis pro Person").selectOption({ label: "bis 15 €" });
  await dialog(alice).getByRole("button", { name: /Orte? anzeigen/ }).click();
  check((await page.getByRole("heading", { name: "Exit Kollektiv – Der Tresor" }).count()) === 0, "Preisfilter blendet teurere Orte aus");
  await page.getByRole("button", { name: "Filter (1)" }).click();
  await dialog(alice).getByRole("button", { name: "Filter zurücksetzen" }).click();
  await dialog(alice).getByRole("button", { name: /Orte? anzeigen/ }).click();
  await page.getByLabel("Ort oder Aktivität suchen").fill("gibtesnicht");
  await page.getByText("Kein Ort passt zu dieser Auswahl").waitFor();
  check(true, "leere Suche zeigt einen Leerzustand");
  check((await page.locator(".stage-card").count()) === 0, "bei einer Suche gibt es keine Bühne");
  await page.getByLabel("Ort oder Aktivität suchen").fill("");
  await page.getByRole("button", { name: "Strike District Bowling: Zur Abstimmung hinzufügen" }).click();
  await page.getByRole("button", { name: "Lichtspielhaus Nord: Zur Abstimmung hinzufügen" }).click();
  await page.getByText("2 Orte für die Abstimmung gewählt").waitFor();
  check(true, "gewählte Orte landen im Sammelkorb");

  await page.getByRole("link", { name: "Strike District Bowling" }).click();
  await page.getByRole("heading", { name: "Auf einen Blick" }).waitFor();
  check(await page.getByText("Keine Bewertungsdaten vorhanden").isVisible(), "Detailseite erfindet keine Bewertungen");
  check(await page.getByText(/Unbekannt – freie Termine/).isVisible(), "Detailseite kennzeichnet unbekannte Verfügbarkeit");
  await shot(alice, "09-ort-detail");
  await bob.page.goto(`${APP}/discover`);
  await bob.page.getByText("In welcher Stadt sucht ihr?").waitFor();
  check(true, "ohne Stadt im Profil fragt Discover nach der Stadt");
  await bob.page.getByRole("button", { name: "Berlin" }).click();
  await bob.page.getByRole("heading", { name: "Strike District Bowling" }).waitFor();
  await shot(bob, "08-discover");
});

await step("Schritt 5 – Abstimmung für Samstag starten", async () => {
  const { page } = alice;
  await page.getByRole("link", { name: "Abstimmung starten" }).click();
  await page.waitForURL(/\/polls\/new/);
  await page.getByRole("button", { name: "Eigenen Vorschlag hinzufügen" }).click();
  await page.getByRole("button", { name: "Abstimmung starten" }).click();
  check(await page.getByText("Gib dem Vorschlag einen Namen.").isVisible(), "Formular verlangt einen Namen für eigene Vorschläge");
  await page.getByLabel("Vorschlag 3").fill("Grillen bei Bob");
  await page.getByLabel("Budget pro Person").fill("25");
  await page.getByLabel("Treffpunkt").fill("U-Bahn Ausgang Nord");
  await page.getByLabel("Mindestteilnehmerzahl").fill("2");
  ids.pollTitle = await page.getByLabel("Frage an die Crew").inputValue();
  check(/^Was machen wir am \p{L}+\?$/u.test(ids.pollTitle), `Titelvorschlag folgt dem Datum (${ids.pollTitle})`);
  await shot(alice, "10-abstimmung-erstellen");
  await page.getByRole("button", { name: "Abstimmung starten" }).click();
  await page.waitForURL(/\/polls\/[0-9a-f-]{36}/);
  ids.poll = idFromUrl(page);
  await page.getByRole("heading", { name: ids.pollTitle }).waitFor();
  check((await page.getByRole("radiogroup").count()) === 3, "Abstimmung hat drei Optionen");
});

const answer = (user, option, label) => user.page.getByRole("radiogroup", { name: `Deine Antwort für ${option}` }).getByRole("radio", { name: label, exact: true });
const answered = (user, option, label) =>
  user.page.getByRole("radiogroup", { name: `Deine Antwort für ${option}` }).getByRole("radio", { name: label, exact: true, checked: true });
const optionCard = (user, option) => user.page.getByRole("listitem").filter({ has: user.page.getByRole("heading", { name: option }) });

await step("Schritt 6 – Die Crew stimmt ab", async () => {
  await bob.page.goto(`${APP}/home`);
  await bob.page.getByRole("heading", { name: "Deine Antwort fehlt" }).waitFor();
  check(true, "Bob sieht auf Home, dass seine Antwort fehlt");
  await bob.page.goto(`${APP}/notifications`);
  await bob.page.getByText("Alice hat eine Abstimmung gestartet").waitFor();
  check(true, "Bob wurde über die neue Abstimmung benachrichtigt");
  // W2 Etappe 2: Die Abstimmung holt den Teilen-Link vorab; erst danach teilen.
  const pollShareToken = bob.page.waitForResponse((r) => r.url().includes("/rpc/poll_share_token") && r.ok());
  await bob.page.getByText("Alice hat eine Abstimmung gestartet").click();
  await bob.page.waitForURL(new RegExp(`/polls/${ids.poll}`));
  await pollShareToken;

  // W8: Abstimmung in den Gruppenchat teilen – Titel, Frist, Link; keine Namen.
  await stubShare(bob.page);
  await bob.page.getByRole("button", { name: "Abstimmung teilen" }).click();
  const pollShared = (await sharedData(bob.page))[0];
  check(/\/v\/[0-9a-f]{32}$/.test(pollShared?.url ?? ""), `Abstimmung teilen: Link mit Vorschau (/v/<token>) statt ID (${pollShared?.url})`);
  check(!(pollShared?.url ?? "").includes(ids.poll), "Abstimmung teilen: der Link verrät die ID nicht");
  ids.pollShareUrl = pollShared?.url;
  check(/stimm mit ab, bis /.test(pollShared?.text ?? "") && !/Alice|Bob|Carol/.test(pollShared?.text ?? ""), `Abstimmung teilen: Text mit Frist, ohne Namen („${pollShared?.text}“)`);
  await unstubShare(bob.page);

  await answer(bob, "Strike District Bowling", "Bin dabei").click();
  await answer(bob, "Lichtspielhaus Nord", "Vielleicht").click();
  await answer(bob, "Grillen bei Bob", "Bin nicht dabei").click();
  // Antwort ändern und zurückziehen: es bleibt bei genau einer Stimme pro Option.
  await answer(bob, "Strike District Bowling", "Vielleicht").click();
  await answer(bob, "Strike District Bowling", "Bin dabei").click();
  await answer(bob, "Grillen bei Bob", "Bin nicht dabei").click();
  await optionCard(bob, "Strike District Bowling").getByText("1 Zusage").waitFor();
  // V2 Etappe 3b: Jeder Vorschlag trägt Bobs Antwort als Farbe; zurückgezogen wird er wieder dunkles Glas.
  await bob.page.locator('.vote-card[data-answer="yes"]').filter({ hasText: "Strike District Bowling" }).waitFor();
  await bob.page.locator('.vote-card[data-answer="maybe"]').filter({ hasText: "Lichtspielhaus Nord" }).waitFor();
  check(true, "Abstimmung: „Bin dabei“ färbt den Vorschlag grün, „Vielleicht“ gelb");
  await bob.page.locator(".vote-card:not([data-answer])").filter({ hasText: "Grillen bei Bob" }).waitFor();
  check(true, "Abstimmung: zurückgezogene Antwort – Vorschlag wieder ohne Farbe");
  await shot(bob, "11-abstimmen");

  await carol.page.goto(`${APP}/polls/${ids.poll}`);
  await answer(carol, "Strike District Bowling", "Bin dabei").click();
  await answer(carol, "Lichtspielhaus Nord", "Bin dabei").click();
  await answer(alice, "Strike District Bowling", "Bin dabei").click();

  await optionCard(alice, "Strike District Bowling").getByText("3 Zusagen").waitFor();
  check(true, "Ergebnisse aktualisieren sich bei allen (3 Zusagen für Bowling)");
  await optionCard(alice, "Lichtspielhaus Nord").getByText("1 Zusage").waitFor();
  await alice.page.getByText("Alle haben abgestimmt.").waitFor();
  check(true, "Beteiligung: alle drei haben abgestimmt");
  // D0: Plakat-Überschrift mit dem letzten Wort der Frage in Lime, führende Option mit „Vorn“.
  const keyword = ids.pollTitle.replace(/[?!.]+$/, "").split(/\s+/).pop();
  check((await alice.page.getByRole("heading", { level: 1 }).locator(".text-lime").innerText()).toLowerCase() === keyword.toLowerCase(), `Überschrift hebt „${keyword}“ hervor`);
  check(await optionCard(alice, "Strike District Bowling").getByText("Vorn", { exact: true }).isVisible(), "führende Option trägt „Vorn“");
  check((await optionCard(alice, "Lichtspielhaus Nord").getByText("Vorn", { exact: true }).count()) === 0, "nur die führende Option trägt „Vorn“");
  await shot(alice, "12-abstimmung-zwischenstand");
  await carol.page.reload();
  await optionCard(carol, "Strike District Bowling").getByText("3 Zusagen").waitFor();
  await shot(carol, "12-abstimmung-zwischenstand");

  if (ANON) {
    const votes = await api(alice, "GET", `poll_votes?select=user_id,poll_option_id&poll_id=eq.${ids.poll}`);
    const keys = votes.json.map((v) => `${v.user_id}:${v.poll_option_id}`);
    check(new Set(keys).size === keys.length && keys.length === 5, `in der Datenbank steht genau eine Stimme pro Person und Option (${keys.length})`);
  }
});

await step("P5 Etappe 2 – Wetter schon beim Abstimmen (Bob, Carol)", async () => {
  // Der Open-Meteo-Stellvertreter liefert jeden Tag 14,2 °C, 70 % Regenrisiko, leichten Regen.
  await bob.page.goto(`${APP}/polls/${ids.poll}`);
  const bowling = optionCard(bob, "Strike District Bowling").getByTestId("poll-option-weather");
  await bowling.waitFor();
  check((await bowling.innerText()).replace(/\s+/g, " ").trim() === "14 °C · Regen · 70 % Regenrisiko", `Abstimmung: Wetter beim Vorschlag (${await bowling.innerText()})`);
  await optionCard(bob, "Lichtspielhaus Nord").getByTestId("poll-option-weather").waitFor();
  check(true, "Abstimmung: jeder Ort mit Termin bekommt sein Wetter");
  check((await optionCard(bob, "Grillen bei Bob").getByTestId("poll-option-weather").count()) === 0, "Abstimmung: eigener Vorschlag ohne Ort bekommt kein (erfundenes) Wetter");
  check((await bob.page.getByText(/^Draußen –/).count()) === 0, "Abstimmung: kein Draußen-Hinweis bei Orten drinnen");
  check(await bob.page.getByText(/^Wetter: Vorhersage von Open-Meteo, Stand \d{2}:\d{2} Uhr/).isVisible(), "Abstimmung: Quelle und Stand der Vorhersage einmal unter den Vorschlägen");
  check((await bob.page.getByRole("link", { name: "Open-Meteo" }).getAttribute("href")) === "https://open-meteo.com/", "Abstimmung: Quelle verlinkt");
  await bowling.scrollIntoViewIfNeeded();
  await shot(bob, "11b-abstimmung-wetter");

  // Ein Ort und Tag wird einmal abgefragt – Alice, Bob und Carol teilen sich die Vorhersage, und Open-Meteo erfährt nur Ort und Tag.
  const calls = (await (await fetch("http://127.0.0.1:8089/weather-calls")).json()).calls.filter((q) => q.includes("latitude=52.52") && q.includes("longitude=13.50"));
  check(calls.length === 1, `Abstimmung: eine Abfrage bei Open-Meteo für Ort und Tag (${calls.length})`);
  check(calls.every((q) => !/poll|plan|user|crew/i.test(q)), "Abstimmung: Open-Meteo erfährt nur Ort und Tag");

  // Fehlerzustand: Ist die Function nicht erreichbar, steht das unter den Vorschlägen – mit „Erneut versuchen“.
  const { page } = carol;
  await page.route("**/functions/v1/weather", (route) => route.abort());
  await page.goto(`${APP}/polls/${ids.poll}`);
  await page.getByRole("heading", { name: ids.pollTitle }).waitFor();
  const retry = page.getByRole("button", { name: "Erneut versuchen" });
  await retry.waitFor();
  check(await page.getByText(/Wetter gerade nicht abrufbar|Keine Verbindung/).first().isVisible(), "Abstimmung: Fehlerzustand statt erfundener Werte");
  check((await page.getByTestId("poll-option-weather").count()) === 0, "Abstimmung: ohne Vorhersage keine Werte");
  await page.unroute("**/functions/v1/weather");
  await retry.click();
  await optionCard(carol, "Strike District Bowling").getByTestId("poll-option-weather").waitFor();
  check(true, "Abstimmung: „Erneut versuchen“ lädt das Wetter");
});

await step("W2 Etappe 2 – Geteilte Abstimmung: Vorschau im Messenger und für Freunde ohne Konto", async () => {
  if (!ids.pollShareUrl) throw new Error("kein Teilen-Link aus Schritt 6");
  const sharePath = new URL(ids.pollShareUrl).pathname;

  // Messenger lesen nur den <head>: die Vercel-Funktion (api/share.js) gegen die echte lokale Datenbank.
  if (ANON) {
    const response = await handleShare(new Request(`${APP}${sharePath}`), { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: ANON }, fetch);
    const head = (await response.text()).split("</head>")[0];
    check(head.includes(`<meta property="og:title" content="${ids.pollTitle} · AFTERHOURS" />`), "Vorschau: Frage als og:title");
    check(/<meta property="og:description" content="3 Vorschläge · 3 haben abgestimmt · Abstimmen bis [^"]+\. Stimmst du mit ab\?" \/>/.test(head), "Vorschau: Vorschläge, Stimmen und Frist als og:description");
    check(head.includes(`content="${APP}/og/poll.png"`) && head.includes(`content="${APP}${sharePath}"`), "Vorschau: eigenes Vorschaubild und eigener Link");
    check(!/Alice|Bob|Carol|Strike|Lichtspielhaus|Grillen|U-Bahn|@example/.test(head), "Vorschau: keine Namen, keine Vorschläge, kein Treffpunkt");
    const image = await fetch(`${APP}/og/poll.png`);
    check(image.ok && image.headers.get("content-type") === "image/png", "Vorschaubild der Abstimmung wird ausgeliefert");
  }

  // Freund ohne Konto: Karte mit Frage, Frist, Zahlen – und der Weg in die App.
  const guest = await newUser("Gast", "mobile");
  try {
    await guest.page.goto(ids.pollShareUrl);
    await guest.page.getByRole("heading", { level: 1, name: "Stimmst du mit ab?" }).waitFor();
    const card = guest.page.getByRole("region", { name: ids.pollTitle });
    await card.waitFor();
    const text = await card.innerText();
    check(/3\s*Vorschläge/.test(text) && /3\s*haben abgestimmt/.test(text) && /Abstimmen bis/.test(text), `Gast sieht Vorschläge, Stimmen und Frist („${text.replace(/\s+/g, " ")}“)`);
    check(!/Alice|Bob|Carol|Strike|Lichtspielhaus|Grillen|U-Bahn/.test(await guest.page.locator("body").innerText()), "Gast sieht keine Namen, keine Vorschläge, keinen Treffpunkt");
    check(await guest.page.getByRole("link", { name: "Konto erstellen" }).isVisible(), "Gast: Konto erstellen");
    await shot(guest, "11b-geteilte-abstimmung-gast");
    for (const viewport of ["tablet", "desktop"]) {
      await guest.page.setViewportSize(VIEWPORTS[viewport]);
      await shot({ ...guest, viewport }, "11b-geteilte-abstimmung-gast");
    }
    await guest.page.goto(`${APP}/v/${"0".repeat(32)}`);
    await guest.page.getByRole("heading", { level: 1, name: "Abstimmung nicht gefunden" }).waitFor();
    check(true, "unbekannter Abstimmungs-Link: ehrliche Fehlerseite");
  } finally {
    users.splice(users.indexOf(guest), 1);
    await guest.context.close();
  }

  // Mitglied der Crew: direkt zur Abstimmung.
  await carol.page.goto(ids.pollShareUrl);
  await carol.page.waitForURL(new RegExp(`/polls/${ids.poll}$`));
  await carol.page.getByRole("heading", { name: ids.pollTitle }).waitFor();
  check(true, "Mitglied: Abstimmungs-Link führt direkt zur Abstimmung");
});

await step("W3 Etappe 1 – Gäste stimmen ohne Konto per Link mit", async () => {
  if (!ids.pollShareUrl) throw new Error("kein Teilen-Link aus Schritt 6");
  // Nur wer die Abstimmung gestartet hat (oder Owner/Admin ist), schaltet Gäste frei.
  await bob.page.goto(`${APP}/polls/${ids.poll}`);
  await bob.page.getByRole("heading", { name: ids.pollTitle }).waitFor();
  check((await bob.page.getByRole("switch", { name: /Gäste dürfen mitstimmen/ }).count()) === 0, "einfache Mitglieder sehen den Gäste-Schalter nicht");
  await alice.page.goto(`${APP}/polls/${ids.poll}`);
  const toggle = alice.page.getByRole("switch", { name: /Gäste dürfen mitstimmen/ });
  check((await toggle.getAttribute("aria-checked")) === "false", "Gäste sind standardmäßig nicht zugelassen");
  await toggle.click();
  await toast(alice, "Gäste können jetzt über den geteilten Link mitstimmen.");
  // Die Kennzeichnung erscheint erst nach dem Neuladen der Abstimmung – warten statt sofort prüfen.
  await alice.page.getByText("Gäste stimmen mit", { exact: true }).waitFor();
  check(true, "Abstimmung zeigt „Gäste stimmen mit“");
  const joinToggle = alice.page.getByRole("switch", { name: /Gäste dürfen der Crew beitreten/ });
  check((await joinToggle.getAttribute("aria-checked")) === "false", "W3 Etappe 3: Beitritt für Gäste ist standardmäßig aus");

  if (ANON) {
    const response = await handleShare(new Request(ids.pollShareUrl), { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: ANON }, fetch);
    const head = (await response.text()).split("</head>")[0];
    check(/Stimmst du mit ab\? Geht auch ohne Konto\./.test(head), "Vorschau im Messenger: „Geht auch ohne Konto.“");
  }

  const guest = await newUser("Dana", "mobile");
  try {
    await guest.page.goto(ids.pollShareUrl);
    await guest.page.getByRole("heading", { level: 1, name: "Stimm mit ab" }).waitFor();
    check((await guest.page.getByRole("radiogroup").count()) === 3, "Gast sieht alle drei Vorschläge zum Abstimmen");
    const body = await guest.page.locator("body").innerText();
    // Titel stehen in Versalien (CSS) – innerText liefert sie so.
    check(/Strike District Bowling/i.test(body) && /3 dabei/.test(body), `Gast sieht Vorschläge im Wortlaut und den Stand („${body.replace(/\s+/g, " ").slice(0, 300)}“)`);
    check(!/Alice|Carol|U-Bahn|example\.test/.test(body), "Gast sieht keine Namen der Crew und keinen Treffpunkt");
    await guest.page.getByRole("button", { name: "Abstimmen" }).click();
    check(await guest.page.getByText("Gib deinen Namen ein (mindestens 2 Zeichen).").isVisible(), "ohne Namen keine Stimme");
    check(await guest.page.getByText("Beantworte mindestens einen Vorschlag.").isVisible(), "ohne Antwort keine Stimme");
    await answer(guest, "Grillen bei Bob", "Bin dabei").click();
    await answer(guest, "Lichtspielhaus Nord", "Vielleicht").click();
    await guest.page.getByLabel("Dein Name").fill("Dana");
    // V2 Etappe 3b: Der Stimmzettel färbt jeden Vorschlag in Danas Antwort – grün, gelb, ohne Antwort Glas.
    const ballotColor = (option) => guest.page.getByTestId("ballot-option").filter({ hasText: option }).getAttribute("data-answer");
    check((await ballotColor("Grillen bei Bob")) === "yes" && (await ballotColor("Lichtspielhaus Nord")) === "maybe" && (await ballotColor("Strike District Bowling")) === null, "Gast: Vorschläge in der Farbe der eigenen Antwort");
    await shot(guest, "11c-gast-stimmzettel");
    await guest.page.getByRole("button", { name: "Abstimmen" }).click();
    await guest.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Dana" }).waitFor();
    check(await guest.page.getByText("Gespeichert. Die Crew sieht deine Stimme.").isVisible(), "Gast: Bestätigung nach dem Abstimmen");
    check(await guest.page.getByRole("link", { name: "Konto erstellen" }).isVisible(), "Gast: danach der Weg zum eigenen Konto");
    // Neu laden: dasselbe Gerät erkennt den Gast wieder (Geheimnis im Browser), Antworten bleiben änderbar.
    await guest.page.reload();
    await guest.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Dana" }).waitFor();
    check((await answer(guest, "Grillen bei Bob", "Bin dabei").getAttribute("aria-checked")) === "true", "Gast sieht nach dem Neuladen seine Antworten");
    // S2: Der Name bleibt auf dem Gerät, ändern geht mit einem Tipp – ohne Namensfeld und ohne Speichern-Knopf.
    check((await guest.page.evaluate(() => localStorage.getItem("afterhours.guest.name"))) === "Dana", "S2: Name liegt auf diesem Gerät");
    await guest.page.getByTestId("guest-one-tap").getByText("Dana", { exact: true }).waitFor();
    check((await guest.page.getByLabel("Dein Name").count()) === 0 && (await guest.page.getByRole("button", { name: "Antworten speichern" }).count()) === 0, "S2: wer abgestimmt hat, ändert ohne Formular");
    await answer(guest, "Lichtspielhaus Nord", "Bin dabei").click();
    await guest.page.getByText("Gespeichert. Die Crew sieht deine Stimme.").waitFor();
    await guest.page.reload();
    await guest.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Dana" }).waitFor();
    check((await answer(guest, "Lichtspielhaus Nord", "Bin dabei").getAttribute("aria-checked")) === "true", "S2: ein Tipp hat die Antwort gespeichert");
    await shot(guest, "11d-gast-abgestimmt");
    for (const viewport of ["tablet", "desktop"]) {
      await guest.page.setViewportSize(VIEWPORTS[viewport]);
      await shot({ ...guest, viewport }, "11d-gast-abgestimmt");
    }
  } finally {
    users.splice(users.indexOf(guest), 1);
    await guest.context.close();
  }

  // Die Crew sieht die Gast-Stimme: im Balken, in der Beteiligung und in der Gästeliste.
  await alice.page.reload();
  await optionCard(alice, "Grillen bei Bob").getByText("1 Zusage").waitFor();
  check(true, "Gast-Zusage zählt im Balken mit");
  check(await alice.page.getByText("+ 1 Gast hat mitgestimmt").isVisible(), "Beteiligung nennt den Gast");
  check(await alice.page.getByRole("list", { name: "Gäste" }).getByText("Dana (Gast)").isVisible(), "Gast steht mit „(Gast)“ in der Gästeliste");
  await shot(alice, "12b-abstimmung-mit-gast");
  await alice.page.goto(`${APP}/notifications`);
  await alice.page.getByText("Dana (Gast) hat abgestimmt").waitFor();
  check(true, "Erstellerin wird über die Gast-Stimme benachrichtigt");

  // Gast entfernen (z. B. Spaß-Stimme): Name und Antworten sind weg, der Stand wie vorher.
  await alice.page.goto(`${APP}/polls/${ids.poll}`);
  await alice.page.getByRole("button", { name: "Dana entfernen" }).click();
  await dialog(alice).getByRole("button", { name: "Entfernen" }).click();
  await toast(alice, "Gast entfernt.");
  await optionCard(alice, "Grillen bei Bob").getByText("0 Zusagen").waitFor();
  check(true, "entfernter Gast zählt nicht mehr");
  check((await alice.page.getByText("+ 1 Gast hat mitgestimmt").count()) === 0, "Beteiligung ohne Gast");

  // S2: Wer schon bei einem anderen Link abgestimmt hat, bringt den Namen mit und stimmt mit einem Tipp ab.
  const lea = await newUser("Lea", "mobile");
  try {
    await lea.page.addInitScript(() => {
      if (!sessionStorage.getItem("journey.lea")) {
        sessionStorage.setItem("journey.lea", "1");
        localStorage.setItem("afterhours.guest.name", "Lea");
      }
    });
    await lea.page.goto(ids.pollShareUrl);
    await lea.page.getByRole("heading", { level: 1, name: "Stimm mit ab" }).waitFor();
    await lea.page.getByTestId("guest-one-tap").getByText("Lea", { exact: true }).waitFor();
    check((await lea.page.getByLabel("Dein Name").count()) === 0, "S2: kein Namensfeld, wenn der Name auf dem Gerät liegt");
    await shot(lea, "11e-gast-ein-tipp");
    await answer(lea, "Grillen bei Bob", "Bin dabei").click();
    await lea.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Lea" }).waitFor();
    check(true, "S2: Gast stimmt mit einem Tipp ab");
    await alice.page.reload();
    await optionCard(alice, "Grillen bei Bob").getByText("1 Zusage").waitFor();
    check(await alice.page.getByRole("list", { name: "Gäste" }).getByText("Lea (Gast)").isVisible(), "S2: Ein-Tipp-Stimme zählt mit Namen");
    // „Nicht Lea?“: Namensfeld mit dem Namen, Vergessen löscht ihn vom Gerät.
    await lea.page.getByRole("button", { name: "Nicht Lea?" }).click();
    check((await lea.page.getByLabel("Dein Name").inputValue()) === "Lea", "„Nicht Lea?“ öffnet das Namensfeld");
    await lea.page.getByRole("button", { name: "Namen auf diesem Gerät vergessen" }).click();
    await lea.page.getByText(/^Vergessen\./).waitFor();
    check((await lea.page.evaluate(() => localStorage.getItem("afterhours.guest.name"))) === null, "Name ist vom Gerät gelöscht");
    await noOverflow(lea, "Gast-Stimmzettel mit einem Tipp");
  } finally {
    users.splice(users.indexOf(lea), 1);
    await lea.context.close();
  }
  await alice.page.getByRole("button", { name: "Lea entfernen" }).click();
  await dialog(alice).getByRole("button", { name: "Entfernen" }).click();
  await toast(alice, "Gast entfernt.");
  await optionCard(alice, "Grillen bei Bob").getByText("0 Zusagen").waitFor();

  if (ANON) {
    const tokenValue = ids.pollShareUrl.split("/").pop();
    const ballot = await api(null, "POST", "rpc/shared_poll_ballot", { p_token: tokenValue });
    check(ballot.status === 200 && ballot.json?.status === "valid" && !JSON.stringify(ballot.json).match(/[0-9a-f]{8}-[0-9a-f]{4}-/), "API: Stimmzettel ohne Konto ohne IDs");
    const bad = await api(null, "POST", "rpc/guest_vote_shared_poll", { p_token: tokenValue, p_secret: "kurz", p_name: "X", p_votes: { 1: "yes" } });
    check(bad.status === 400, `API: Gast-Stimme mit ungültigen Angaben wird abgewiesen (${bad.status})`);
    check((await api(null, "GET", "poll_guests?select=*")).status >= 400, "API: Gäste ohne Konto nicht lesbar");
  }
});

await step("W3 Etappe 2 – Wer als Gast abgestimmt hat und beitritt, übernimmt seine Stimmen", async () => {
  if (!ANON) {
    console.log("   (übersprungen: SUPABASE_ANON_KEY fehlt)");
    return;
  }
  // Eigene kleine Crew, damit der Rest der Journey (Weekend Crew) unberührt bleibt.
  const frida = await newUser("Frida", "desktop");
  const erik = await newUser("Erik", "mobile");
  try {
    await register(frida);
    await onboard(frida);
    const crew = await api(frida, "POST", "rpc/create_crew", { p_name: "Kiez Crew", p_emoji: "🍻" });
    check(crew.status === 200, `Frida gründet die Kiez Crew (${crew.status})`);
    const invitation = await api(frida, "POST", "rpc/create_crew_invitation", { p_crew_id: crew.json });
    const inviteToken = invitation.json?.[0]?.token;
    const endsAt = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
    const poll = await api(frida, "POST", "rpc/create_poll", {
      p_crew_id: crew.json,
      p_title: "Kickern oder Tischtennis?",
      p_ends_at: endsAt,
      p_options: [{ title: "Kickern" }, { title: "Tischtennis" }],
    });
    check(poll.status === 200 && Boolean(inviteToken), "Abstimmung und Einladungslink stehen");
    await api(frida, "POST", "rpc/set_poll_guests", { p_poll_id: poll.json, p_allowed: true });
    const pollToken = (await api(frida, "POST", "rpc/poll_share_token", { p_poll_id: poll.json })).json;

    // Erik stimmt ohne Konto ab …
    await erik.page.goto(`${APP}/v/${pollToken}`);
    await erik.page.getByRole("heading", { level: 1, name: "Stimm mit ab" }).waitFor();
    await answer(erik, "Kickern", "Bin dabei").click();
    await answer(erik, "Tischtennis", "Vielleicht").click();
    await erik.page.getByLabel("Dein Name").fill("Erik");
    await erik.page.getByRole("button", { name: "Abstimmen" }).click();
    await erik.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Erik" }).waitFor();
    check(await erik.page.getByText(/nimmst du deine Stimme auf diesem Gerät mit/).isVisible(), "Gast erfährt, dass er seine Stimme mitnehmen kann");

    // … bekommt den Einladungslink, legt ein Konto an und tritt bei.
    await erik.page.goto(`${APP}/join/${inviteToken}`);
    await erik.page.waitForURL(/\/invite\/[0-9a-f]{64}$/);
    await register(erik, { here: true });
    await erik.page.getByRole("heading", { name: "Fast drin" }).waitFor();
    await erik.page.getByRole("button", { name: "Kiez Crew beitreten" }).click();
    await erik.page.waitForURL(new RegExp(`/crews/${crew.json}`));

    // Derselbe Link führt Mitglieder zur Abstimmung – dort wartet die Übernahme.
    await erik.page.goto(`${APP}/v/${pollToken}`);
    await erik.page.waitForURL(new RegExp(`/polls/${poll.json}`));
    const card = erik.page.getByRole("region", { name: "Du hast hier schon als Gast abgestimmt" });
    await card.waitFor();
    check(await card.getByText("Als „Erik“ hast du 2 Antworten gegeben.", { exact: false }).isVisible(), "Hinweis nennt Gastname und Zahl der Antworten");
    check((await optionCard(erik, "Kickern").getByText("1 Zusage").count()) === 1, "vor der Übernahme zählt die Gast-Zusage");
    await shot(erik, "12c-gast-stimmen-uebernehmen");

    // Frida (Mitglied ohne Gast-Stimme) sieht den Hinweis nicht.
    await frida.page.goto(`${APP}/polls/${poll.json}`);
    await frida.page.getByRole("heading", { name: "Kickern oder Tischtennis?" }).waitFor();
    check((await frida.page.getByRole("region", { name: "Du hast hier schon als Gast abgestimmt" }).count()) === 0, "ohne Gast-Stimme auf dem Gerät kein Hinweis");

    await card.getByRole("button", { name: "Stimmen übernehmen" }).click();
    await toast(erik, "2 Antworten übernommen.");
    await card.waitFor({ state: "detached" });
    // Die eigenen Antworten kommen mit dem nächsten Laden der Abstimmung – darauf warten statt sofort zu lesen.
    await answered(erik, "Kickern", "Bin dabei").waitFor();
    check(true, "die Zusage ist jetzt Eriks eigene Antwort");
    await answered(erik, "Tischtennis", "Vielleicht").waitFor();
    check(true, "„Vielleicht“ ebenso");
    await optionCard(erik, "Kickern").getByText("1 Zusage").waitFor();
    check(true, "keine doppelte Stimme: weiter 1 Zusage");
    check((await erik.page.getByText(/Gast hat mitgestimmt|Gäste haben mitgestimmt/).count()) === 0, "Erik zählt nicht mehr als Gast");
    check(await erik.page.evaluate((key) => localStorage.getItem(key) === null, `afterhours.guest.${pollToken}`), "das Gast-Geheimnis ist vom Gerät gelöscht");
    await shot(erik, "12d-gast-stimmen-uebernommen");

    const guests = await api(frida, "GET", `poll_guests?select=id&poll_id=eq.${poll.json}`);
    check(guests.status === 200 && guests.json.length === 0, "in der Datenbank gibt es keinen Gast mehr");
    // Ohne Konto geht es nicht (Angriffe von Außenstehenden und mit fremdem Geheimnis prüft pgTAP).
    const attack = await api(null, "POST", "rpc/claim_poll_guest", { p_poll_id: poll.json, p_secret: "a".repeat(64), p_keep: true });
    check(attack.status >= 400, `API: ohne Konto keine Übernahme (${attack.status})`);
    const guess = await api(frida, "POST", "rpc/claim_poll_guest", { p_poll_id: poll.json, p_secret: "a".repeat(64), p_keep: true });
    check(guess.status === 400 && guess.json?.message === "guest_not_found", `API: geratenes Geheimnis findet keinen Gast (${guess.status} ${guess.json?.message})`);
  } finally {
    for (const user of [frida, erik]) {
      users.splice(users.indexOf(user), 1);
      await user.context.close();
    }
  }
});

await step("W3 Etappe 3 – Gäste treten vom Stimmzettel aus der Crew bei", async () => {
  if (!ANON) {
    console.log("   (übersprungen: SUPABASE_ANON_KEY fehlt)");
    return;
  }
  // Eigene kleine Crew: Greta (Owner) lässt Gäste mitstimmen und beitreten, Hanna kommt als Gast.
  const greta = await newUser("Greta", "desktop");
  const hanna = await newUser("Hanna", "mobile");
  try {
    await register(greta);
    await onboard(greta);
    const crew = await api(greta, "POST", "rpc/create_crew", { p_name: "Hof Crew", p_emoji: "🎲" });
    const poll = await api(greta, "POST", "rpc/create_poll", {
      p_crew_id: crew.json,
      p_title: "Spieleabend oder Karaoke?",
      p_ends_at: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(),
      p_options: [{ title: "Spieleabend" }, { title: "Karaoke" }],
    });
    check(crew.status === 200 && poll.status === 200, "Greta gründet die Hof Crew und startet eine Abstimmung");
    const pollToken = (await api(greta, "POST", "rpc/poll_share_token", { p_poll_id: poll.json })).json;

    // Freischalten in der App: erst Gäste, dann der Beitritt.
    await greta.page.goto(`${APP}/polls/${poll.json}`);
    await greta.page.getByRole("heading", { name: "Spieleabend oder Karaoke?" }).waitFor();
    check((await greta.page.getByRole("switch", { name: /Gäste dürfen der Crew beitreten/ }).count()) === 0, "Beitritt erst wählbar, wenn Gäste mitstimmen");
    await greta.page.getByRole("switch", { name: /Gäste dürfen mitstimmen/ }).click();
    await toast(greta, "Gäste können jetzt über den geteilten Link mitstimmen.");
    await greta.page.getByRole("switch", { name: /Gäste dürfen der Crew beitreten/ }).click();
    await toast(greta, "Gäste können der Crew jetzt nach dem Abstimmen beitreten.");
    await greta.page.getByRole("switch", { name: /Gäste dürfen der Crew beitreten/, checked: true }).waitFor();
    check(true, "Owner schaltet den Beitritt frei");
    await shot(greta, "12e-gaeste-beitreten-schalter");

    // Hanna stimmt ohne Konto ab – erst danach erscheint der Beitritt.
    await hanna.page.goto(`${APP}/v/${pollToken}`);
    await hanna.page.getByRole("heading", { level: 1, name: "Stimm mit ab" }).waitFor();
    check((await hanna.page.getByTestId("guest-join").count()) === 0, "vor dem Abstimmen kein Beitritt");
    await answer(hanna, "Spieleabend", "Bin dabei").click();
    await hanna.page.getByLabel("Dein Name").fill("Hanna");
    await hanna.page.getByRole("button", { name: "Abstimmen" }).click();
    await hanna.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Hanna" }).waitFor();
    const joinCard = hanna.page.getByRole("region", { name: "Komm in die Crew, Hanna" });
    await joinCard.waitFor();
    check(!/Hof Crew|Greta/.test(await hanna.page.locator("body").innerText()), "Stimmzettel verrät vor dem Beitritt weder Crew-Namen noch Mitglieder");
    await joinCard.scrollIntoViewIfNeeded();
    await shot(hanna, "12f-gast-crew-beitreten");
    for (const viewport of ["tablet", "desktop"]) {
      await hanna.page.setViewportSize(VIEWPORTS[viewport]);
      await shot({ ...hanna, viewport }, "12f-gast-crew-beitreten");
    }
    await hanna.page.setViewportSize(VIEWPORTS.mobile);

    // Ein Tipp: persönliche Einladung, Konto anlegen, beitreten.
    await joinCard.getByRole("button", { name: "Crew beitreten" }).click();
    await hanna.page.waitForURL(/\/invite\/[0-9a-f]{64}$/);
    await hanna.page.getByText(/Hof Crew/).first().waitFor();
    check(true, "die Einladung zeigt jetzt die Crew");
    const inviteToken = hanna.page.url().split("/invite/")[1];
    await register(hanna, { here: true });
    await hanna.page.getByRole("heading", { name: "Fast drin" }).waitFor();
    await hanna.page.getByRole("button", { name: "Hof Crew beitreten" }).click();
    await hanna.page.waitForURL(new RegExp(`/crews/${crew.json}`));
    check(true, "Hanna ist mit dem Link aus dem Stimmzettel in der Crew");

    // Danach wartet auf der Abstimmung die Übernahme der Gast-Stimme (Etappe 2).
    await hanna.page.goto(`${APP}/v/${pollToken}`);
    await hanna.page.waitForURL(new RegExp(`/polls/${poll.json}`));
    await hanna.page.getByRole("region", { name: "Du hast hier schon als Gast abgestimmt" }).waitFor();
    check(true, "nach dem Beitritt: Stimme übernehmen");

    // Der persönliche Link gilt nur einmal; die Crew-Einladungsliste zeigt ihn nicht.
    const reuse = await api(greta, "POST", "rpc/preview_public_invitation", { p_token: inviteToken });
    check(reuse.json?.status === "exhausted", `Gast-Link ist verbraucht (${reuse.json?.status})`);
    // Ohne Abstimmen kein Link (pgTAP prüft Freigabe, Widerruf und Rollen).
    const attack = await api(null, "POST", "rpc/guest_join_shared_poll", { p_token: pollToken, p_secret: "a".repeat(64) });
    check(attack.status === 400 && attack.json?.message === "guest_not_found", `API: ohne eigene Gast-Stimme kein Link (${attack.status} ${attack.json?.message})`);
  } finally {
    for (const user of [greta, hanna]) {
      users.splice(users.indexOf(user), 1);
      await user.context.close();
    }
  }
});

await step("Schritt 7 – Abstimmung beenden, Ergebnis", async () => {
  const { page } = alice;
  check((await bob.page.getByRole("button", { name: "Abstimmung beenden" }).count()) === 0, "nur die Erstellerin sieht „Abstimmung beenden“");
  await page.getByRole("button", { name: "An Abstimmung erinnern" }).click();
  await toast(alice, "Alle haben schon abgestimmt – niemand wurde erinnert.");
  await page.getByRole("button", { name: "Abstimmung beenden" }).click();
  await dialog(alice).getByRole("button", { name: "Abstimmung beenden" }).click();
  await page.getByRole("heading", { name: "Es wird Strike District Bowling" }).waitFor();
  check(true, "Ergebnis: die Option mit den meisten Zusagen gewinnt");
  check((await page.getByRole("radiogroup").count()) === 0, "nach dem Ende kann niemand mehr abstimmen");
  await shot(alice, "13-ergebnis");
  await bob.page.reload();
  await bob.page.getByRole("heading", { name: "Es wird Strike District Bowling" }).waitFor();
  check(await bob.page.getByText("Wer die Abstimmung gestartet hat, kann jetzt den Plan daraus machen.").isVisible(), "Mitglieder sehen das Ergebnis, aber keine Organisationsaktionen");
});

await step("Schritt 8 – Aus dem Ergebnis einen Plan machen", async () => {
  const { page } = alice;
  await page.getByRole("button", { name: "Plan erstellen" }).click();
  await dialog(alice).getByRole("heading", { name: "Plan festmachen" }).waitFor();
  check((await dialog(alice).getByLabel("Titel").inputValue()) === "Strike District Bowling", "Plan übernimmt den Titel der Option");
  check((await dialog(alice).getByLabel("Treffpunkt").inputValue()) === "U-Bahn Ausgang Nord", "Plan übernimmt den Treffpunkt der Abstimmung");
  await dialog(alice).getByLabel("Adresse").waitFor();
  await page.waitForFunction(() => document.querySelector('input[name="plan_address"]')?.value.includes("Demochaussee"));
  check(true, "Plan übernimmt die Adresse des Ortes");
  await dialog(alice).getByRole("button", { name: "Plan erstellen" }).click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}/);
  ids.plan = idFromUrl(page);
  await page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  check(await page.getByText("Bestätigt").first().isVisible(), "Plan aus der Abstimmung ist bestätigt");
  await shot(alice, "14-plan");
});

await step("Schritt 9 – Teilnehmer bestätigen", async () => {
  await bob.page.goto(`${APP}/home`);
  await bob.page.getByText("Deine Antwort fehlt").first().waitFor();
  await shot(bob, "15-home");
  // D7: Seitenwechsel laufen als View Transition; das angetippte Ticket wird zum großen Ticket der Planseite.
  const viewTransitions = await bob.page.evaluate(() => typeof document.startViewTransition === "function");
  if (viewTransitions) {
    await bob.page.evaluate(() => {
      window.__vt = [];
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (update) =>
        start(async () => {
          const before = [...document.querySelectorAll("*")].filter((el) => el.style?.viewTransitionName === "plan-ticket").length;
          await update();
          window.__vt.push({ before, after: document.querySelectorAll(".vt-plan-ticket").length });
        });
    });
    // Die Seiten werden im Leerlauf vorgeladen; erst dann gleitet das Ticket ohne Ladezustand hinüber.
    await bob.page.waitForTimeout(1000);
  }
  await bob.page.getByRole("link", { name: /Strike District Bowling/ }).first().click();
  await bob.page.waitForURL(new RegExp(`/plans/${ids.plan}`));
  if (viewTransitions) {
    await bob.page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
    const vt = await bob.page.evaluate(() => window.__vt);
    check(vt.length === 1 && vt[0].before === 1 && vt[0].after === 1, `Ticket gleitet per View Transition zur Planseite (${JSON.stringify(vt)})`);
  }
  await bob.page.getByRole("radiogroup", { name: "Bist du dabei?" }).getByRole("radio", { name: "Bin dabei" }).click();
  await toast(bob, "Antwort gespeichert.");
  // D7: Der Abriss trägt die eigene Antwort – grün dabei, gelb vielleicht, rot abgesagt – mit Stempel.
  const answerOf = (user) => user.page.locator(".ticket-feature-wrap").getAttribute("data-answer");
  await bob.page.locator('.ticket-feature-wrap[data-answer="going"]').waitFor();
  check((await bob.page.locator(".ticket-feature .ticket-stamp").innerText()).toLowerCase() === "dabei", "Zusage: grünes Ticket mit Stempel „Dabei“");
  await shot(bob, "16-plan");
  await carol.page.goto(`${APP}/plans/${ids.plan}`);
  await carol.page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  check((await answerOf(carol)) === "invited" && (await carol.page.locator(".ticket-feature .ticket-stamp").count()) === 0, "Ohne Antwort: graues Ticket mit Strichcode statt Stempel");
  await carol.page.getByRole("radiogroup", { name: "Bist du dabei?" }).getByRole("radio", { name: "Vielleicht" }).click();
  await carol.page.locator('.ticket-feature-wrap[data-answer="maybe"]').waitFor();
  check((await carol.page.locator(".ticket-feature .ticket-stamp").innerText()).toLowerCase() === "vielleicht", "Vielleicht: gelbes Ticket mit Stempel");
  await toast(carol, "Antwort gespeichert.");
  await shot(carol, "16b-plan-vielleicht");
  await carol.page.getByRole("radiogroup", { name: "Bist du dabei?" }).getByRole("radio", { name: "Kann nicht" }).click();
  await carol.page.locator('.ticket-feature-wrap[data-answer="declined"]').waitFor();
  check((await carol.page.locator(".ticket-feature .ticket-stamp").innerText()).toLowerCase() === "abgesagt", "Absage: rotes Ticket mit Stempel „Abgesagt“");
  await shot(carol, "16-plan");
  await alice.page.reload();
  await alice.page.getByText("Dabei (2)").waitFor();
  await alice.page.getByText("Abgesagt (1)").waitFor();
  check(true, "Organisatorin sieht Zu- und Absagen");
  check((await carol.page.getByRole("button", { name: "Plan absagen" }).count()) === 0, "Mitglieder können den Plan nicht absagen");
  // D0: Nach der Zusage ist der Plan das große Ticket auf Home, die Überschrift zählt herunter.
  await bob.page.goto(`${APP}/home`);
  const heroTicket = bob.page.locator(".ticket-feature");
  await heroTicket.waitFor();
  check((await heroTicket.getAttribute("href"))?.endsWith(`/plans/${ids.plan}`), "Home zeigt den zugesagten Plan als großes Ticket");
  const headline = await bob.page.getByRole("heading", { level: 1 }).innerText();
  check(/^(HEUTE|HEUTE ABEND|MORGEN|NOCH \d+ TAGE BIS) STRIKE DISTRICT BOWLING$/.test(headline.replace(/\s+/g, " ").trim().toUpperCase()), `Überschrift zählt bis zum Plan herunter (${headline})`);
  check(/2\s*von \d+ dabei/.test(await heroTicket.innerText()), "großes Ticket zeigt Zusagen von allen Eingeladenen");
  await shot(bob, "15b-home-ticket");
  // Schritt 10 erwartet Bob wieder auf der Planseite.
  await bob.page.goto(`${APP}/plans/${ids.plan}`);
  await bob.page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  // D0 Etappe 5a: Kopf der Planseite ist das große Ticket – ohne Link, Titel als h1, mit Countdown.
  const planTicket = bob.page.locator(".ticket-feature");
  check((await planTicket.count()) === 1 && (await planTicket.getAttribute("href")) === null, "Planseite zeigt den Plan als großes Ticket (ohne Link)");
  check((await planTicket.getByRole("heading", { level: 1 }).count()) === 1, "Titel des Plans steht als Überschrift im Ticket");
  check(/(heute|heute abend|morgen|in \d+ tagen)/i.test(await planTicket.innerText()), "Ticket zählt bis zum Plan herunter");
  check((await bob.page.locator("#attendance-heading .text-lime").innerText()).toLowerCase() === "dabei", "„Bist du dabei?“ als Plakat mit Lime-Schlüsselwort");
  // D0 Etappe 5b: Auf der Crew-Seite ist der nächste Plan das große Ticket.
  await bob.page.goto(`${APP}/crews/${ids.crew}`);
  const crewTicket = bob.page.locator(".ticket-feature");
  await crewTicket.waitFor();
  check((await crewTicket.getAttribute("href"))?.endsWith(`/plans/${ids.plan}`), "Crew-Seite zeigt den nächsten Plan als großes Ticket");
  check((await bob.page.getByRole("heading", { level: 1 }).locator(".text-lime").innerText()).toLowerCase() === "crew", "Crew-Name als Plakat mit Lime-Schlüsselwort");
  await shot(bob, "16c-crew-ticket");
  // Schritt 10 erwartet Bob wieder auf der Planseite.
  await bob.page.goto(`${APP}/plans/${ids.plan}`);
  await bob.page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
});

await step("P5 – Wetter für Plantag und Ort (Bob, Carol)", async () => {
  // Die Edge Function fragt den Open-Meteo-Stellvertreter (14,2 °C, 70 % Regen, leichter Regen, Wind 12 km/h).
  const weather = bob.page.getByTestId("plan-weather");
  await weather.waitFor();
  check((await weather.innerText()).replace(/\s+/g, " ").trim() === "14 °C · Regen", `Wetter: Temperatur und Lage (${await weather.innerText()})`);
  const details = await bob.page.getByText(/Regenrisiko/).first().innerText();
  check(/^um \d{2} Uhr · 70 % Regenrisiko · Wind 12 km\/h$/.test(details.trim()), `Wetter: Uhrzeit des Plans, Regenrisiko, Wind (${details})`);
  check((await bob.page.getByRole("link", { name: "Open-Meteo" }).getAttribute("href")) === "https://open-meteo.com/", "Wetter: Quelle Open-Meteo mit Link");
  check(await bob.page.getByText(/^Vorhersage von Open-Meteo, Stand \d{2}:\d{2} Uhr/).isVisible(), "Wetter: Stand der Vorhersage");
  // Bowling ist drinnen – kein Hinweis auf einen Plan B trotz Regen.
  check((await bob.page.getByText(/Plan B/).count()) === 0, "Wetter: kein Draußen-Hinweis bei einem Ort drinnen");
  await weather.scrollIntoViewIfNeeded();
  await shot(bob, "16e-plan-wetter");

  // Die Crew teilt sich eine Abfrage: Alice und Bob haben den Plan geöffnet, gefragt wurde einmal.
  const calls = (await (await fetch("http://127.0.0.1:8089/weather-calls")).json()).calls.filter((q) => q.includes("latitude=52.52") && q.includes("longitude=13.50"));
  check(calls.length === 1, `Wetter: eine Abfrage bei Open-Meteo für die ganze Crew (${calls.length})`);
  check(calls.every((q) => !/plan|user|crew/i.test(q)), "Wetter: Open-Meteo erfährt nur Ort und Tag");

  // Fehlerzustand: Ist die Function nicht erreichbar, steht das dort – mit „Erneut versuchen“.
  const { page } = carol;
  await page.route("**/functions/v1/weather", (route) => route.abort());
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  const retry = page.getByRole("button", { name: "Erneut versuchen" });
  await retry.waitFor();
  check(await page.getByText(/Wetter gerade nicht abrufbar|Keine Verbindung/).first().isVisible(), "Wetter: Fehlerzustand statt erfundener Werte");
  await page.unroute("**/functions/v1/weather");
  await retry.click();
  await page.getByTestId("plan-weather").waitFor();
  check(true, "Wetter: „Erneut versuchen“ lädt die Vorhersage");
});

// W7 Etappe 1: Store-Screenshots aus dem echten Ablauf – Bobs Sitzung in zwei weiteren Kontexten mit den Maßen,
// die die Stores annehmen. Apple: 1290 × 2796 (6,9"), Google: 1080 × 1920 (9:16; Google erlaubt höchstens 2:1).
// Beide ohne Transparenz. Die Orte in Discover sind Demo-Daten und tragen in der App ihr „Beispieldaten“-Schild.
const STORE_SCREENS = [
  { key: "1-home", path: () => "/home", ready: (page) => page.locator(".ticket-feature").waitFor() },
  { key: "2-plan", path: () => `/plans/${ids.plan}`, ready: (page) => page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor() },
  { key: "3-abstimmung", path: () => `/polls/${ids.poll}`, ready: (page) => page.getByRole("heading", { name: "Es wird Strike District Bowling" }).waitFor() },
  { key: "4-discover", path: () => "/discover", ready: (page) => page.locator(".stage-card").waitFor() },
  { key: "5-crew", path: () => `/crews/${ids.crew}`, ready: (page) => page.locator(".ticket-feature").waitFor() },
];
const STORE_DEVICES = [
  { store: "ios", viewport: { width: 430, height: 932 }, size: [1290, 2796] },
  { store: "play", viewport: { width: 360, height: 640 }, size: [1080, 1920] },
];

await step("W7 – Store-Screenshots für App Store und Google Play (Bob)", async () => {
  const session = await bob.context.storageState();
  for (const device of STORE_DEVICES) {
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 3, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block", reducedMotion: "reduce", storageState: session });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on("pageerror", (e) => problems.push(`[Bob/${device.store}] pageerror: ${e}`));
      for (const screen of STORE_SCREENS) {
        await page.goto(`${APP}${screen.path()}`);
        await screen.ready(page);
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(overflow <= 1, `Store-Screenshot ${device.store}/${screen.key}: kein horizontaler Überlauf (${overflow}px)`);
        // 1290 × 2796 mit Aurora und Unschärfe braucht auf dem CI-Runner manchmal länger als 15 s.
        const png = await page.screenshot({ timeout: 60_000 });
        const [width, height, colorType] = [png.readUInt32BE(16), png.readUInt32BE(20), png[25]];
        check(width === device.size[0] && height === device.size[1] && colorType === 2, `Store-Screenshot ${device.store}/${screen.key}: ${width} × ${height}, ${colorType === 2 ? "ohne" : "mit"} Transparenz`);
        if (SHOTS) fs.writeFileSync(path.join(SHOTS, `store-${device.store}-${screen.key}.png`), png);
      }
    } finally {
      await context.close();
    }
  }
});

await step("W8 – Plan in den Gruppenchat teilen (Carol)", async () => {
  const { page, context } = carol;
  // W2: Die Planseite holt den Teilen-Link vorab; erst danach teilen, sonst ginge der direkte Plan-Link raus.
  const shareToken = page.waitForResponse((r) => r.url().includes("/rpc/plan_share_token") && r.ok());
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  await shareToken;
  await stubShare(page);
  await page.getByRole("button", { name: "Plan teilen" }).click();
  const shared = (await sharedData(page))[0];
  check(/\/s\/[0-9a-f]{32}$/.test(shared?.url ?? ""), `Plan teilen: Link mit Vorschau (/s/<token>) statt Plan-ID (${shared?.url})`);
  check(!(shared?.url ?? "").includes(ids.plan), "Plan teilen: der Link verrät die Plan-ID nicht");
  ids.shareUrl = shared?.url;
  check(/^Strike District Bowling – .+\. Bist du dabei\?$/.test(shared?.text ?? ""), `Plan teilen: Titel, Zeitpunkt, Frage („${shared?.text}“)`);
  check(!/Alice|Bob|Carol|@/.test(JSON.stringify(shared ?? {})), "Plan teilen: keine Namen oder E-Mail-Adressen im geteilten Text");
  await shot(carol, "16a-plan-teilen");
  // Rückfall ohne Teilen-Menü: Text und Link landen in der Zwischenablage.
  await unstubShare(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(APP).origin }).catch(() => {});
  await page.getByRole("button", { name: "Plan teilen" }).click();
  await toast(carol, "Text und Link kopiert");
  check(true, "Plan teilen ohne Web Share API: Text und Link werden kopiert");
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) check(clip.startsWith("Strike District Bowling – ") && clip.trim().endsWith(ids.shareUrl), "Zwischenablage enthält Text und Link");

  // P2 Etappe 1: Plan als Kalenderdatei – entsteht im Browser, ohne Namen oder E-Mail-Adressen.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "In den Kalender" }).click()]);
  check(download.suggestedFilename() === "strike-district-bowling.ics", `Kalenderdatei heißt nach dem Plan (${download.suggestedFilename()})`);
  const ics = fs.readFileSync(await download.path(), "utf8");
  const startsAt = DB_URL
    ? execFileSync("psql", [DB_URL, "-tAc", `select to_char(starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') from public.plans where id = '${ids.plan}'`], { encoding: "utf8" }).trim()
    : null;
  check(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.includes("\r\nBEGIN:VEVENT\r\n") && ics.endsWith("END:VCALENDAR\r\n"), "Kalenderdatei ist gültiges iCalendar mit CRLF");
  check(ics.includes(`UID:plan-${ids.plan}@afterhours`) && ics.includes("SUMMARY:Strike District Bowling"), "Kalenderdatei: feste UID und Titel");
  check(ics.includes("LOCATION:Demochaussee 220\\, 10365 Berlin"), "Kalenderdatei: Adresse mit maskiertem Komma");
  check(startsAt ? ics.includes(`\r\nDTSTART:${startsAt}\r\n`) : /\r\nDTSTART:\d{8}T\d{6}Z\r\n/.test(ics), `Kalenderdatei: Beginn in UTC${startsAt ? ` (${startsAt})` : ""}`);
  check(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75), "Kalenderdatei: Zeilen höchstens 75 Byte");
  check(!/Alice|Bob|Carol|ATTENDEE|ORGANIZER|@(?!afterhours)/.test(ics), "Kalenderdatei: keine Namen, Teilnehmer oder E-Mail-Adressen");
  await toast(carol, "Kalenderdatei geladen");
  // P2 Etappe 2: Daneben der Weg zum Abo aller Pläne.
  check((await page.getByRole("link", { name: "Alle Pläne automatisch: Kalender-Abo" }).getAttribute("href")) === "/settings#calendar", "Planseite verweist auf das Kalender-Abo");

  // Ticket-Countdown und „Beginnt in …“ zählen dieselben Kalendertage.
  const countdown = /in (\d+) tagen/i.exec(await page.locator(".ticket-feature").innerText())?.[1];
  const startsIn = /Beginnt in (\d+) Tagen/.exec(await page.locator("main").innerText())?.[1];
  if (countdown && startsIn) check(countdown === startsIn, `Countdown und „Beginnt in …“ stimmen überein (${countdown} = ${startsIn})`);
});

await step("W2 – Geteilter Plan: Vorschau im Messenger und für Freunde ohne Konto", async () => {
  if (!ids.shareUrl) throw new Error("kein Teilen-Link aus W8");
  const sharePath = new URL(ids.shareUrl).pathname;

  // Messenger lesen nur den <head>: Die Vercel-Funktion (api/share.js) gegen die echte lokale Datenbank.
  if (ANON) {
    const response = await handleShare(new Request(`${APP}${sharePath}`), { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: ANON }, fetch);
    const html = await response.text();
    const head = html.slice(0, html.indexOf("</head>"));
    check(head.includes('<meta property="og:title" content="Strike District Bowling · AFTERHOURS" />'), "Vorschau: Titel des Plans als og:title");
    check(/<meta property="og:description" content="[^"]+ · \d+ (sind|ist) dabei\. Bist du dabei\?" \/>/.test(head), "Vorschau: Zeit und Zahl der Zusagen als og:description");
    check(head.includes(`content="${APP}/og/plan.png"`), "Vorschau: absolutes Vorschaubild");
    check((head.match(/property="og:title"/g) ?? []).length === 1 && !head.includes("home.png"), "Vorschau: ersetzt die Vorschau der Startseite (W6) vollständig");
    check(!/Alice|Bob|Carol|Demochaussee|@example/.test(head), "Vorschau: keine Namen, keine Adresse");
    check(html.includes('<div id="root"></div>'), "Vorschau: Menschen bekommen die App");
    const image = await fetch(`${APP}/og/plan.png`);
    check(image.ok && image.headers.get("content-type") === "image/png", "Vorschaubild wird ausgeliefert");
  }

  // Freund ohne Konto: Karte mit Titel, Zeit, Zusagen – und der Weg in die App.
  const guest = await newUser("Gast", "mobile");
  try {
    await guest.page.goto(ids.shareUrl);
    await guest.page.getByRole("heading", { level: 1, name: "Bist du dabei?" }).waitFor();
    const ticket = guest.page.getByRole("region", { name: "Strike District Bowling" });
    await ticket.waitFor();
    check(/(\d+\s*sind dabei|ist dabei)/.test(await ticket.innerText()), "Gast sieht, wie viele dabei sind");
    check(!/Alice|Bob|Carol|Demochaussee/.test(await guest.page.locator("body").innerText()), "Gast sieht keine Namen und keine Adresse");
    check(await guest.page.getByRole("link", { name: "Konto erstellen" }).isVisible(), "Gast: Konto erstellen");
    await shot(guest, "16d-geteilter-plan-gast");
    for (const viewport of ["tablet", "desktop"]) {
      await guest.page.setViewportSize(VIEWPORTS[viewport]);
      await shot({ ...guest, viewport }, "16d-geteilter-plan-gast");
    }
    await guest.page.goto(`${APP}/s/${"0".repeat(32)}`);
    await guest.page.getByRole("heading", { level: 1, name: "Plan nicht gefunden" }).waitFor();
    check(true, "unbekannter Teilen-Link: ehrliche Fehlerseite");
  } finally {
    users.splice(users.indexOf(guest), 1);
    await guest.context.close();
  }

  // Mitglied der Crew: direkt zum Plan.
  await bob.page.goto(ids.shareUrl);
  await bob.page.waitForURL(new RegExp(`/plans/${ids.plan}$`));
  await bob.page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  check(true, "Mitglied: Teilen-Link führt direkt zum Plan");
});

await step("Schritt 10 – Durchführung vorbereiten: Kosten, Reservierung, Fahrgemeinschaft", async () => {
  const { page } = alice;
  check(await page.getByText("16 € pro Person").isVisible(), "Plan zeigt die Kostenschätzung pro Person (Richtwert des Ortes)");
  check(await page.getByText("32 € gesamt bei 2 Zusagen").isVisible(), "Gesamtkosten folgen den Zusagen");
  check(await page.getByText("Demochaussee 220, 10365 Berlin").first().isVisible(), "Plan zeigt die Adresse");

  await page.getByRole("button", { name: "Reservierung vorbereiten" }).click();
  check((await dialog(alice).getByLabel("Personen").inputValue()) === "2", "Reservierung schlägt die Zahl der Zusagen vor");
  await dialog(alice).getByLabel("Besondere Wünsche").fill("Bahn am Rand");
  await dialog(alice).getByRole("button", { name: "Entwurf speichern" }).click();
  await page.getByText("Entwurf – noch nichts angefragt.").waitFor();
  check(await page.getByText("Bestätigt").first().isVisible(), "ein Entwurf ändert den Plan-Status nicht");
  await page.getByRole("button", { name: "Anfrage starten" }).click();
  await dialog(alice).getByRole("button", { name: "Anfrage starten" }).click();
  await page.getByText("Was hat der Anbieter gesagt?").waitFor();
  check(await page.getByText("Reservierung ausstehend").first().isVisible(), "nach ausdrücklicher Freigabe: Reservierung ausstehend");
  await page.getByLabel("Bestätigungsnummer oder Name").fill("TEST-4711");
  await page.getByRole("button", { name: "Ergebnis eintragen" }).click();
  await page.getByText("Gebucht").first().waitFor();
  // „Gebucht“ steht schon vorher in der Statusleiste – deshalb auf die gespeicherte Nummer warten.
  check(await page.getByText("TEST-4711").waitFor().then(() => true, () => false), "Bestätigungsnummer ist festgehalten");
  check(await page.getByText(/Testmodus: Dieser Plan gehört zu einem Demo-Ort/).isVisible(), "Demo-Reservierung ist als Testmodus gekennzeichnet");
  await shot(alice, "17-reservierung");

  await page.getByRole("button", { name: "Fahrt anbieten" }).click();
  await dialog(alice).getByLabel("Abfahrtsort oder Treffpunkt").fill("Bahnhof Ostkreuz");
  await dialog(alice).getByLabel("Freie Plätze").fill("2");
  await dialog(alice).getByRole("button", { name: "Angebot speichern" }).click();
  await page.getByText("ab Bahnhof Ostkreuz").waitFor();
  await bob.page.reload();
  await bob.page.getByRole("button", { name: "Mitfahrt anfragen" }).click();
  await bob.page.getByText("Deine Anfrage: Angefragt").waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Mitnehmen" }).click();
  await page.getByText("1 Platz frei").waitFor();
  await bob.page.reload();
  await bob.page.getByText("Deine Anfrage: Bestätigt").waitFor();
  check(true, "Mitfahrt: Anfrage und Bestätigung durch die Fahrerin");
  await bob.page.goto(`${APP}/notifications`);
  await bob.page.getByText("Reservierung bestätigt").waitFor();
  await bob.page.getByText("Alice nimmt dich mit").waitFor();
  check(true, "Bob wurde über Reservierung und Mitfahrt benachrichtigt");
  await shot(bob, "18-benachrichtigungen");

  await page.getByRole("button", { name: "Plan bearbeiten" }).click();
  await dialog(alice).getByLabel("Treffpunkt").fill("Vor dem Eingang");
  await dialog(alice).getByRole("button", { name: "Änderungen speichern" }).click();
  await toast(alice, "Plan aktualisiert.");
  await carol.page.goto(`${APP}/notifications`);
  await carol.page.getByText("Alice hat einen Plan geändert: Treffpunkt").waitFor();
  check(true, "Planänderung benachrichtigt die Teilnehmenden – mit dem, was sich geändert hat");
});

await step("Schritt 11 – Abschluss, Punkte, Folgeaktivität", async () => {
  const { page } = alice;
  check((await page.getByRole("button", { name: "Als abgeschlossen markieren" }).count()) === 0, "vor Beginn lässt sich ein Plan nicht abschließen");
  if (!DB_URL) {
    console.log("   (E2E_DB_URL nicht gesetzt – Abschluss und Punktevergabe werden übersprungen)");
    return;
  }
  execFileSync("psql", [DB_URL, "-qc", `update public.plans set starts_at = now() - interval '2 hours' where id = '${ids.plan}'`]);
  await page.reload();
  await page.getByRole("button", { name: "Als abgeschlossen markieren" }).click();
  await dialog(alice).getByRole("button", { name: "Als abgeschlossen markieren" }).click();
  await page.getByText("Abgeschlossen").first().waitFor();
  await page.getByRole("heading", { name: "Was kommt als Nächstes?" }).waitFor();
  check(true, "abgeschlossener Plan schlägt Folgeaktivitäten vor");
  await page.goto(`${APP}/rewards`);
  await page.getByText("Plan organisiert").first().waitFor();
  check((await page.locator("section[aria-labelledby=balance-label]").innerText()).includes("40"), "Organisatorin erhält 30 + 10 Punkte");
  await shot(alice, "19-rewards");
  await bob.page.goto(`${APP}/rewards`);
  await bob.page.getByText("Dabei gewesen").first().waitFor();
  check((await bob.page.locator("section[aria-labelledby=balance-label]").innerText()).includes("10"), "Bob (zugesagt) erhält 10 Punkte");
  await shot(bob, "19-rewards");
  await carol.page.goto(`${APP}/rewards`);
  await carol.page.getByText("Noch keine Punkte").waitFor();
  check(true, "Carol (abgesagt) erhält keine Punkte");
});

await step("P3 – Kosten aufteilen: wer hat was ausgelegt, wer gibt wem", async () => {
  const { page } = alice;
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.getByRole("heading", { name: "Kosten teilen" }).waitFor();
  // Die Einträge laden nach der Überschrift – warten statt sofort prüfen (sonst wackelt der Schritt).
  check(await page.getByText("Wer hat etwas ausgelegt?").waitFor({ timeout: 10_000 }).then(() => true, () => false), "Leerzustand erklärt, wofür der Bereich da ist");

  // Alice hat die Bahn bezahlt; vorausgewählt sind die Zusagen (Alice, Bob) – Carol hat abgesagt.
  await page.getByRole("button", { name: "Ausgabe eintragen" }).click();
  const form = dialog(alice);
  check((await form.getByRole("button", { name: "Du", exact: true }).getAttribute("aria-pressed")) === "true", "Vorauswahl: ich");
  check((await form.getByRole("button", { name: "Bob", exact: true }).getAttribute("aria-pressed")) === "true", "Vorauswahl: Bob (zugesagt)");
  check((await form.getByRole("button", { name: "Carol", exact: true }).getAttribute("aria-pressed")) === "false", "Carol (abgesagt) ist nicht vorausgewählt");
  await form.getByRole("button", { name: "Eintragen" }).click();
  await form.getByText("Wofür war das?").waitFor();
  check(true, "Formular prüft die Beschreibung, bevor etwas gesendet wird");
  await form.getByLabel("Wofür?").fill("Bowlingbahn");
  await form.getByLabel("Betrag in Euro").fill("48");
  await form.getByText("je 24 € bei 2 Personen").waitFor();
  check(true, "Vorschau: je 24 € bei 2 Personen");
  await form.getByRole("button", { name: "Eintragen" }).click();
  await toast(alice, "Ausgabe eingetragen.");
  await page.getByText("Bob gibt dir").waitFor();
  check(await page.getByText("Du bekommst noch 24 €").isVisible(), "Alice sieht ihren Stand: bekommt 24 €");

  // Bob hat Getränke für alle drei bezahlt – Carol wählt er dazu.
  const b = bob.page;
  await b.goto(`${APP}/plans/${ids.plan}`);
  await b.getByText("Du gibst Alice").waitFor();
  await b.getByRole("button", { name: "Ausgabe eintragen" }).click();
  await dialog(bob).getByLabel("Wofür?").fill("Getränke");
  await dialog(bob).getByLabel("Betrag in Euro").fill("15,00");
  await dialog(bob).getByRole("button", { name: "Carol", exact: true }).click();
  await dialog(bob).getByText("je 5 € bei 3 Personen").waitFor();
  await dialog(bob).getByRole("button", { name: "Eintragen" }).click();
  await toast(bob, "Ausgabe eingetragen.");
  // Bob: −24 + 10 = −14, Carol −5, Alice +19 → zwei Überweisungen, beide an Alice.
  const rowOf = (p, text) => p.locator("li").filter({ hasText: text });
  await rowOf(b, "Du gibst Alice").filter({ hasText: "14 €" }).waitFor();
  check(await rowOf(b, "Carol gibt Alice").filter({ hasText: "5 €" }).isVisible(), "vereinfacht: Carol gibt Alice 5 €");
  check(await b.getByText("Du gibst noch 14 €").isVisible(), "Bob sieht seinen Stand: gibt 14 €");
  check((await rowOf(b, "Carol gibt Alice").getByRole("button", { name: /erledigt/i }).count()) === 0, "„Erledigt“ nur für die eigenen Überweisungen");
  await noOverflow(bob, "Kosten teilen");
  await shot(bob, "17b-kosten");

  // Bob hat Alice bar gegeben: „Erledigt“ trägt die Rückzahlung ein.
  await b.getByRole("button", { name: "Du gibst Alice 14 €: als erledigt markieren" }).click();
  await dialog(bob).getByRole("button", { name: "Erledigt" }).click();
  await toast(bob, "Rückzahlung eingetragen.");
  await b.getByText("Für dich ist alles ausgeglichen").waitFor();
  check((await b.getByText("Du gibst Alice").count()) === 0, "nach der Rückzahlung: Bob schuldet nichts mehr");
  check(await b.getByText("Du hast Alice 14 € zurückgegeben").isVisible(), "Rückzahlung steht in den Einträgen");

  await page.reload();
  await rowOf(page, "Carol gibt dir").filter({ hasText: "5 €" }).waitFor();
  check(await page.getByText("Du bekommst noch 5 €").isVisible(), "Alice bekommt nur noch Carols 5 €");
  check(await page.getByText("für dich, Bob und Carol").isVisible(), "Beteiligte in Alltagssprache: „für dich, Bob und Carol“");
  await page.getByRole("heading", { name: "Kosten teilen" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -24));
  await shot(alice, "17b-kosten");
  await carol.page.goto(`${APP}/notifications`);
  await carol.page.getByText("Bob hat „Getränke“ eingetragen").waitFor();
  check(await carol.page.getByText(/Dein Anteil: 5\s€/).first().isVisible(), "Carol erfährt ihren Anteil an den Getränken");
  await alice.page.goto(`${APP}/notifications`);
  await alice.page.getByText("Bob hat dir 14 € zurückgegeben").waitFor();
  check(true, "Alice erfährt von Bobs Rückzahlung");

  // Löschen: Bob nimmt seine Getränke zurück – danach schuldet Carol niemandem etwas.
  await b.getByRole("button", { name: "„Getränke“ löschen" }).click();
  await dialog(bob).getByRole("button", { name: "Löschen" }).click();
  await toast(bob, "Eintrag gelöscht.");
  await b.getByText("Du gibst noch 10 €").waitFor();
  check(true, "nach dem Löschen rechnet die App neu (24 € Anteil an der Bahn − 14 € zurückgegeben = 10 €)");
  check((await b.getByRole("button", { name: "„Bowlingbahn“ löschen" }).count()) === 0, "fremde Ausgaben kann Bob nicht löschen");

  // P3 Etappe 2 – ungleich aufteilen: Pizza 30 €, Bob hatte die große für 18 €, Alice bekommt den Rest.
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.getByText("Du bekommst noch 10 €").waitFor();
  await page.getByRole("button", { name: "Ausgabe eintragen" }).click();
  const pizza = dialog(alice);
  await pizza.getByLabel("Wofür?").fill("Pizza");
  await pizza.getByLabel("Betrag in Euro").fill("30");
  await pizza.getByRole("switch", { name: /Beträge je Person/ }).click();
  await pizza.getByLabel("Betrag für Bob").fill("18");
  await pizza.getByText("Das leere Feld bekommt den Rest: 12 €").waitFor();
  check((await pizza.getByLabel("Betrag für dich").getAttribute("placeholder")) === "12", "leeres Feld zeigt als Platzhalter, was es bekommt (12)");
  await pizza.getByLabel("Betrag für dich").fill("10");
  await pizza.getByText("Noch 2 € offen").waitFor();
  check(true, "Summenzeile sagt, was noch offen ist (2 €)");
  await pizza.getByLabel("Betrag für dich").fill("14");
  await pizza.getByText("2 € zu viel – zusammen 32 € statt 30 €").waitFor();
  await pizza.getByRole("button", { name: "Eintragen" }).click();
  await pizza.getByRole("alert").filter({ hasText: "2 € zu viel" }).waitFor();
  check(await pizza.getByLabel("Betrag für dich").isVisible(), "zu viel: Formular bleibt offen mit Fehlermeldung, nichts wird gesendet");
  await pizza.getByLabel("Betrag für dich").fill("12");
  await pizza.getByText("Passt auf den Cent: zusammen 30 €").waitFor();
  check(true, "Summenzeile bestätigt: passt auf den Cent");
  await noOverflow(alice, "Ausgabe eintragen");
  await shot(alice, "17c-kosten-ungleich");
  await pizza.getByRole("button", { name: "Eintragen" }).click();
  await toast(alice, "Ausgabe eingetragen.");
  await page.getByText("für dich (12 €) und Bob (18 €)").waitFor();
  check(true, "Eintrag zeigt die Beträge je Person: „für dich (12 €) und Bob (18 €)“");
  check(await page.getByText("Du bekommst noch 28 €").isVisible(), "Alice bekommt jetzt 28 € (10 € + Bobs 18 €)");
  await b.reload();
  await b.getByText("Du gibst noch 28 €").waitFor();
  check(true, "Bob sieht seinen ungleichen Anteil im Stand: gibt 28 €");
});

await step("Crew-Chat, Plans-Übersicht, Profil", async () => {
  await bob.page.goto(`${APP}/crews/${ids.crew}`);
  await bob.page.getByRole("tab", { name: "Chat" }).click();
  await bob.page.getByRole("textbox", { name: "Nachricht" }).fill("Bin Samstag pünktlich!");
  await bob.page.getByRole("button", { name: "Senden" }).click();
  await bob.page.getByText("Bin Samstag pünktlich!").waitFor();
  await shot(bob, "20-chat");
  await alice.page.goto(`${APP}/crews/${ids.crew}`);
  await alice.page.getByRole("tab", { name: "Chat" }).click();
  await alice.page.getByText("Bin Samstag pünktlich!").waitFor();
  check(true, "Nachricht erscheint bei anderen Mitgliedern");
  await alice.page.getByRole("tab", { name: "Übersicht" }).click();
  if (DB_URL) {
    // Der Plan wurde in Schritt 11 abgeschlossen – das ist der erste gemeinsame Abend.
    await alice.page.getByText("1 gemeinsamer Abend").waitFor();
    check(true, "Crew-Kopf zählt abgeschlossene Pläne als gemeinsame Abende");
  }
  await shot(alice, "21-crew");

  // P3 Etappe 3 – Offene Beträge der Crew: Alice bekommt aus dem Plan noch 28 € (Schritt P3).
  const balancesCard = alice.page.getByTestId("crew-balances");
  await balancesCard.getByText("Du bekommst insgesamt 28 €").waitFor();
  check(await balancesCard.getByText("bei 1 Abend offen").isVisible(), "Crew-Seite: offene Beträge über alle Abende (1 Abend)");
  const openRow = balancesCard.getByRole("link", { name: /Du bekommst 28 €/ });
  check((await openRow.count()) === 1, "Crew-Seite: der Abend steht mit eigenem Betrag in der Liste");
  await balancesCard.scrollIntoViewIfNeeded();
  await noOverflow(alice, "Offene Beträge");
  await shot(alice, "21b-crew-kosten");

  // P9 – Crew-Rückblick: der abgeschlossene Plan aus Schritt 11 ist der erste gemeinsame Abend.
  if (DB_URL) {
    const recap = alice.page.getByTestId("crew-recap");
    await recap.waitFor();
    check(/^1\s*gemeinsamer Abend/.test((await recap.locator("p").first().innerText()).trim()), "Rückblick: 1 gemeinsamer Abend");
    check(await recap.getByText(/^seit \S+ \d{4}$/).isVisible(), "Rückblick: seit Monat und Jahr des ersten Abends");
    check((await recap.getByRole("listitem").filter({ hasText: /: 1 Abend(?!e)/ }).count()) === 1, "Rückblick: ein Monat mit einem Abend in den letzten 12 Monaten");
    check((await recap.getByText("Eure Stammorte").count()) === 0, "Rückblick: ein einzelner Abend ist noch kein Stammort");
    check((await recap.getByText("Lieblingstag").count()) === 0, "Rückblick: kein Lieblingstag bei nur einem Abend");
    check(!/Alice|Bob|Carol/.test(await recap.innerText()), "Rückblick: keine Rangliste von Personen");
    await bob.page.getByRole("tab", { name: "Übersicht" }).click();
    const bobRecap = bob.page.getByTestId("crew-recap");
    await bobRecap.scrollIntoViewIfNeeded();
    await noOverflow(bob, "Crew-Rückblick");
    await shot(bob, "21c-crew-rueckblick");

    // P9 Etappe 2: Rückblick als Bild – mit Teilen-Menü für Dateien direkt ins Teilen …
    await bob.page.evaluate(() => {
      window.__shared = [];
      Object.defineProperty(navigator, "canShare", { configurable: true, value: (data) => Boolean(data?.files?.length) });
      Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => void window.__shared.push(data) });
    });
    await bob.page.getByRole("button", { name: "Als Bild teilen" }).click();
    await bob.page.waitForFunction(() => window.__shared?.length === 1, null, { timeout: 20_000 });
    const card = await bob.page.evaluate(async () => {
      const data = window.__shared[0];
      const file = data.files?.[0];
      const bitmap = await createImageBitmap(file);
      return { name: file.name, type: file.type, width: bitmap.width, height: bitmap.height, words: `${data.title ?? ""} ${data.text ?? ""}` };
    });
    check(card.type === "image/png" && card.width === 1080 && card.height === 1350, `Rückblick-Bild: PNG 1080 × 1350 (${card.type}, ${card.width} × ${card.height})`);
    check(/^afterhours-rueckblick-\d{4}-\d\d-\d\d\.png$/.test(card.name), `Rückblick-Bild: Dateiname mit Datum (${card.name})`);
    check(!/Alice|Bob|Carol|Weekend|Bowling/.test(card.words), `Rückblick-Bild: Begleittext ohne Namen und Orte („${card.words}“)`);
    // … ohne Teilen-Menü als Download.
    await bob.page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    });
    const download = bob.page.waitForEvent("download");
    await bob.page.getByRole("button", { name: "Als Bild teilen" }).click();
    const saved = await download;
    check(/^afterhours-rueckblick-\d{4}-\d\d-\d\d\.png$/.test(saved.suggestedFilename()), "Rückblick-Bild: ohne Teilen-Menü als Download");
    await toast(bob, "Bild gespeichert – schick es in euren Gruppenchat.");
    if (SHOTS) await saved.saveAs(path.join(SHOTS, "21d-rueckblick-bild.png"));
  } else {
    check((await alice.page.getByTestId("crew-recap").count()) === 0, "ohne abgeschlossenen Plan kein Rückblick");
  }
  await openRow.click();
  await alice.page.waitForURL(`**/plans/${ids.plan}#kosten`);
  const costsHeading = alice.page.getByRole("heading", { name: "Kosten teilen" });
  await costsHeading.waitFor();
  await alice.page.getByText("Du bekommst noch 28 €").waitFor();
  await alice.page.waitForFunction(() => {
    const top = document.getElementById("kosten")?.getBoundingClientRect().top;
    return top != null && top >= -2 && top < window.innerHeight - 40;
  }, null, { timeout: 5000 });
  check(true, "Tipp auf den Abend springt direkt zu „Kosten teilen“");
  await bob.page.goto(`${APP}/crews/${ids.crew}`);
  await bob.page.getByTestId("crew-balances").getByText("Du gibst insgesamt 28 €").waitFor();
  check(true, "Bob sieht auf der Crew-Seite: gibt insgesamt 28 €");

  // P3 Etappe 3b – Erinnerung an offene Beträge: eine Woche nach Abend und letztem Eintrag sind Bobs
  // 28 € noch offen. Abend und Einträge werden dafür kurz um acht Tage zurückdatiert.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const shift = (sign) =>
      psql(`update public.plans set starts_at = starts_at ${sign} interval '8 days' where id = '${ids.plan}';
            update public.plan_expenses set created_at = created_at ${sign} interval '8 days' where plan_id = '${ids.plan}'`);
    shift("-");
    try {
      await bob.page.goto(`${APP}/notifications`);
      const reminder = bob.page.getByRole("link", { name: /Bei „Strike District Bowling“ sind von dir noch 28\s€ offen/ });
      await reminder.waitFor();
      check(await reminder.getByText("Schon erledigt? Dann tippe bei „Kosten teilen“ auf „Erledigt“.").isVisible(), "Erinnerung sagt freundlich, was zu tun ist");
      await noOverflow(bob, "Erinnerung an offene Beträge");
      await shot(bob, "21d-erinnerung-offene-betraege");
      await bob.page.reload();
      await reminder.waitFor();
      check((await bob.page.getByRole("link", { name: /sind von dir noch 28\s€ offen/ }).count()) === 1, "Neuladen erinnert nicht noch einmal");
      await reminder.click();
      await bob.page.waitForURL(`**/plans/${ids.plan}#kosten`);
      await bob.page.getByText("Du gibst noch 28 €").waitFor();
      check(true, "Erinnerung führt direkt zu „Kosten teilen“");
      await alice.page.goto(`${APP}/notifications`);
      await alice.page.getByRole("link", { name: /Bei „Strike District Bowling“ bekommst du noch 28\s€/ }).waitFor();
      check(true, "Alice wird an die 28 € erinnert, die sie noch bekommt");
      check(psql(`select count(*) from public.notifications where type = 'plan_expense_reminder' and related_entity_id = '${ids.plan}'`) === "2", "je Person genau eine Erinnerung");
      await bob.page.goto(`${APP}/settings`);
      await bob.page.getByText("Erinnerung an offene Beträge").first().waitFor();
      check(true, "Erinnerung lässt sich in den Einstellungen abschalten");
    } finally {
      shift("+");
    }
  }

  await alice.page.goto(`${APP}/crews`);
  await alice.page.getByRole("link", { name: /Weekend Crew/ }).first().waitFor();
  const crewsTitle = alice.page.getByRole("heading", { level: 1 });
  await crewsTitle.waitFor();
  check(/^\d+ Freunde? in \d+ Crews?$/i.test((await crewsTitle.innerText()).trim()), `Crews-Überschrift zählt echte Freunde und Crews („${(await crewsTitle.innerText()).trim()}“)`);
  check(/^\d+ Freunde?$/i.test((await crewsTitle.locator(".text-lime").innerText()).trim()), "Crews-Überschrift hebt die Zahl der Freunde hervor");
  await shot(alice, "21-crews");
  for (const user of [alice, bob, carol]) {
    await user.page.goto(`${APP}/plans`);
    await user.page.getByRole("tab", { name: /Anstehend|Vergangen/ }).first().waitFor();
    if (DB_URL) await user.page.getByRole("tab", { name: "Vergangen" }).click();
    await user.page.getByRole("link", { name: /Strike District Bowling/ }).first().waitFor();
    const plansTitle = (await user.page.getByRole("heading", { level: 1 }).innerText()).trim();
    check(/^(\d+ Abende? in Sicht|\d+ Fragen? offen|Eure Pläne)$/i.test(plansTitle), `Plans-Überschrift aus echten Daten (${user.name}: „${plansTitle}“)`);
    await shot(user, "22-plans");
    await user.page.goto(`${APP}/home`);
    await user.page.getByRole("heading", { name: "Ideen für euch" }).waitFor();
    await shot(user, "23-home");
    await user.page.goto(`${APP}/profile`);
    await user.page.getByRole("heading", { level: 1, name: user.name }).waitFor();
    // D0 Etappe 5c: Das Profil ist eine Stammkarte im Ticket-Stil; der Abriss zählt erlebte Abende.
    const pass = user.page.locator(".profile-pass");
    check((await pass.getByRole("heading", { level: 1 }).count()) === 1, `Profil-Name steht als Überschrift auf der Stammkarte (${user.name})`);
    await pass.locator(".ticket-stub").getByText(/^\d+$/).waitFor();
    const stub = (await pass.locator(".ticket-stub").innerText()).replace(/\s+/g, " ").trim();
    check(/^\d+ abende? erlebt$/i.test(stub), `Abriss zählt erlebte Abende (${user.name}: „${stub}“)`);
    if (DB_URL && user !== carol) check(!/^0 /.test(stub), `abgeschlossener Plan zählt als erlebter Abend (${user.name})`);
    check(/dabei seit \S+ \d{4}/i.test(await pass.innerText()), "Stammkarte zeigt „Dabei seit“ aus dem Kontodatum");
    await shot(user, "24-profil");
  }
});

await step("Gleichstand, Stichwahl und Fristablauf", async () => {
  const { page } = alice;
  await page.goto(`${APP}/polls/new?crew=${ids.crew}`);
  await page.getByLabel("Frage an die Crew").fill("Pizza oder Sushi?");
  await page.getByRole("button", { name: "Eigenen Vorschlag hinzufügen" }).click();
  await page.getByLabel("Vorschlag 1").fill("Pizza");
  await page.getByRole("button", { name: "Eigenen Vorschlag hinzufügen" }).click();
  await page.getByLabel("Vorschlag 2").fill("Sushi");
  await page.getByRole("button", { name: "in 2 Stunden" }).click();
  await page.getByRole("button", { name: "Abstimmung starten" }).click();
  await page.waitForURL(/\/polls\/[0-9a-f-]{36}/);
  const tiePoll = idFromUrl(page);
  await answer(alice, "Pizza", "Bin dabei").click();
  await bob.page.goto(`${APP}/polls/${tiePoll}`);
  await answer(bob, "Sushi", "Bin dabei").click();
  await optionCard(bob, "Sushi").getByText("1 Zusage").waitFor();
  await page.reload();
  await optionCard(alice, "Sushi").getByText("1 Zusage").waitFor();
  await page.getByRole("button", { name: "Abstimmung beenden" }).click();
  await dialog(alice).getByRole("button", { name: "Abstimmung beenden" }).click();
  await page.getByRole("heading", { name: "Gleichstand" }).waitFor();
  check(true, "Gleichstand wird als solcher ausgewiesen (kein Gewinner)");
  check((await page.getByRole("button", { name: "Mit dieser Option planen" }).count()) === 2, "bei Gleichstand kann die Erstellerin eine der Optionen wählen");
  await shot(alice, "29-gleichstand");
  await page.getByRole("button", { name: "Stichwahl starten" }).click();
  await dialog(alice).getByRole("button", { name: "Stichwahl starten" }).click();
  await page.waitForURL((url) => /\/polls\/[0-9a-f-]{36}/.test(url.pathname) && !url.pathname.endsWith(tiePoll));
  const runoff = idFromUrl(page);
  await page.getByRole("heading", { name: "Stichwahl: Pizza oder Sushi?" }).waitFor();
  check((await page.getByRole("radiogroup").count()) === 2, "Stichwahl enthält die gleichauf liegenden Optionen");

  if (!DB_URL) {
    console.log("   (E2E_DB_URL nicht gesetzt – Fristablauf wird übersprungen)");
    return;
  }
  // Frist läuft ab, während die Abstimmung noch "open" ist: Die App stellt das Ergebnis beim Öffnen fest.
  await answer(alice, "Pizza", "Bin dabei").click();
  await optionCard(alice, "Pizza").getByText("1 Zusage").waitFor();
  execFileSync("psql", [DB_URL, "-qc", `update public.polls set ends_at = now() - interval '1 minute' where id = '${runoff}'`]);
  await bob.page.goto(`${APP}/polls/${runoff}`);
  await bob.page.getByRole("heading", { name: "Es wird Pizza" }).waitFor();
  check(true, "abgelaufene Abstimmung wird automatisch ausgewertet, sobald ein Mitglied sie öffnet");
  check((await bob.page.getByRole("radiogroup").count()) === 0, "nach Fristablauf ist keine Stimmabgabe mehr möglich");
});

await step("Plan direkt anlegen: Vorschlag → bestätigt → abgesagt (Carol)", async () => {
  const { page } = carol;
  await page.goto(`${APP}/discover`);
  await page.getByRole("button", { name: "Berlin" }).click();
  await page.getByRole("link", { name: "Schwarzlicht Minigolf 18" }).click();
  await page.getByRole("link", { name: "Plan erstellen" }).click();
  await page.waitForURL(/\/plans\/new/);
  await page.waitForFunction(() => document.querySelector('input[name="title"]')?.value === "Schwarzlicht Minigolf 18");
  check((await page.getByLabel("Adresse").inputValue()) === "Beispielufer 9, 10999 Berlin", "Plan-Formular übernimmt Titel und Adresse des Ortes");
  await page.getByRole("button", { name: "Plan erstellen" }).click();
  check(await page.getByText("Bitte wähle Datum und Uhrzeit.").isVisible(), "Plan-Formular verlangt ein Datum");
  const inTenDays = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
  await page.getByLabel("Datum").fill(inTenDays);
  await shot(carol, "30-plan-erstellen");
  await page.getByRole("button", { name: "Plan erstellen" }).click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}/);
  await page.getByText("Dieser Plan ist ein Vorschlag und noch nicht bestätigt.").waitFor();
  check(true, "direkt angelegter Plan startet als Vorschlag");
  check((await page.getByRole("button", { name: "Reservierung vorbereiten" }).count()) === 0, "Reservierung erst nach Bestätigung des Plans");
  await page.getByRole("button", { name: "Plan bestätigen" }).click();
  await toast(carol, "Plan bestätigt.");
  await page.getByRole("button", { name: "Reservierung vorbereiten" }).waitFor();
  // D6: Bob antwortet direkt auf Home – ohne die Planseite zu öffnen.
  await bob.page.goto(`${APP}/home`);
  const quick = bob.page.getByRole("group", { name: "Deine Antwort zu „Schwarzlicht Minigolf 18“" });
  await quick.waitFor();
  await shot(bob, "32-home-zusage");
  await quick.getByRole("button", { name: "Vielleicht" }).click();
  await toast(bob, "Antwort gespeichert.");
  await quick.waitFor({ state: "detached" });
  check(true, "Zusage direkt auf Home: Antwort gespeichert, der Plan verlässt „Deine Antwort fehlt“");
  const minigolf = bob.page.locator('[data-answer="maybe"]').filter({ hasText: "Schwarzlicht Minigolf 18" });
  await minigolf.first().waitFor();
  check(true, "Ticket auf Home trägt danach die Farbe der Antwort (vielleicht)");
  await page.getByRole("button", { name: "Plan absagen" }).click();
  await dialog(carol).getByRole("button", { name: "Plan absagen" }).click();
  await toast(carol, "Plan abgesagt.");
  await page.getByText("Abgesagt").first().waitFor();
  // „Abgesagt“ steht auch als Gruppe in der Teilnehmerliste – auf den neuen Planstatus warten, nicht nur auf das Wort.
  await page.getByRole("button", { name: "Plan bearbeiten" }).waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  check((await page.getByRole("button", { name: "Plan bearbeiten" }).count()) === 0, "abgesagter Plan lässt sich nicht mehr bearbeiten");
  await alice.page.goto(`${APP}/notifications`);
  await alice.page.getByText("Carol hat einen Plan abgesagt").waitFor();
  check(true, "Absage benachrichtigt die Crew");
  await shot(alice, "31-benachrichtigungen");
});

await step("P8 – Stammtisch: Plan wiederholt sich von selbst (Alice, Bob)", async () => {
  if (!DB_URL) {
    console.log("   (E2E_DB_URL nicht gesetzt – übersprungen)");
    return;
  }
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const title = `Stammtisch ${RUN}`;
  // In 5 Tagen um 20:00 Berliner Zeit; Alice organisiert.
  const planId = psql(`insert into public.plans (crew_id, created_by, title, starts_at, address, status)
    select '${ids.crew}', created_by, '${title}', ((now() at time zone 'Europe/Berlin')::date + 5 + time '20:00') at time zone 'Europe/Berlin', 'Eckkneipe, Hauptstr. 1', 'confirmed'
    from public.plans where id = '${ids.plan}' returning id;
    insert into public.plan_participants (plan_id, user_id)
    select p.id, m.user_id from public.plans p join public.crew_members m on m.crew_id = p.crew_id where p.title = '${title}';`).split("\n")[0];
  const dayLabel = (offset) => {
    const d = new Date(Date.now() + offset * 86400_000);
    return {
      weekday: new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long" }).format(d),
      long: new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long" }).format(d),
    };
  };
  const first = dayLabel(5);
  try {
    // Alice stellt „Jeden <Wochentag>“ ein.
    await alice.page.goto(`${APP}/plans/${planId}`);
    const card = alice.page.getByRole("region", { name: "Regelmäßig" });
    await card.waitFor();
    check((await card.getByRole("button", { name: "Speichern" }).isDisabled()), "Wiederholen: ohne Änderung nichts zu speichern");
    const options = await card.getByLabel("Wiederholen").locator("option").allInnerTexts();
    check(options.includes(`Jeden ${first.weekday}`) && options.includes(`Jeden zweiten ${first.weekday}`) && options.includes("Nur dieses Mal"),
      `Wiederholen bietet „Jeden ${first.weekday}“, „Jeden zweiten ${first.weekday}“ und „Nur dieses Mal“ (${options.join(" / ")})`);
    await card.getByLabel("Wiederholen").selectOption("weekly");
    await card.getByRole("button", { name: "Speichern" }).click();
    await toast(alice, "Wiederholung gespeichert.");
    await alice.page.getByTestId("repeat-line").filter({ hasText: `Jeden ${first.weekday}` }).waitFor();
    check(true, "Planseite zeigt die Regel unter „Wann?“");
    const next = dayLabel(12);
    await card.getByText(`steht der nächste Termin am ${next.long} von selbst in der App`).waitFor();
    check(true, `Karte nennt den nächsten Termin (${next.long})`);
    await shot(alice, "33-plan-wiederholen");
    check(psql(`select count(*) from public.plans where series_id is not null and title = '${title}'`) === "1", "solange der Abend ansteht, gibt es keinen zweiten Termin");

    // Bob (Mitglied) sieht die Regel, stellt aber nichts ein.
    await bob.page.goto(`${APP}/plans/${planId}`);
    await bob.page.getByTestId("repeat-line").waitFor();
    check((await bob.page.getByRole("region", { name: "Regelmäßig" }).count()) === 0, "Mitglieder ohne Verwaltungsrecht sehen keine Einstellung");
    if (ANON) {
      const probe = await api(bob, "POST", "rpc/set_plan_repeat", { p_plan_id: planId, p_rule: "none" });
      check(probe.status === 403, `API: Bob kann die Wiederholung von Alices Plan nicht beenden (HTTP ${probe.status})`);
    }

    // Zeit vergehen lassen: Der Abend liegt zwei Stunden zurück. Öffnet Bob seine Pläne, steht der nächste da.
    psql(`update public.plans set starts_at = now() - interval '2 hours' where id = '${planId}';
          update public.plan_series s set last_on = ((now() - interval '2 hours') at time zone 'Europe/Berlin')::date
          from public.plans p where p.id = '${planId}' and s.id = p.series_id;`);
    await bob.page.goto(`${APP}/plans`);
    let nextId = "";
    for (let i = 0; i < 40 && !nextId; i++) {
      nextId = psql(`select id from public.plans where title = '${title}' and id <> '${planId}' limit 1`);
      if (!nextId) await new Promise((r) => setTimeout(r, 250));
    }
    check(Boolean(nextId), "nach dem Abend legt die App den nächsten Termin an");
    check(psql(`select count(*) from public.plans where title = '${title}'`) === "2", "genau ein neuer Termin");
    check(psql(`select status from public.plans where id = '${nextId}'`) === "proposed", "neuer Termin startet als Vorschlag");
    check(psql(`select count(*) from public.plan_participants where plan_id = '${nextId}' and attendance_status <> 'invited'`) === "0", "niemand ist automatisch zugesagt");
    await bob.page.getByText(title).first().waitFor();
    check(true, "Plans-Übersicht zeigt den neuen Termin");
    // P8 Etappe 3: Termine eines Stammtischs tragen „↻ Stammtisch“ auf dem Ticket, andere nicht.
    const seriesTicket = bob.page.locator(`a[href="/plans/${nextId}"]`).first();
    await seriesTicket.waitFor();
    check(await seriesTicket.getByTestId("ticket-series").isVisible(), "Ticket in der Planliste trägt „Stammtisch“");
    const mark = (await seriesTicket.getByTestId("ticket-series").innerText()).trim();
    check(/^Stammtisch(\s*:\s*Jeden \S+)?$/.test(mark), `Kennzeichen heißt „Stammtisch“, für Screenreader mit Regel (${mark.replace(/\s+/g, " ")})`);
    await noOverflow(bob, "Planliste mit Stammtisch");
    await shot(bob, "35b-stammtisch-ticket");
    // Auf der Crew-Seite stehen auch vergangene Abende ohne Serie – die tragen kein Kennzeichen.
    await bob.page.goto(`${APP}/crews/${ids.crew}`);
    await bob.page.getByTestId("ticket-series").first().waitFor();
    const otherTickets = bob.page.locator('a.ticket[href^="/plans/"]').filter({ hasNotText: title });
    const withMark = await otherTickets.filter({ has: bob.page.getByTestId("ticket-series") }).count();
    check((await otherTickets.count()) > 0 && withMark === 0, `Tickets ohne Serie tragen kein Kennzeichen (${await otherTickets.count()} geprüft)`);
    await bob.page.goto(`${APP}/notifications`);
    await bob.page.getByText("Der nächste Termin steht – bist du dabei?").first().waitFor();
    check(true, "Benachrichtigung zum neuen Termin");
    await bob.page.goto(`${APP}/plans/${nextId}`);
    await bob.page.getByTestId("repeat-line").waitFor();
    await bob.page.getByText("Dieser Plan ist ein Vorschlag und noch nicht bestätigt.").waitFor();
    await shot(bob, "33-plan-wiederkehrend");

    // P8 Etappe 2: Alice setzt diesen Termin aus – die Serie läuft weiter, der nächste steht sofort da.
    await alice.page.goto(`${APP}/plans/${nextId}`);
    const skipCard = alice.page.getByRole("region", { name: "Regelmäßig" });
    await skipCard.getByRole("button", { name: "Diesmal aussetzen" }).click();
    const skipDialog = alice.page.getByRole("dialog", { name: "Diesmal aussetzen?" });
    const skipConfirm = skipDialog.getByRole("button", { name: "Diesmal aussetzen" });
    await skipConfirm.waitFor();
    check(await skipDialog.getByText(/Der Stammtisch geht weiter/).isVisible(), "Rückfrage erklärt: nur dieser Abend fällt aus");
    await shot(alice, "33-plan-aussetzen-rueckfrage");
    await skipConfirm.click();
    await toast(alice, "Ausgesetzt – der nächste Termin steht schon.");
    let thirdId = "";
    for (let i = 0; i < 40 && !thirdId; i++) {
      thirdId = psql(`select id from public.plans where title = '${title}' and id not in ('${planId}', '${nextId}') limit 1`);
      if (!thirdId) await new Promise((r) => setTimeout(r, 250));
    }
    check(Boolean(thirdId), "nach dem Aussetzen steht der nächste Termin sofort da");
    await alice.page.waitForURL(`**/plans/${thirdId}`);
    check(true, "Alice landet auf dem nächsten Termin");
    check(psql(`select status || ':' || (skipped_at is not null) from public.plans where id = '${nextId}'`) === "cancelled:true", "ausgesetzter Termin ist abgesagt und markiert");
    check(psql(`select (p3.starts_at - p2.starts_at) = interval '7 days' from public.plans p2, public.plans p3 where p2.id = '${nextId}' and p3.id = '${thirdId}'`) === "t", "nächster Termin eine Woche später");
    check(psql(`select s.active from public.plan_series s join public.plans p on p.series_id = s.id where p.id = '${thirdId}'`) === "t", "die Serie läuft weiter");
    await alice.page.getByTestId("repeat-line").waitFor();

    // Bob erfährt es und sieht den Termin als „Ausgesetzt“ mit Sprung zum nächsten.
    await bob.page.goto(`${APP}/notifications`);
    await bob.page.getByText(/setzt diesmal aus/).first().waitFor();
    check(await bob.page.getByText(/^Nächster Termin: /).first().isVisible(), "Benachrichtigung nennt den nächsten Termin");
    await bob.page.goto(`${APP}/plans/${nextId}`);
    await bob.page.getByText("Dieser Termin wurde ausgesetzt. Der Stammtisch geht weiter.", { exact: false }).waitFor();
    check(await bob.page.getByText("Ausgesetzt", { exact: true }).first().isVisible(), "Ticket zeigt „Ausgesetzt“ statt „Abgesagt“");
    await shot(bob, "33-plan-ausgesetzt");
    await bob.page.locator(`main a[href$="/plans/${thirdId}"]`).first().click();
    await bob.page.waitForURL(`**/plans/${thirdId}`);
    check(true, "Link führt zum nächsten Termin");
    if (ANON) {
      const probe = await api(bob, "POST", "rpc/skip_plan_occurrence", { p_plan_id: thirdId });
      check(probe.status === 403, `API: Bob (Mitglied) kann Alices Termin nicht aussetzen (HTTP ${probe.status})`);
    }
  } finally {
    psql(`delete from public.plans where title = '${title}';
          delete from public.plan_series s where s.crew_id = '${ids.crew}' and not exists (select 1 from public.plans p where p.series_id = s.id);`);
  }
});

await step("P1 – Termin-Abstimmung „Wann könnt ihr?“ (Alice, Bob)", async () => {
  const { page } = alice;
  // Zwei Termine in 10 und 11 Tagen (Berliner Zeit); Titel wie auf dem Server: „Sonntag, 25. Oktober“.
  const berlinDate = (offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const label = (date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`));
  const [d1, d2] = [berlinDate(10), berlinDate(11)];
  const [l1, l2] = [label(d1), label(d2)];

  // P1 Etappe 2: „Termin finden“ direkt auf der Crew-Seite öffnet die Termin-Abstimmung.
  await page.goto(`${APP}/crews/${ids.crew}`);
  await page.getByRole("link", { name: "Termin finden" }).click();
  await page.waitForURL(/\/polls\/new\?crew=[0-9a-f-]{36}&kind=date/);
  await page.getByLabel(/^Termin \d+$/).first().waitFor();
  check((await page.getByRole("tab", { name: "Wann könnt ihr?" }).getAttribute("aria-selected")) === "true", "Crew-Seite: „Termin finden“ öffnet direkt „Wann könnt ihr?“");
  await page.getByRole("tab", { name: "Wann könnt ihr?" }).click();
  check((await page.getByLabel("Frage an die Crew").inputValue()) === "Wann könnt ihr?", "Termin-Abstimmung: Titelvorschlag „Wann könnt ihr?“");
  check((await page.getByLabel(/^Termin \d+$/).count()) === 3, "drei Termine sind vorgeschlagen (nächstes Wochenende und der Freitag danach)");
  check((await page.getByLabel("Budget pro Person").count()) === 0, "keine Orts-Felder (Budget, Kosten) bei Terminen");
  await page.getByRole("button", { name: "Termin 3 entfernen" }).click();
  check(await page.getByRole("button", { name: "Termin 2 entfernen" }).isDisabled(), "mindestens zwei Termine bleiben");
  await page.getByLabel("Termin 1", { exact: true }).fill(d1);
  await page.getByLabel("Uhrzeit").first().fill("20:00");
  await page.getByLabel("Termin 2", { exact: true }).fill(d1);
  await page.getByLabel("Uhrzeit").nth(1).fill("20:00");
  await page.getByRole("button", { name: "in 2 Stunden" }).click();
  await page.getByRole("button", { name: "Abstimmung starten" }).click();
  await page.getByText("Diesen Termin gibt es schon.").waitFor();
  check(true, "doppelter Termin wird vor dem Absenden erkannt");
  await page.getByLabel("Termin 2", { exact: true }).fill(d2);
  await page.getByLabel("Uhrzeit").nth(1).fill("");
  await shot(alice, "36-termin-abstimmung-erstellen");
  await page.getByRole("button", { name: "Abstimmung starten" }).click();
  await page.waitForURL(/\/polls\/[0-9a-f-]{36}/);
  const datePoll = idFromUrl(page);
  await page.getByText("Termin-Abstimmung").waitFor();
  check((await page.getByRole("radiogroup").count()) === 2, "zwei Termine zur Wahl");
  await optionCard(alice, l1).getByText("20:00 Uhr").waitFor();
  check(await optionCard(alice, l2).getByText("Uhrzeit offen").isVisible(), `Termine heißen wie das Datum (${l1}, ${l2}), ohne Uhrzeit „Uhrzeit offen“`);
  check((await page.getByText("Preis offen").count()) === 0, "bei Terminen kein Preis");

  await bob.page.goto(`${APP}/polls/${datePoll}`);
  await answer(bob, l2, "Bin dabei").click();
  await answer(bob, l1, "Bin nicht dabei").click();
  await optionCard(bob, l2).getByText("1 Zusage").waitFor();
  check(true, "Bob sagt, wann er kann – wie bei jeder Abstimmung");
  await shot(bob, "36-termin-abstimmung");

  // P1 Etappe 2: Teilen – Messenger-Vorschau mit den Terminen, Stimmzettel für Gäste fragt „Wann kannst du?“.
  const tokenLoaded = page.waitForResponse((r) => r.url().includes("/rpc/poll_share_token") && r.ok());
  await page.reload();
  await tokenLoaded;
  await stubShare(page);
  await page.getByRole("button", { name: "Abstimmung teilen" }).click();
  const dateShareUrl = (await sharedData(page))[0]?.url ?? "";
  await unstubShare(page);
  check(/\/v\/[0-9a-f]{32}$/.test(dateShareUrl), `Termin-Abstimmung teilen: eigener Link (${dateShareUrl})`);
  const short = (date) => `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(`${date}T12:00:00Z`).getUTCDay()]} ${date.slice(8, 10)}.${date.slice(5, 7)}.`;
  if (ANON) {
    const response = await handleShare(new Request(dateShareUrl), { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: ANON }, fetch);
    const head = (await response.text()).split("</head>")[0];
    const expected = `2 Termine zur Wahl: ${short(d1)} 20:00, ${short(d2)} · 1 hat abgestimmt · Abstimmen bis `;
    check(head.includes(`<meta property="og:description" content="${expected}`) && /Wann kannst du\?" \/>/.test(head), `Vorschau im Messenger zeigt die Termine und fragt „Wann kannst du?“ (${expected})`);
    check(!/Alice|Bob|example\.test/.test(head), "Vorschau der Termine: keine Namen");
  }
  const guestsToggle = page.getByRole("switch", { name: /Gäste dürfen mitstimmen/ });
  await guestsToggle.click();
  await toast(alice, "Gäste können jetzt über den geteilten Link mitstimmen.");
  const ida = await newUser("Ida", "mobile");
  try {
    await ida.page.goto(dateShareUrl);
    await ida.page.getByRole("heading", { level: 1, name: "Stimm mit ab" }).waitFor();
    check(await ida.page.getByText("Wann kannst du?", { exact: true }).isVisible(), "Gast-Stimmzettel fragt „Wann kannst du?“");
    const dateList = ida.page.getByTestId("shared-poll-dates");
    const dates = await dateList.innerText();
    check(/20:00 Uhr/.test(dates) && (await dateList.getByRole("listitem").count()) === 2, `Karte zeigt beide Termine („${dates.replace(/\s+/g, " ")}“)`);
    check(await ida.page.getByText(/Uhrzeit offen/).first().isVisible(), "Termin ohne Uhrzeit: „Uhrzeit offen“ statt doppeltem Datum");
    await answer(ida, l2, "Bin dabei").click();
    await answer(ida, l1, "Vielleicht").click();
    await ida.page.getByLabel("Dein Name").fill("Ida");
    await shot(ida, "36b-termin-stimmzettel-gast");
    await ida.page.getByRole("button", { name: "Abstimmen" }).click();
    await ida.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Ida" }).waitFor();
    check(true, "Gast stimmt über Termine ab");
  } finally {
    users.splice(users.indexOf(ida), 1);
    await ida.context.close();
  }

  await page.reload();
  await page.getByRole("button", { name: "Abstimmung beenden" }).click();
  await dialog(alice).getByRole("button", { name: "Abstimmung beenden" }).click();
  await page.getByRole("heading", { name: `Es wird ${l2}` }).waitFor();
  check(true, "der Termin mit den meisten Zusagen gewinnt");

  // P1 Etappe 2/3a: „Und wo?“ – Orts-Abstimmung, verknüpft mit dem Gewinner-Termin, ohne ihn neu einzutippen.
  const where = page.getByTestId("poll-where");
  await where.getByText("Und wo?").waitFor();
  await shot(alice, "36c-termin-und-wo");
  await where.getByRole("link", { name: "Ort abstimmen" }).click();
  await page.waitForURL(new RegExp(`/polls/new\\?crew=[0-9a-f-]{36}&date=${d2}&where=${datePoll}$`));
  const linkedWhen = page.getByTestId("poll-linked-when");
  await linkedWhen.waitFor();
  check((await linkedWhen.innerText()).includes(l2), `„Und wo?“: der Gewinner-Termin steht fest im Formular (${l2})`);
  const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long" }).format(new Date(`${d2}T12:00:00Z`));
  check((await page.getByLabel("Frage an die Crew").inputValue()) === `Was machen wir am ${weekday}?`, `„Und wo?“: Frage passt zum Tag (${weekday})`);
  check((await page.getByRole("tab", { name: "Was machen wir?" }).getAttribute("aria-selected")) === "true", "„Und wo?“ ist eine Abstimmung über Orte");
  await page.getByRole("button", { name: "Eigenen Vorschlag hinzufügen" }).click();
  await page.getByLabel(/^Vorschlag \d+$/).last().fill("Bowling");
  check((await page.getByLabel(/^Datum/).count()) === 0 && (await page.getByText("Eigener Termin für diese Option").count()) === 0,
    "„Und wo?“: kein eigenes Datum – der Termin gilt für alle Vorschläge");
  await page.getByRole("button", { name: "in 2 Stunden" }).click();
  await shot(alice, "36d-und-wo-erstellen");
  await page.getByRole("button", { name: "Abstimmung starten" }).click();
  await page.waitForURL(/\/polls\/[0-9a-f-]{36}$/);
  const wherePoll = idFromUrl(page);
  check(wherePoll !== datePoll, "„Und wo?“ ist eine eigene Abstimmung");
  const fromDate = page.getByTestId("poll-from-date");
  await fromDate.waitFor();
  check((await fromDate.innerText()).includes(l2), "Orts-Abstimmung nennt den Termin aus „Wann könnt ihr?“ und führt zurück");

  // Bob sieht auf der Termin-Abstimmung, dass über den Ort schon abgestimmt wird – kein zweites „Und wo?“.
  await bob.page.goto(`${APP}/polls/${datePoll}`);
  const bobWhere = bob.page.getByTestId("poll-where");
  await bobWhere.getByText(/läuft die Abstimmung über den Ort/).waitFor();
  check((await bobWhere.getByRole("link", { name: "Ort abstimmen" }).count()) === 0, "Termin-Abstimmung: kein zweites „Und wo?“, solange eines läuft");
  await bobWhere.getByRole("link", { name: "Zur Abstimmung über den Ort" }).click();
  await bob.page.waitForURL(new RegExp(`/polls/${wherePoll}$`));
  await answer(bob, "Bowling", "Bin dabei").click();
  await optionCard(bob, "Bowling").getByText("1 Zusage").waitFor();
  check(true, "Bob kommt von der Termin- zur Orts-Abstimmung und stimmt ab");

  await page.reload();
  await page.getByRole("button", { name: "Abstimmung beenden" }).click();
  await dialog(alice).getByRole("button", { name: "Abstimmung beenden" }).click();
  await page.getByRole("heading", { name: "Es wird Bowling" }).waitFor();
  await page.getByRole("button", { name: "Plan erstellen" }).click();
  check((await dialog(alice).getByLabel("Titel").inputValue()) === "Bowling", "Plan aus „Und wo?“: Titel ist der Ort");
  check((await dialog(alice).getByLabel("Datum").inputValue()) === d2, "Plan aus „Und wo?“: Datum aus „Wann könnt ihr?“");
  await dialog(alice).getByRole("button", { name: "Plan erstellen" }).click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}/);
  await page.getByRole("heading", { level: 1, name: "Bowling" }).waitFor();
  check(true, "aus Termin und Ort wird ein Plan");

  await page.goto(`${APP}/polls/${datePoll}`);
  await where.getByText(/Es wird Bowling – am/).waitFor();
  await page.getByRole("link", { name: "Zum Plan" }).waitFor();
  check(true, "Termin-Abstimmung zeigt den Plan aus „Und wo?“");
  check((await page.getByRole("button", { name: "Plan erstellen" }).count()) === 0, "kein zweiter Plan aus der Termin-Abstimmung");
  await shot(alice, "36e-termin-und-wo-entschieden");
});

await step("Sicherheit – Außenstehende sehen und ändern nichts (Mallory)", async () => {
  const { page } = mallory;
  // W1 Etappe 2: Mallory hat den Link, registriert sich darüber, tritt aber nicht bei – sie bleibt außen vor.
  await page.goto(ids.invite);
  await page.waitForURL(/\/invite\//);
  await register(mallory, { here: true });
  await invitedOnboarding(mallory);
  await page.getByRole("button", { name: "Erst mal ohne Crew weiter" }).click();
  await page.waitForURL(/\/home/);
  check(true, "Einladung ausschlagen: Onboarding endet auf Home, ohne Beitritt");
  await page.goto(`${APP}/crews/${ids.crew}`);
  await page.getByText("Diese Crew gibt es nicht").waitFor();
  await page.goto(`${APP}/polls/${ids.poll}`);
  await page.getByText("Diese Abstimmung gibt es nicht").waitFor();
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.getByText("Diesen Plan gibt es nicht").waitFor();
  check(true, "fremde Crew, Abstimmung und Plan sind in der Oberfläche nicht erreichbar");
  await page.goto(`${APP}/admin`);
  await page.getByText("Kein Zugriff").waitFor();
  check(true, "Admin-Bereich ist gesperrt");
  if (ids.shareUrl) {
    // W2: Den Teilen-Link kann sie öffnen – sieht aber nur die Karte, nicht den Plan.
    await page.goto(ids.shareUrl);
    await page.getByRole("heading", { level: 1, name: "Noch nicht in der Crew" }).waitFor();
    check(!page.url().includes(ids.plan), "Teilen-Link: Außenstehende bleiben auf der Karte");
    check(/\d+\s*(waren|war) dabei|Keine Zusage/.test(await page.getByRole("region").innerText()), "vergangener Plan: Zusagen in der Vergangenheit");
    await shot(mallory, "16e-geteilter-plan-aussen");
  }
  if (ids.pollShareUrl) {
    // W2 Etappe 2: dasselbe für die geteilte Abstimmung – inzwischen entschieden.
    await page.goto(ids.pollShareUrl);
    await page.getByRole("heading", { level: 1, name: "Noch nicht in der Crew" }).waitFor();
    check(!page.url().includes(ids.poll), "Abstimmungs-Link: Außenstehende bleiben auf der Karte");
    check(/Entschieden/.test(await page.getByRole("region").innerText()), "beendete Abstimmung: als entschieden markiert");
    await shot(mallory, "16f-geteilte-abstimmung-aussen");
  }

  if (!ANON) {
    console.log("   (SUPABASE_ANON_KEY nicht gesetzt – direkte API-Proben werden übersprungen)");
    return;
  }
  const rows = async (table) => (await api(mallory, "GET", `${table}?select=*`)).json;
  check((await rows("crews")).length === 0, "API: keine fremden Crews lesbar");
  check((await rows("crew_members")).length === 0, "API: keine fremden Mitgliedschaften lesbar");
  check((await rows("polls")).length === 0 && (await rows("poll_votes")).length === 0, "API: keine fremden Abstimmungen/Stimmen lesbar");
  check((await rows("plans")).length === 0 && (await rows("plan_participants")).length === 0, "API: keine fremden Pläne lesbar");
  check((await rows("crew_messages")).length === 0, "API: kein fremder Chat lesbar");
  check((await rows("booking_requests")).length === 0 && (await rows("ride_offers")).length === 0, "API: keine fremden Reservierungen/Fahrten lesbar");
  check((await rows("profiles")).length === 1, "API: nur das eigene Profil lesbar");
  check((await rows("notifications")).every((n) => n.type !== "poll_created"), "API: keine fremden Benachrichtigungen lesbar");
  check((await rows("reward_transactions")).length === 0, "API: keine fremden Punkte lesbar");

  const option = (await api(alice, "GET", `poll_options?select=id&poll_id=eq.${ids.poll}&limit=1`)).json[0].id;
  check((await api(mallory, "POST", "rpc/cast_vote", { p_option_id: option, p_response: "yes" })).status === 403, "API: fremde Abstimmung – Stimme wird abgewiesen (403)");
  check((await api(mallory, "POST", "rpc/create_crew_invitation", { p_crew_id: ids.crew })).status === 403, "API: Einladung für fremde Crew wird abgewiesen (403)");
  check((await api(mallory, "POST", "rpc/set_plan_status", { p_plan_id: ids.plan, p_status: "cancelled" })).status === 403, "API: fremder Plan lässt sich nicht absagen (403)");
  check((await api(mallory, "POST", "rpc/plan_share_token", { p_plan_id: ids.plan })).status === 403, "API: Teilen-Link für fremden Plan wird abgewiesen (403)");
  // P3: Ausgaben und Rückzahlungen fremder Pläne.
  const add = await api(mallory, "POST", "rpc/add_plan_expense", { p_plan_id: ids.plan, p_description: "Fake", p_amount_cents: 100, p_paid_by: null, p_split_with: [] });
  check(add.status === 403, `API: Außenstehende tragen keine Ausgabe in fremde Pläne ein (${add.status})`);
  const read = await api(mallory, "GET", `plan_expenses?plan_id=eq.${ids.plan}&select=id`);
  check(read.status === 200 && Array.isArray(read.json) && read.json.length === 0, "API: Außenstehende lesen keine Ausgaben");
  const balances = await api(mallory, "POST", "rpc/crew_open_balances", { p_crew_id: ids.crew });
  check(balances.status === 403, `API: Außenstehende lesen keine offenen Beträge der Crew (${balances.status})`);
  const settle = await api(mallory, "POST", "rpc/record_plan_settlement", { p_plan_id: ids.plan, p_from: null, p_to: null, p_amount_cents: 100 });
  check(settle.status === 403, `API: Außenstehende tragen keine Rückzahlung ein (${settle.status})`);
  if (ids.shareUrl) {
    const preview = await api(mallory, "POST", "rpc/preview_shared_plan", { p_token: ids.shareUrl.split("/").pop() });
    check(preview.status === 200 && preview.json?.plan_id === null, "API: Plan-Vorschau gibt Außenstehenden keine Plan-ID");
  }
  check((await api(mallory, "POST", "rpc/poll_share_token", { p_poll_id: ids.poll })).status === 403, "API: Teilen-Link für fremde Abstimmung wird abgewiesen (403)");
  if (ids.pollShareUrl) {
    const preview = await api(mallory, "POST", "rpc/preview_shared_poll", { p_token: ids.pollShareUrl.split("/").pop() });
    check(preview.status === 200 && preview.json?.poll_id === null && preview.json?.poll?.status === "closed", "API: Abstimmungs-Vorschau gibt Außenstehenden keine ID");
  }
  check([401, 403].includes((await api(null, "POST", "rpc/poll_share_token", { p_poll_id: ids.poll })).status), "API: ohne Konto kein Abstimmungs-Link");
  // poll_guests nur mit freigegebenen Spalten abfragen – den Hash darf niemand lesen (select=* scheitert deshalb absichtlich).
  const guestRows = (await api(mallory, "GET", "poll_guests?select=id,display_name")).json;
  check(Array.isArray(guestRows) && guestRows.length === 0 && (await rows("poll_guest_votes")).length === 0, "API: keine fremden Gäste oder Gast-Stimmen lesbar");
  check((await api(mallory, "POST", "rpc/set_poll_guests", { p_poll_id: ids.poll, p_allowed: true })).status === 403, "API: Gäste für fremde Abstimmung freischalten wird abgewiesen (403)");
  const anonShare = await api(null, "POST", "rpc/plan_share_token", { p_plan_id: ids.plan });
  check([401, 403].includes(anonShare.status), `API: ohne Konto kein Teilen-Link (${anonShare.status})`);
  check((await api(mallory, "POST", "rpc/set_attendance", { p_plan_id: ids.plan, p_status: "going" })).status === 403, "API: Zusage zu fremdem Plan wird abgewiesen (403)");
  check((await api(mallory, "PATCH", `plans?id=eq.${ids.plan}`, { title: "Gekapert" })).status === 403, "API: direkte Änderung an plans ist verboten (403)");
  check((await api(mallory, "POST", "poll_votes", { poll_id: ids.poll, poll_option_id: option, user_id: "00000000-0000-0000-0000-000000000000", response: "yes" })).status === 403, "API: direkte Stimmabgabe an der RPC vorbei ist verboten (403)");
  check((await api(mallory, "POST", "reward_transactions", { user_id: "00000000-0000-0000-0000-000000000000", points_delta: 99999, reason: "admin_adjustment" })).status === 403, "API: Punkte lassen sich nicht selbst gutschreiben (403)");
  check((await api(mallory, "POST", "app_admins", { user_id: "00000000-0000-0000-0000-000000000000" })).status === 403, "API: niemand kann sich zum Admin machen (403)");
  check((await api(mallory, "PATCH", `profiles?display_name=eq.Alice`, { display_name: "Gehackt" })).json?.length === 0, "API: fremde Profile lassen sich nicht ändern");
  // W1: Ohne Konto ist nur die öffentliche Einladungsvorschau erreichbar – ohne IDs, Adressen oder Nachnamen.
  const inviteToken = ids.invite.split("/").pop();
  const publicPreview = await api(null, "POST", "rpc/preview_public_invitation", { p_token: inviteToken });
  check(publicPreview.status === 200 && publicPreview.json?.status === "valid", "API ohne Konto: öffentliche Einladungsvorschau antwortet");
  check(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(JSON.stringify(publicPreview.json)), "API ohne Konto: Vorschau enthält keine IDs");
  // Hier sind die Pläne der Crew schon abgeschlossen oder abgesagt: next_plan ist leer (Feldauswahl prüft pgTAP).
  const nextPlan = publicPreview.json?.next_plan;
  check(nextPlan === null || Object.keys(nextPlan).sort().join(",") === "starts_at,title", "API ohne Konto: vom nächsten Plan höchstens Titel und Beginn");
  check((await api(null, "POST", "rpc/preview_public_invitation", { p_token: "0".repeat(64) })).json?.status === "not_found", "API ohne Konto: unbekannter Token verrät nichts");
  check((await api(null, "POST", "rpc/preview_crew_invitation", { p_token: inviteToken })).status >= 400, "API ohne Konto: Beitrittsvorschau für Angemeldete bleibt gesperrt");
  check((await api(null, "POST", "rpc/accept_crew_invitation", { p_token: inviteToken })).status >= 400, "API ohne Konto: Beitritt ist gesperrt");
  // Bob (Mitglied, aber nicht Organisator) darf Alices Plan nicht verwalten.
  check((await api(bob, "POST", "rpc/set_plan_status", { p_plan_id: ids.plan, p_status: "cancelled" })).status === 403, "API: Mitglieder können fremde Pläne nicht absagen (403)");
  check((await api(bob, "POST", "rpc/remove_crew_member", { p_crew_id: ids.crew, p_user_id: (await api(carol, "GET", "user_settings?select=user_id")).json[0].user_id })).status === 403, "API: Mitglieder können niemanden entfernen (403)");
  const anon = await api(null, "GET", "profiles?select=*");
  check(anon.status === 401 || anon.status === 403, `API: ohne Anmeldung ist nichts lesbar (${anon.status})`);
  check([401, 403, 404].includes((await api(null, "POST", "rpc/create_crew", { p_name: "Anon Crew" })).status), "API: ohne Anmeldung ist keine RPC aufrufbar");
});

await step("Meldung abgeben und Admin-Bereich", async () => {
  await bob.page.goto(`${APP}/discover`);
  await bob.page.getByRole("link", { name: "Café Morgenrot" }).click();
  await bob.page.getByRole("button", { name: "Falsche Angaben melden" }).click();
  await dialog(bob).getByLabel("Beschreibung").fill("Öffnungszeiten am Montag stimmen nicht.");
  await dialog(bob).getByRole("button", { name: "Meldung senden" }).click();
  await toast(bob, "Danke, die Meldung ist eingegangen.");
  await bob.page.goto(`${APP}/admin`);
  await bob.page.getByText("Kein Zugriff").waitFor();
  check(true, "normale Nutzer kommen nicht in den Admin-Bereich");
  if (!DB_URL) {
    console.log("   (E2E_DB_URL nicht gesetzt – Admin-Bereich wird übersprungen)");
    return;
  }
  // Die Administratorrolle lässt sich nur direkt in der Datenbank vergeben.
  execFileSync("psql", [DB_URL, "-qc", `insert into public.app_admins (user_id) select id from auth.users where email = '${alice.email}'`]);
  const { page } = alice;
  await page.goto(`${APP}/admin`);
  await page.getByText("Offene Meldungen").waitFor();
  await shot(alice, "32-admin");
  await page.getByRole("tab", { name: "Meldungen" }).click();
  await page.getByText("Öffnungszeiten am Montag stimmen nicht.").waitFor();
  await page.getByRole("button", { name: "Erledigt" }).click();
  await toast(alice, "Meldung aktualisiert.");
  check(true, "Admin sieht und bearbeitet Meldungen");
  await page.getByRole("tab", { name: "Aktivitäten" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Café Morgenrot" });
  await row.getByRole("button", { name: "Ausblenden" }).click();
  await row.getByText("Ausgeblendet").waitFor();
  await bob.page.goto(`${APP}/discover`);
  await bob.page.getByRole("heading", { name: "Strike District Bowling" }).waitFor();
  check((await bob.page.getByRole("heading", { name: "Café Morgenrot" }).count()) === 0, "ausgeblendete Orte verschwinden aus Discover");
  await row.getByRole("button", { name: "Einblenden" }).click();
  await row.getByText("Aktiv", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Protokoll" }).click();
  await page.getByText("poll_closed").first().waitFor();
  check(true, "Audit-Log zeigt kritische Aktionen");
});

await step("Echte Orte aus OpenStreetMap – Import pro Stadt (Alice)", async () => {
  const { page } = alice;
  let dialogs = 0;
  page.on("dialog", (d) => { dialogs++; void d.dismiss(); });
  await page.goto(`${APP}/discover`);
  const cityField = page.getByLabel("Stadt", { exact: true });
  await cityField.fill("Leipzig");
  await cityField.press("Enter");
  await page.getByText(/von 2\.601 Orten/).waitFor({ timeout: 60_000 });
  check(true, "neue Stadt wird importiert, Liste ist begrenzt und nennt die Gesamtzahl");
  check(await page.getByText(/2\.601 Orte aus OpenStreetMap, Stand/).isVisible(), "Quelle und Stand werden genannt");
  check(await page.getByRole("link", { name: "© OpenStreetMap-Mitwirkende" }).isVisible(), "OSM-Namensnennung ist verlinkt");
  check((await page.getByText("Beispieldaten").count()) === 0, "keine Demo-Kennzeichnung bei echten Orten");
  check((await page.getByText(/Preis unbekannt/).count()) > 0, "fehlende Preise werden als unbekannt angezeigt");
  await shot(alice, "33-echte-orte");

  await page.getByRole("button", { name: "Escape Rooms", exact: true }).click();
  await page.getByText(/^300 von 325 Orten/).waitFor();
  check(true, "Kategorie filtert serverseitig über alle Orte der Stadt");
  await page.getByRole("button", { name: "Alle", exact: true }).click();
  await page.getByLabel("Ort oder Aktivität suchen").fill("onerror");
  await page.getByRole("heading", { name: "<img src=x onerror=alert(1)>" }).waitFor();
  check(dialogs === 0, "Namen aus OSM werden als Text dargestellt, nicht als HTML");

  await page.getByLabel("Ort oder Aktivität suchen").fill("pub 18");
  await page.getByRole("link", { name: "pub 18", exact: true }).click();
  await page.getByRole("heading", { name: "Auf einen Blick" }).waitFor();
  check(await page.getByText(/OpenStreetMap-Mitwirkende, Stand/).isVisible(), "Detailseite nennt OSM als Quelle");
  check((await page.getByRole("link", { name: "Eintrag bei OpenStreetMap" }).getAttribute("href")) === "https://www.openstreetmap.org/node/100018", "Link zum OSM-Eintrag");
  check(await page.getByText("Samstag").first().isVisible() && (await page.getByText("12:00–23:00").count()) > 0, "übersetzte Öffnungszeiten als Wochentabelle");
  check(await page.getByText(/Feiertage sind nicht berücksichtigt/).isVisible(), "Hinweis auf Grenzen der OSM-Öffnungszeiten");
  await shot(alice, "34-osm-ort");

  await page.goto(`${APP}/discover`);
  // Das Feld wird erst gefüllt, wenn das Profil geladen ist.
  await page.waitForFunction(() => document.querySelector('input[aria-label="Stadt"]')?.value, null, { timeout: 15_000 }).catch(() => {});
  check((await page.getByLabel("Stadt", { exact: true }).inputValue()) === "Leipzig", "Discover merkt sich die zuletzt gewählte Stadt");
  await page.getByLabel("Ort oder Aktivität suchen").fill("cinema 11");
  await page.getByRole("link", { name: "cinema 11", exact: true }).click();
  await page.getByText("Laut OpenStreetMap (Originalangabe):").waitFor();
  check(await page.getByText("Mo-Fr 18:00+").isVisible(), "nicht übersetzbare Öffnungszeiten erscheinen im Original");

  await page.goto(`${APP}/discover`);
  await cityField.fill("frankfurt");
  await cityField.press("Enter");
  await page.waitForFunction(() => document.querySelector('input[aria-label="Stadt"]')?.value === "Frankfurt am Main", null, { timeout: 60_000 });
  check(true, "Schreibweise wird auf den offiziellen Stadtnamen korrigiert");

  await cityField.fill("Atlantis");
  await cityField.press("Enter");
  await page.getByText("Diese Stadt haben wir in Deutschland nicht gefunden. Prüfe die Schreibweise.").waitFor({ timeout: 30_000 });
  check(true, "unbekannte Stadt: verständliche Meldung statt leerer Seite");

  // Abstimmung: Ortsauswahl sucht in der gewählten Stadt.
  await page.goto(`${APP}/polls/new`);
  await page.getByRole("button", { name: "Ort hinzufügen" }).click();
  const picker = dialog(alice);
  await picker.getByLabel("Stadt", { exact: true }).fill("Leipzig");
  await picker.getByLabel("Stadt", { exact: true }).press("Enter");
  await picker.getByLabel("Orte durchsuchen").fill("bowling_alley 4");
  await picker.getByRole("button", { name: /bowling_alley 4\b/ }).first().click();
  await picker.getByRole("button", { name: "1 Ort übernehmen" }).click();
  await page.getByText("bowling_alley 4", { exact: true }).waitFor();
  check(true, "echter Ort lässt sich in eine Abstimmung übernehmen");

  // O1: Der erste Overpass-Server der CI ist absichtlich ausgefallen (osm-stub mit OSM_STUB_DOWN=1);
  // Leipzig kam also über den Ersatzserver. Das Protokoll hält beide Versuche fest.
  if (DB_URL) {
    const run = execFileSync("psql", [DB_URL, "-tAc",
      `select fallback_used::text || '|' || (attempts -> 0 ->> 'result') || '|' || (attempts -> 1 ->> 'result') from public.place_sync_runs where city = 'leipzig' and outcome = 'ready' order by id desc limit 1`,
    ], { encoding: "utf8" }).trim();
    check(run === "true|timeout|ok", `Ersatzserver: Leipzig nach Ausfall des Hauptservers importiert und protokolliert (${run})`);
    // O2: Auch Nominatim ist in der CI ausgefallen (Stellvertreter auf 8090); Photon hat die Stadt gefunden.
    const geo = execFileSync("psql", [DB_URL, "-tAc",
      `select geocode_fallback::text || '|' || (geocode_attempts -> 0 ->> 'result') || '|' || (geocode_attempts -> -1 ->> 'result') from public.place_sync_runs where city = 'leipzig' and outcome = 'ready' order by id desc limit 1`,
    ], { encoding: "utf8" }).trim();
    check(geo === "true|busy|ok", `Stadtsuche mit Ersatz: Leipzig nach Ausfall von Nominatim über Photon gefunden (${geo})`);
    await page.goto(`${APP}/admin`);
    const card = page.getByRole("region", { name: "Orte-Import aus OpenStreetMap" });
    await card.getByText("über Ersatzserver").waitFor();
    check(await card.getByText("Stadt über Ersatz gefunden").isVisible(), "Admin sieht die Ersatz-Stadtsuche");
    check(await card.getByText(/^Gescheitert bei der Stadtsuche: \d+ · bei Overpass: \d+$/).isVisible(), "Admin sieht Fehlschläge getrennt nach Stadtsuche und Overpass");
    check(await card.getByText(/von \d+ Versuchen erfolgreich/).first().isVisible(), "Admin sieht Importe, Fehlerquote und Server");
    await shot(alice, "35-admin-osm-import");
  }
  const api3 = await api(bob, "POST", "rpc/record_place_sync_run", { p_city: "Leipzig", p_region: null, p_outcome: "failed", p_error: "osm_busy", p_attempts: [], p_duration_ms: 0 });
  check([401, 403, 404].includes(api3.status), "API: Nutzer können keine Import-Fehlschläge vortäuschen");
  const api4 = await api(bob, "POST", "rpc/admin_place_sync_health", {});
  check(api4.status === 403 || api4.status === 401, "API: Fehlerquote nur für Admins");

  const api1 = await api(bob, "POST", "rpc/ingest_place_batch", { p_region: "00000000-0000-0000-0000-000000000000", p_started: new Date().toISOString(), p_places: [] });
  check([401, 403, 404].includes(api1.status), "API: Nutzer können selbst keine Orte schreiben");
  const api2 = await api(bob, "POST", "activities", { name: "Fake", category: "bar", city: "Leipzig", data_source: "provider" });
  check([401, 403].includes(api2.status), "API: direkter Eintrag in activities ist gesperrt");
});

await step("Widerruf – ein zurückgezogener Einladungslink funktioniert nicht mehr", async () => {
  const { page } = alice;
  await page.goto(`${APP}/crews/${ids.crew}`);
  await page.getByRole("tab", { name: "Einstellungen" }).click();
  await page.getByText("2 von 20 genutzt").waitFor();
  check(true, "Nutzungen des Links werden gezählt");
  await shot(alice, "25-crew-einstellungen");
  await page.getByRole("button", { name: "Widerrufen" }).click();
  await toast(alice, "Link widerrufen. Er funktioniert ab sofort nicht mehr.");
  await mallory.page.goto(ids.invite);
  await mallory.page.getByText("Einladung widerrufen").waitFor();
  check(true, "widerrufener Link wird abgelehnt");
  await shot(mallory, "26-einladung-widerrufen");
  await mallory.page.goto(`${APP}/join/${"0".repeat(64)}`);
  await mallory.page.getByText("Einladung nicht gefunden").waitFor();
  check(true, "unbekannter Token wird abgelehnt");
});

await step("Einstellungen – Standort (Opt-in), Benachrichtigungen, Datenexport", async () => {
  const { page } = bob;
  await page.goto(`${APP}/settings`);
  await page.getByRole("heading", { name: "Standortfreigabe" }).waitFor();
  check(await page.getByRole("radio", { name: /Standort nicht teilen/ }).isChecked(), "Standortfreigabe ist standardmäßig aus");
  check(await page.getByText("Noch nicht aktiv").isVisible(), "die App behauptet keine Live-Standorte");
  await shot(bob, "27-einstellungen");
  await page.getByRole("switch", { name: "Neue Abstimmungen" }).click();
  await toast(bob, "Benachrichtigungen gespeichert.");
  await page.reload();
  check(!(await page.getByRole("switch", { name: "Neue Abstimmungen" }).isChecked()), "Benachrichtigungseinstellung bleibt gespeichert");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Daten herunterladen" }).click()]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  check(exported.account?.email === bob.email && exported.votes?.length >= 1 && exported.crews?.length === 1, "Datenexport enthält Konto, Stimmen und Crews");
  check(!JSON.stringify(exported).includes(alice.email), "Datenexport enthält keine fremden E-Mail-Adressen");
  await page.getByLabel("Anzeigename").fill("B");
  await page.getByRole("button", { name: "Änderungen speichern" }).first().click();
  check(await page.getByText("Mindestens 2 Zeichen.").isVisible(), "Profilformular validiert den Namen");
});

await step("P2 Etappe 2 – Kalender-Abo: Link anlegen, Kalender abrufen, ersetzen, beenden (Bob)", async () => {
  const { page } = bob;
  await page.goto(`${APP}/settings#calendar`);
  const card = page.locator("section#calendar");
  await card.getByRole("heading", { name: "Kalender-Abo" }).waitFor();
  await card.getByText("Noch kein Abo.", { exact: false }).waitFor();
  check(true, "ohne Abo: Hinweis statt Link");
  await card.getByRole("button", { name: "Abo-Link erstellen" }).click();
  await toast(bob, "Abo-Link erstellt.");
  const field = card.getByLabel("Dein Abo-Link");
  const link = await field.inputValue();
  check(/\/c\/[0-9a-f]{64}\.ics$/.test(link), `Abo-Link: /c/<64 Hex>.ics (${link.replace(/[0-9a-f]{56}\.ics$/, "….ics")})`);
  check((await card.getByRole("link", { name: "In Apple Kalender öffnen" }).getAttribute("href")) === link.replace(/^https?:\/\//, "webcal://"), "Apple: derselbe Link als webcal://");
  const google = await card.getByRole("link", { name: /Google Kalender/ }).getAttribute("href");
  check(google?.startsWith("https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2F") ?? false, "Google: Abo-Link als cid");
  check(await card.getByText("Noch von keinem Kalender abgerufen.").isVisible(), "noch nie abgerufen");
  await shot(bob, "27b-kalender-abo");
  await page.reload();
  check((await page.locator("section#calendar").getByLabel("Dein Abo-Link").inputValue()) === link, "nach dem Neuladen: derselbe Link");

  // Kalender-Apps rufen den Link ohne Anmeldung ab: die Vercel-Funktion gegen die echte lokale Datenbank.
  const env = { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: ANON };
  if (ANON) {
    const response = await handleCalendar(new Request(link), env, fetch);
    const ics = await response.text();
    check(response.status === 200 && response.headers.get("content-type") === "text/calendar; charset=utf-8", `Kalender: 200 text/calendar (${response.status})`);
    check(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"), "Kalender: gültiges iCalendar mit CRLF");
    check(ics.includes(`UID:plan-${ids.plan}@afterhours`) && ics.includes("SUMMARY:Strike District Bowling"), "Kalender: Bobs Plan mit derselben UID wie die Einzeldatei");
    check(ics.replace(/\r\n /g, "").includes("Crew: Weekend Crew"), "Kalender: Crew-Name in der Beschreibung");
    check(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75), "Kalender: Zeilen höchstens 75 Byte");
    check(!/ATTENDEE|ORGANIZER|@example|@(?!afterhours)[a-z0-9-]+\./i.test(ics), "Kalender: keine Teilnehmer oder E-Mail-Adressen");
    await page.reload();
    await page.locator("section#calendar").getByText(/Zuletzt abgerufen/).waitFor();
    check(true, "nach dem Abruf: „Zuletzt abgerufen …“");

    // API-Proben: ohne Konto kein Link; geratene Links liefern nichts.
    check([401, 403].includes((await api(null, "POST", "rpc/my_calendar_feed", {})).status), "API: ohne Konto kein Abo-Link (401/403)");
    check([401, 403].includes((await api(null, "POST", "rpc/renew_calendar_feed", {})).status), "API: ohne Konto kein neuer Abo-Link (401/403)");
    check((await api(null, "POST", "rpc/calendar_feed_events", { p_token: "0".repeat(64) })).json?.status === "not_found", "API: geratener Link liefert nur not_found");
    check((await handleCalendar(new Request(`${APP}/c/${"0".repeat(64)}.ics`), env, fetch)).status === 404, "Kalender: geratener Link → 404");
  }

  // Neuer Link ersetzt den alten.
  await page.locator("section#calendar").getByRole("button", { name: "Neuen Link erstellen" }).click();
  await dialog(bob).getByRole("button", { name: "Neuen Link erstellen" }).click();
  await toast(bob, "Neuer Abo-Link erstellt.");
  const renewed = await page.locator("section#calendar").getByLabel("Dein Abo-Link").inputValue();
  check(renewed !== link && /\/c\/[0-9a-f]{64}\.ics$/.test(renewed), "neuer Link ist ein anderer");
  if (ANON) {
    check((await handleCalendar(new Request(link), env, fetch)).status === 404, "alter Link → 404");
    check((await handleCalendar(new Request(renewed), env, fetch)).status === 200, "neuer Link → 200");
  }

  // Abo beenden.
  await page.locator("section#calendar").getByRole("button", { name: "Abo beenden" }).click();
  await dialog(bob).getByRole("button", { name: "Abo beenden" }).click();
  await toast(bob, "Kalender-Abo beendet.");
  await page.locator("section#calendar").getByRole("button", { name: "Abo-Link erstellen" }).waitFor();
  check(true, "nach dem Beenden: wieder „Abo-Link erstellen“");
  if (ANON) check((await handleCalendar(new Request(renewed), env, fetch)).status === 404, "beendetes Abo → 404");
});

await step("Konto löschen (Mallory) – serverseitig, Anmeldung danach unmöglich", async () => {
  const { page } = mallory;
  await page.goto(`${APP}/settings`);
  await page.getByRole("button", { name: "Konto löschen" }).click();
  check(await dialog(mallory).getByRole("button", { name: "Konto endgültig löschen" }).isDisabled(), "Löschen verlangt die Bestätigungsphrase");
  await dialog(mallory).getByLabel("Tippe LÖSCHEN, um zu bestätigen").fill("LÖSCHEN");
  await dialog(mallory).getByRole("button", { name: "Konto endgültig löschen" }).click();
  await page.waitForURL(/\/login/);
  await login(mallory);
  await page.getByText("E-Mail-Adresse oder Passwort stimmen nicht.").waitFor();
  check(true, "gelöschtes Konto kann sich nicht mehr anmelden");
});

await step("Abmelden, Passwort zurücksetzen, neu anmelden (Alice)", async () => {
  const { page } = alice;
  await page.goto(`${APP}/profile`);
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(/\/login/);
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.waitForURL(/\/login/);
  check(true, "nach dem Abmelden sind geschützte Seiten gesperrt");
  const before = await mailCount(alice.email);
  await page.getByRole("link", { name: "Passwort vergessen?" }).click();
  // Login- und Vergessen-Seite haben dasselbe Feld – erst nach dem Seitenwechsel ausfüllen.
  await page.waitForURL(/\/forgot-password/);
  await page.getByRole("heading", { name: "Passwort zurücksetzen" }).waitFor();
  await page.getByLabel("E-Mail-Adresse").fill(alice.email);
  await page.getByRole("button", { name: "Link senden" }).click();
  await page.getByText(/ist der Link jetzt unterwegs/).waitFor();
  const link = await mailLink(alice.email, /type=recovery|\/auth\/reset/, before);
  if (!link) {
    console.log("   (kein Postfach erreichbar – Passwort-Reset per E-Mail wird übersprungen)");
    await login(alice);
    await page.waitForURL(new RegExp(`/plans/${ids.plan}`));
    return;
  }
  await page.goto(link);
  await page.getByRole("heading", { name: "Neues Passwort festlegen" }).waitFor();
  await page.getByLabel("Neues Passwort").fill("Noch-geheimer-2031!");
  await page.getByLabel("Passwort wiederholen").fill("anders");
  await page.getByRole("button", { name: "Passwort speichern" }).click();
  check(await page.getByText("Die Passwörter stimmen nicht überein.").isVisible(), "Passwort-Formular prüft die Wiederholung");
  await page.getByLabel("Passwort wiederholen").fill("Noch-geheimer-2031!");
  await page.getByRole("button", { name: "Passwort speichern" }).click();
  await page.waitForURL(/\/home/);
  await page.goto(`${APP}/profile`);
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(/\/login/);
  await login(alice, PASSWORD);
  await page.getByText("E-Mail-Adresse oder Passwort stimmen nicht.").waitFor();
  check(true, "das alte Passwort gilt nicht mehr");
  await login(alice, "Noch-geheimer-2031!");
  await page.waitForURL(/\/home/);
  check(true, "Anmeldung mit dem neuen Passwort");
});

await step("W5 – Erster Plan in 60 Sekunden: Crew, Einladung, Abstimmung (Dana)", async () => {
  const dana = await newUser("Dana", "mobile");
  const { page, context } = dana;
  // W6: Dana kommt über die öffentliche Startseite.
  await page.goto(`${APP}/`);
  await page.getByRole("link", { name: "Crew gründen" }).first().click();
  await page.waitForURL(/\/register$/);
  await register(dana, { here: true });
  const started = Date.now();
  await onboard(dana, { full: true });
  await page.waitForURL(/\/start$/);
  await page.getByRole("heading", { level: 1, name: "Wie heißt eure Crew?" }).waitFor();
  check(true, "ohne Einladungslink geht es nach dem Onboarding in den geführten Start");
  await shot(dana, "37-start-crew");

  await page.getByLabel("Name der Crew").fill("Freitagsrunde");
  await page.getByRole("radio", { name: "🎳" }).click();
  await page.getByRole("button", { name: "Crew gründen" }).click();
  await page.getByRole("heading", { level: 1, name: "Hol deine Leute dazu" }).waitFor();
  check(/\/start\?crew=[0-9a-f-]{36}$/.test(page.url()), "Schritt 1: Crew gegründet, der Stand steht in der Adresse");
  const crewId = new URL(page.url()).searchParams.get("crew");
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Hol deine Leute dazu" }).waitFor();
  check(true, "Neuladen bleibt in Schritt 2");

  await stubShare(page);
  await page.getByRole("button", { name: "Einladungslink teilen" }).click();
  await page.getByLabel("Dein Einladungslink").waitFor();
  const shared = (await sharedData(page))[0];
  check(/\/join\/[A-Za-z0-9_-]{20,}$/.test(shared?.url ?? ""), "Schritt 2: Einladungslink geht ins Teilen-Menü des Handys");
  check(Boolean(shared?.text?.includes("Freitagsrunde")) && !/@/.test(shared?.text ?? ""), "Teilen-Text nennt die Crew, keine E-Mail-Adressen");
  check((await page.getByLabel("Dein Einladungslink").inputValue()) === shared?.url, "angezeigter Link ist der geteilte");
  await shot(dana, "38-start-einladen");

  await page.getByRole("button", { name: "Weiter zur Abstimmung" }).click();
  await page.getByRole("heading", { level: 1, name: /^Was macht ihr am (Freitag|Samstag)\?$/ }).waitFor();
  const ideas = page.getByRole("region", { name: "Vorschläge", exact: true });
  const cards = ideas.locator("button[aria-pressed]");
  await cards.first().waitFor({ timeout: 45_000 });
  const count = await cards.count();
  check(count >= 1 && count <= 3, `Schritt 3: bis zu drei echte Orte aus der eigenen Stadt (${count})`);
  await shot(dana, "39-start-abstimmung");
  if (count > 1) {
    await cards.last().click();
    check((await cards.last().getAttribute("aria-pressed")) === "false", "Vorschlag lässt sich mit einem Tipp abwählen");
  }
  const names = [];
  for (const card of await ideas.locator('button[aria-pressed="true"]').all()) names.push((await card.locator("span.truncate").first().innerText()).trim());
  const ideaNames = [];
  for (const card of await cards.all()) ideaNames.push((await card.locator("span.truncate").first().innerText()).trim());

  // Etappe 2: eigener Vorschlag und Ortssuche im selben Schritt.
  const own = page.getByRole("region", { name: "Eigene Vorschläge" });
  const ownField = own.getByLabel("Eigener Vorschlag");
  await ownField.fill("x");
  await own.getByRole("button", { name: "Hinzufügen" }).click();
  await own.getByText("Mindestens 2 Zeichen.").waitFor();
  check(true, "zu kurzer eigener Vorschlag wird abgelehnt");
  await ownField.fill("Grillen bei Bob");
  await ownField.press("Enter");
  await own.getByText("Grillen bei Bob", { exact: true }).waitFor();
  check((await ownField.inputValue()) === "", "eigener Vorschlag steht in der Liste, das Feld ist wieder leer");
  await ownField.fill("grillen bei BOB");
  await own.getByRole("button", { name: "Hinzufügen" }).click();
  await own.getByText("Den Vorschlag gibt es schon.").waitFor();
  check((await own.getByText("Grillen bei Bob", { exact: true }).count()) === 1, "doppelter eigener Vorschlag wird abgelehnt");
  await ownField.fill("");
  await own.getByRole("button", { name: "Ort suchen" }).click();
  const picker = dialog(dana);
  await picker.locator("button[aria-pressed]").first().waitFor({ timeout: 45_000 });
  let picked = null;
  for (const option of await picker.locator('button[aria-pressed="false"]').all()) {
    const name = (await option.locator("span.truncate").first().innerText()).trim();
    if (!ideaNames.includes(name)) {
      await option.click();
      picked = name;
      break;
    }
  }
  check(Boolean(picked), "Ortssuche zeigt weitere Orte der Stadt");
  await picker.getByRole("button", { name: "1 Ort übernehmen" }).click();
  await picker.waitFor({ state: "detached" });
  await own.getByText(picked, { exact: true }).waitFor();
  check(true, `Ort aus der Suche kommt zu den Vorschlägen (${picked})`);
  await own.getByRole("button", { name: "Grillen bei Bob entfernen" }).waitFor();
  await shot(dana, "39b-start-eigene");
  names.push("Grillen bei Bob", picked);

  await page.getByRole("button", { name: `Abstimmung mit ${names.length} Vorschlägen starten` }).click();
  await page.waitForURL(/\/polls\/[0-9a-f-]{36}/);
  await page.getByRole("heading", { level: 1, name: /^Was machen wir am (Freitag|Samstag)\?$/ }).waitFor();
  for (const name of names) await page.getByText(name, { exact: true }).first().waitFor();
  check(names.length === Math.max(count - 1, 1) + 2, `Abstimmung enthält genau die gewählten Orte und eigenen Vorschläge (${names.join(", ")})`);
  check(true, `erste Abstimmung steht ${Math.round((Date.now() - started) / 1000)} s nach der E-Mail-Bestätigung (inkl. Onboarding)`);
  await shot(dana, "40-start-fertig");

  // Ohne Stadt im Profil nimmt Schritt 3 die zuletzt in Discover gewählte Stadt (nur im Browser gespeichert).
  if (DB_URL) {
    execFileSync("psql", [DB_URL, "-qc", `update public.profiles set city = null where id = (select id from auth.users where email = '${dana.email}')`]);
    await page.evaluate(() => localStorage.setItem("afterhours.discover.city", "Leipzig"));
    await page.goto(`${APP}/start?crew=${crewId}&step=poll`);
    await page.getByText("Stadt aus Discover: Leipzig.", { exact: false }).waitFor({ timeout: 60_000 });
    check(await page.getByRole("region", { name: "Vorschläge", exact: true }).getByText(/in Leipzig/).first().isVisible(), "ohne Profilstadt: Vorschläge aus der Discover-Stadt, ehrlich benannt");
    check((await page.getByLabel("Stadt", { exact: true }).count()) === 0, "keine Stadtabfrage, wenn Discover die Stadt schon kennt");
  } else {
    console.log("   (E2E_DB_URL nicht gesetzt – Stadt aus Discover wird übersprungen)");
  }
  users.splice(users.indexOf(dana), 1);
  await context.close();
});

await step("W4 – Installierbar, offline lesbar, neue Version, Zähler am App-Icon (Bob)", async () => {
  const app = await newUser("Bob", "mobile", { serviceWorkers: "allow" });
  const { page, context } = app;
  // Badging-API und Installations-Angebot gibt es im Headless-Chromium nicht – beides wird nachgestellt.
  await page.addInitScript(() => {
    window.__badge = null;
    navigator.setAppBadge = async (n) => void (window.__badge = n);
    navigator.clearAppBadge = async () => void (window.__badge = 0);
  });
  const offerInstall = () =>
    page.evaluate(() => {
      const event = new Event("beforeinstallprompt");
      event.prompt = async () => void (window.__prompted = (window.__prompted ?? 0) + 1);
      event.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(event);
    });
  const card = page.getByRole("region", { name: "Hol dir AFTERHOURS auf den Homescreen" });
  const homeReady = async () => {
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.getByRole("heading", { name: "Ideen für euch" }).waitFor();
  };

  await login(app);
  await page.waitForURL(/\/home/);
  await homeReady();
  const bell = await page.getByRole("link", { name: /^Benachrichtigungen/ }).first().getAttribute("aria-label");
  const unread = Number(/(\d+) ungelesen/.exec(bell ?? "")?.[1] ?? 0);
  await page.waitForFunction((n) => window.__badge === n, unread);
  check(true, `Zähler am App-Icon zeigt die ungelesenen Benachrichtigungen (${unread})`);

  check((await card.count()) === 0, "ohne Angebot des Browsers kein Installations-Hinweis");
  await offerInstall();
  await card.waitFor();
  check(true, "Installations-Hinweis erscheint auf Home, sobald der Browser die Installation anbietet");
  await shot(app, "33-installieren");
  await card.getByRole("button", { name: "Nicht jetzt" }).click();
  await card.waitFor({ state: "detached" });
  await page.reload();
  await homeReady();
  await offerInstall();
  await page.waitForTimeout(400);
  check((await card.count()) === 0, "„Nicht jetzt“ hält den Hinweis fern (30 Tage)");
  await page.evaluate(() => localStorage.removeItem("afterhours.install-dismissed"));
  await page.reload();
  await homeReady();
  await offerInstall();
  await card.getByRole("button", { name: "Installieren" }).click();
  await toast(app, "AFTERHOURS ist installiert.");
  check((await page.evaluate(() => window.__prompted)) === 1, "„Installieren“ öffnet den Dialog des Browsers");
  await card.waitFor({ state: "detached" });

  const dev = await page.evaluate(() => Boolean(document.querySelector('script[src="/@vite/client"]')));
  if (dev) {
    console.log("   (Entwicklungsserver – der Service Worker läuft nur im Produktionsbuild; Offline-Probe übersprungen)");
    return;
  }
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  check(scope === `${APP}/`, "Service Worker ist für die ganze App registriert");
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await homeReady();
  // Startdateien und besuchte Seiten liegen im Cache; Supabase-Antworten nie.
  const cached = await page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls;
  });
  check(cached.some((url) => url.endsWith("/index.html")) && cached.some((url) => /\/assets\/.+\.js$/.test(url)), `App-Hülle und Skripte liegen im Cache (${cached.length} Dateien)`);
  check(!cached.some((url) => /\/(rest|auth)\/v1\//.test(url)), "keine API-Antworten (Nutzerdaten) im Cache");

  // W4 Etappe 2: Was Bob gesehen hat, bleibt auf dem Gerät – nur Pläne, Crews, Namen, Orte, Abstimmungen.
  const storedKeys = () => page.evaluate(() => JSON.parse(localStorage.getItem("afterhours.offline") ?? "null")?.entries.map((e) => e.key) ?? []);
  if (ids.plan) {
    await page.goto(`${APP}/plans/${ids.plan}`);
    await page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
    await page.waitForFunction((id) => (JSON.parse(localStorage.getItem("afterhours.offline") ?? "null")?.entries ?? []).some((e) => e.key[0] === "plans" && e.key[1] === id), ids.plan);
  }
  // Die Planliste wird unabhängig vom einzelnen Plan gespeichert – kurz darauf warten statt sofort prüfen.
  await page
    .waitForFunction(() => (JSON.parse(localStorage.getItem("afterhours.offline") ?? "null")?.entries ?? []).some((e) => e.key.length === 1 && e.key[0] === "plans"), null, { timeout: 15_000 })
    .catch(() => undefined);
  const keys = await storedKeys();
  check(keys.some((key) => key.length === 1 && key[0] === "plans"), "Planliste liegt für offline auf dem Gerät");
  check(keys.every((key) => ["plans", "crews", "profile", "polls", "activities", "people"].includes(key[0]) && !["invitations", "messages", "bookings", "rides", "search"].includes(key[2] ?? key[1])), `auf dem Gerät nur Pläne, Crews, Namen, Orte, Abstimmungen – keine Einladungslinks, Chats oder Einstellungen (${keys.map((k) => k[0]).join(", ")})`);

  await context.setOffline(true);
  await page.goto(`${APP}/home`);
  await page.getByText(/^Offline – gespeicherter Stand von .+ Uhr\.$/).waitFor();
  await page.getByRole("heading", { level: 1 }).waitFor();
  check(true, "ohne Netz öffnet sich die App aus dem Cache und nennt die Uhrzeit des gespeicherten Stands");
  await shot(app, "34-offline");
  if (ids.plan) {
    await page.goto(`${APP}/plans/${ids.plan}`);
    await page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
    check(await page.getByText(/^Offline – gespeicherter Stand/).isVisible(), "Plan ist offline lesbar (Titel, Zeit, Ort aus dem Gerätespeicher)");
    await shot(app, "35-plan-offline");
  }
  await context.setOffline(false);
  await page.getByText(/^Offline –/).waitFor({ state: "detached" });
  await page.goto(`${APP}/home`);
  await homeReady();
  check(true, "wieder online: Hinweis verschwindet, Home lädt");

  // Neue Version: Die laufende Seite vergleicht ihr Start-Skript mit dem der aktuellen index.html.
  const versionCheck = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const updateBar = page.getByText("Neue Version ist da.");
  await versionCheck();
  await page.waitForTimeout(800);
  check((await updateBar.count()) === 0, "ohne neuen Build kein Update-Hinweis");
  await page.reload();
  await homeReady();
  // Die Seite tut so, als stamme sie aus einem älteren Build (ein Modul-Skript läuft nach dem Laden nicht erneut).
  await page.evaluate(() => document.querySelector('script[type="module"][src*="/assets/"]')?.setAttribute("src", "/assets/index-alter-build.js"));
  await versionCheck();
  await updateBar.waitFor();
  check(true, "neuer Build auf dem Server: Hinweis „Neue Version“ erscheint");
  await shot(app, "36-neue-version");
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Neu laden" }).click()]);
  await homeReady();
  check((await updateBar.count()) === 0, "„Neu laden“ startet die neue Version, der Hinweis ist weg");

  // Abmelden räumt den gespeicherten Stand vom Gerät.
  await page.goto(`${APP}/profile`);
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(/\/login/);
  check((await page.evaluate(() => localStorage.getItem("afterhours.offline"))) === null, "Abmelden löscht den gespeicherten Stand vom Gerät");
  users.splice(users.indexOf(app), 1);
  await context.close();
});

await step("Viele Pläne – anstehende bleiben sichtbar, wenn die Crew über 200 Abende hat (Carol)", async () => {
  if (!DB_URL) {
    console.log("   (E2E_DB_URL nicht gesetzt – übersprungen)");
    return;
  }
  const { page } = carol;
  const psql = (sql) => execFileSync("psql", [DB_URL, "-qc", sql]);
  // 210 vergangene Abende plus ein anstehender – vorher lud die Liste die ältesten 200 und verlor den neuen.
  psql(`insert into public.plans (crew_id, created_by, title, starts_at, status)
        select '${ids.crew}', created_by, 'Archivabend ' || g, now() - make_interval(days => 30 + g), 'completed'
        from public.plans p, generate_series(1, 210) g where p.id = '${ids.plan}';
        insert into public.plans (crew_id, created_by, title, starts_at, status)
        select '${ids.crew}', created_by, 'Zukunftsabend ${RUN}', now() + interval '12 days', 'confirmed' from public.plans where id = '${ids.plan}';`);
  try {
    await page.goto(`${APP}/plans`);
    await page.getByText(`Zukunftsabend ${RUN}`).first().waitFor({ timeout: 15_000 });
    check(true, "mit über 200 Plänen steht der anstehende Plan weiter in der Übersicht");
    await page.goto(`${APP}/crews/${ids.crew}`);
    await page.getByText(`Zukunftsabend ${RUN}`).first().waitFor({ timeout: 15_000 });
    check(true, "… und auf der Crew-Seite");
  } finally {
    psql(`delete from public.plans where crew_id = '${ids.crew}' and (title like 'Archivabend %' or title = 'Zukunftsabend ${RUN}')`);
  }
});

await step("P1 Etappe 3b – Termin-Vorschläge aus den Abenden der Crew (Bob)", async () => {
  if (!DB_URL) {
    console.log("   (E2E_DB_URL nicht gesetzt – übersprungen)");
    return;
  }
  const { page } = bob;
  const psql = (sql) => execFileSync("psql", [DB_URL, "-qc", sql]);
  // Vier abgeschlossene Abende an den letzten vier Donnerstagen um 19:30 Berliner Zeit.
  psql(`insert into public.plans (crew_id, created_by, title, starts_at, status)
        select '${ids.crew}', created_by, 'Donnerstagsabend ' || g,
               ((date_trunc('week', now() at time zone 'Europe/Berlin') - make_interval(weeks => g)) + interval '3 days 19 hours 30 minutes') at time zone 'Europe/Berlin',
               'completed'
        from public.plans p, generate_series(1, 4) g where p.id = '${ids.plan}';`);
  try {
    await page.goto(`${APP}/polls/new?crew=${ids.crew}&kind=date`);
    const card = page.getByTestId("date-suggestions");
    await card.waitFor({ timeout: 15_000 });
    const text = await card.innerText();
    check(/eurer letzten \d+ Abende waren donnerstags, meist um 19:30 Uhr\./.test(text), `Vorschlag nennt Lieblingstag und übliche Uhrzeit (${text.split("\n")[1]})`);
    check(text.includes("Die nächsten Termine sind schon eingetragen."), "Vorschläge sind schon eingetragen");
    const chips = card.getByRole("button");
    const count = await chips.count();
    const labels = await chips.allInnerTexts();
    check(count >= 2 && count <= 3, `zwei bis drei Vorschläge (${labels.join(", ")})`);
    check(labels.filter((l) => /^Do \d{2}\.\d{2}\. · 19:30$/.test(l.trim())).length >= 2, "mindestens zwei Donnerstage um 19:30");
    check((await card.locator('[aria-pressed="true"]').count()) === count, "alle Vorschläge sind ausgewählt");
    const dates = page.getByLabel(/^Termin \d+$/);
    check((await dates.count()) === count, "statt des Wochenendes stehen die Vorschläge in den Terminen");
    const thursdays = labels.filter((l) => l.startsWith("Do ")).map((l) => l.slice(3, 9));
    const filled = await Promise.all(Array.from({ length: count }, (_, i) => dates.nth(i).inputValue()));
    check(thursdays.every((d) => filled.some((v) => `${v.slice(8, 10)}.${v.slice(5, 7)}.` === d)), "eingetragene Termine passen zu den Vorschlägen");
    check((await page.getByLabel("Uhrzeit").first().inputValue()) === labels[0].trim().slice(-5), "übliche Uhrzeit ist eingetragen");
    await noOverflow(bob, "Termin-Vorschläge");
    await shot(bob, "36f-termin-vorschlaege");

    // Abwählen nimmt den Termin heraus, Anwählen bringt ihn zurück – mindestens zwei bleiben.
    const last = chips.nth(count - 1);
    await last.click();
    check((await last.getAttribute("aria-pressed")) === "false", "Vorschlag abwählen");
    check((await dates.count()) === count - 1, "abgewählter Vorschlag verschwindet aus den Terminen");
    check((await card.innerText()).includes("Tipp an, was rein oder raus soll.") && !(await card.innerText()).includes("schon eingetragen"), "nach dem Abwählen kein „schon eingetragen“ mehr");
    await last.click();
    check((await dates.count()) === count && (await last.getAttribute("aria-pressed")) === "true", "Vorschlag wieder anwählen");
    // Eigene Änderung bleibt stehen.
    await dates.first().fill(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + 40 * 86_400_000)));
    check((await card.locator('[aria-pressed="true"]').count()) === count - 1, "von Hand geänderter Termin zählt nicht mehr als Vorschlag");

    // Ohne Gewohnheit kein Vorschlag: andere Crew ohne Abende bzw. nach dem Aufräumen.
    psql(`delete from public.plans where crew_id = '${ids.crew}' and title like 'Donnerstagsabend %'`);
    await page.goto(`${APP}/polls/new?crew=${ids.crew}&kind=date`);
    await page.getByLabel(/^Termin \d+$/).first().waitFor();
    await page.waitForTimeout(2000);
    const stillHabit = await page.getByTestId("date-suggestions").count();
    if (stillHabit === 0) check((await page.getByLabel(/^Termin \d+$/).count()) === 3, "ohne Gewohnheit bleibt es beim nächsten Wochenende");
    else console.log("   (Crew hat auch ohne die Testabende eine Gewohnheit – Rückfall nicht geprüft)");
  } finally {
    psql(`delete from public.plans where crew_id = '${ids.crew}' and title like 'Donnerstagsabend %'`);
  }
});

await step("V2 + S1 – Ein Satz, eine Abstimmung: „Was geht?“ auf Home (Bob)", async () => {
  const page = bob.page;
  await page.goto(`${APP}/home`);
  const launcher = page.getByRole("button", { name: "Was geht?" });
  await launcher.waitFor();
  await shot(bob, "41-home-was-geht");
  await launcher.click();
  const sheet = page.getByRole("dialog", { name: "Ein Satz reicht." });
  // Die Dialog-Hülle selbst hat keine Größe (Inhalt liegt fixiert darüber) – auf das Eingabefeld warten.
  await sheet.getByLabel("Was, wann, wo – wie im Chat").waitFor();
  check((await sheet.getByRole("button", { name: /Los – in die Gruppe/ }).isDisabled()), "ohne Satz lässt sich nichts starten");
  await sheet.getByLabel("Was, wann, wo – wie im Chat").fill("bowling oder kino, fr oder sa, 20 uhr");
  const chips = sheet.getByRole("list", { name: "Daraus wird" });
  for (const chip of ["Bowling", "Kino", "20:00"]) await chips.getByText(chip, { exact: true }).waitFor();
  check((await chips.getByRole("listitem").count()) === 5, "Vorschau: 2 Aktivitäten, 2 Tage, 1 Uhrzeit");
  await sheet.getByText("4 Vorschläge", { exact: false }).waitFor();
  await sheet.getByText("Was geht am Wochenende?").waitFor();
  await shot(bob, "42-ein-satz");
  await sheet.getByRole("button", { name: /Los – in die Gruppe/ }).click();
  await page.waitForURL(/\/polls\/[0-9a-f-]{36}/, { timeout: 20000 });
  const pollId = idFromUrl(page);
  await page.getByRole("heading", { level: 1 }).filter({ hasText: /wochenende/i }).waitFor();
  const rows = (await api(bob, "GET", `polls?id=eq.${pollId}&select=title,guests_allowed,poll_options!poll_options_poll_id_fkey(title,proposed_date,proposed_time)`)).json ?? [];
  check(rows[0]?.poll_options?.length === 4 && rows[0].poll_options.every((o) => o.proposed_time?.startsWith("20:00")), "S1: vier Vorschläge mit Tag und 20:00 angelegt");
  check(rows[0]?.guests_allowed === true, "S2: Gäste dürfen über den Link mitstimmen");
  await shot(bob, "43-ein-satz-abstimmung");
  // S6: Wischen statt Liste – Knöpfe sind die barrierefreie Variante des Wischens.
  const deck = page.getByTestId("swipe-deck");
  await deck.getByText("noch 4 Vorschläge").waitFor();
  await deck.getByRole("button", { name: /^Bin dabei: Bowling/ }).click();
  await deck.getByText("noch 3 Vorschläge").waitFor();
  await deck.getByRole("button", { name: /^Eher nicht: / }).click();
  await deck.getByRole("button", { name: /^Vielleicht: / }).click();
  await deck.getByText("noch 1 Vorschlag").waitFor();
  await shot(bob, "44-wischen");
  await deck.getByRole("button", { name: /^Bin dabei: / }).click();
  await deck.getByText(/Alles gewischt/).waitFor();
  const votes = (await api(bob, "GET", `poll_votes?select=response&poll_id=eq.${pollId}`)).json ?? [];
  check(votes.length === 4 && votes.filter((v) => v.response === "yes").length === 2, `S6: vier Antworten gespeichert, zwei davon „dabei“ (${votes.length})`);
  ids.quickPoll = pollId;
});

await step("S5 – Abstimmung entscheidet sich selbst: klare Mehrheit → Plan steht (Bob, Alice, Carol)", async () => {
  const page = bob.page;
  const pollId = ids.quickPoll;
  const row = (await api(bob, "GET", `polls?id=eq.${pollId}&select=auto_decide,status`)).json?.[0];
  check(row?.auto_decide === true && row?.status === "open", "S5: Ein-Satz-Abstimmung entscheidet sich selbst, Bobs Stimmen allein entscheiden nichts");
  await page.getByText("Entscheidet sich selbst", { exact: true }).first().waitFor();
  check(await page.getByRole("switch", { name: /^Entscheidet sich selbst/ }).isChecked(), "Schalter für die Ersteller:in sichtbar und an");
  // S5 Etappe 2: Alice ist beim Vorschlag von Bob nicht dabei, Carol hat alles andere abgelehnt – ihr Wisch
  // auf den letzten Vorschlag bringt die Mehrheit. Bob verlässt die Seite, damit nur Carol den Moment sieht.
  const options = (await api(bob, "GET", `poll_options?poll_id=eq.${pollId}&select=id,title,position&order=position`)).json ?? [];
  const bobYes = new Set(((await api(bob, "GET", `poll_votes?poll_id=eq.${pollId}&response=eq.yes&select=poll_option_id`)).json ?? []).map((v) => v.poll_option_id));
  const target = options.find((o) => bobYes.has(o.id));
  check(Boolean(target), "Bob ist bei mindestens einem Vorschlag dabei");
  await page.goto(`${APP}/home`);
  const vote = async (friend, option, response) => {
    const result = await api(friend, "POST", "rpc/cast_vote", { p_option_id: option.id, p_response: response });
    if (result.status >= 300) throw new Error(`${friend.name}: Stimme fehlgeschlagen (${result.status} ${result.json?.message})`);
  };
  for (const option of options) await vote(alice, option, "no");
  for (const option of options.filter((o) => o.id !== target.id)) await vote(carol, option, "no");
  check((await api(bob, "GET", `polls?id=eq.${pollId}&select=status`)).json?.[0]?.status === "open", "ohne Mehrheit läuft die Abstimmung weiter");
  await carol.page.goto(`${APP}/polls/${pollId}`);
  const deck = carol.page.getByTestId("swipe-deck");
  await deck.getByText("noch 1 Vorschlag").waitFor();
  await deck.getByRole("button", { name: `Bin dabei: ${target.title}` }).click();
  const moment = carol.page.getByTestId("decided-moment");
  await moment.getByText("Entschieden", { exact: true }).waitFor({ timeout: 15000 });
  check(await moment.getByText(`Es wird ${target.title} – der Plan steht.`).isVisible(), "S5 Etappe 2: Carols Wisch entscheidet – „Entschieden“ mit dem Gewinner");
  await shot(carol, "45b-entschieden-moment");
  const decided = (await api(bob, "GET", `polls?id=eq.${pollId}&select=status,winning_option_id,closed_by`)).json?.[0];
  check(decided?.status === "closed" && decided.winning_option_id === target.id && decided.closed_by === null, "klare Mehrheit: Abstimmung ist von selbst entschieden");
  const plans = (await api(bob, "GET", `plans?poll_id=eq.${pollId}&select=id,title,status,plan_participants(user_id,attendance_status)`)).json ?? [];
  check(plans.length === 1 && plans[0].status === "confirmed" && plans[0].title === target.title, `genau ein bestätigter Plan „${target.title}“`);
  const going = (plans[0]?.plan_participants ?? []).filter((p) => p.attendance_status === "going").length;
  check(going === 2, `wer dabei war (Bob, Carol), ist zugesagt (${going})`);
  await moment.getByRole("button", { name: "Zum Plan" }).click();
  await carol.page.waitForURL(new RegExp(`/plans/${plans[0].id}`));
  check(true, "„Zum Plan“ im Moment öffnet den Plan");
  // Ohne Tipp springt die Seite von selbst – Bob sieht beim Öffnen einer schon entschiedenen Abstimmung keinen Moment.
  await page.goto(`${APP}/polls/${pollId}`);
  await page.getByTestId("poll-plan-note").filter({ hasText: "Automatisch angelegt" }).waitFor();
  check((await page.getByTestId("decided-moment").count()) === 0, "schon entschieden: kein Moment, nur das Ergebnis");
  await shot(bob, "45-entschieden");
  await page.getByRole("link", { name: "Zum Plan" }).click();
  await page.waitForURL(new RegExp(`/plans/${plans[0].id}`));
  await page.getByRole("heading", { level: 1 }).waitFor();
  check(true, "„Zum Plan“ öffnet den automatisch angelegten Plan");
  // Aufräumen: der Rest der Journey kennt diesen Plan nicht.
  execFileSync("psql", [DB_URL, "-qc", `delete from public.plans where id = '${plans[0].id}'`]);
});

await step("S4 – „Heute noch wer?“: Spontan-Frage an die Crew (Bob, Alice, Carol)", async () => {
  const page = bob.page;
  await page.goto(`${APP}/home`);
  const launcher = page.getByRole("button", { name: "Heute noch wer?" });
  await launcher.click();
  const sheet = page.getByRole("dialog", { name: "Heute noch wer?" });
  await sheet.getByLabel("Worauf hast du Lust? (optional)").fill("  Bier im   Park  ");
  if ((await sheet.getByText("Welche Crew?").count()) > 0) await sheet.getByRole("button", { name: /Weekend Crew/ }).click();
  await shot(bob, "46-heute-noch-wer-frage");
  await sheet.getByRole("button", { name: "Crew fragen" }).click();
  await toast(bob, "Gefragt – deine Crew bekommt Bescheid.");
  const card = page.getByTestId("spontaneous-card");
  await card.getByText("Bier im Park", { exact: true }).waitFor();
  check(await card.getByText(/^Du fragst in /).isVisible(), "Bob sieht seine Frage als Karte");
  await card.getByText("1 hat Bock").waitFor();
  check((await card.getAttribute("data-answer")) === "in", "wer fragt, hat Bock – die Karte ist Lime");
  check(/noch (1:5\d|2:00) h/.test(await card.innerText()), "Restzeit knapp 2 Stunden");
  check((await page.getByRole("button", { name: "Heute noch wer?" }).count()) === 0, "in einer Crew mit laufender Frage kein zweiter Knopf");
  await noOverflow(bob, "Heute noch wer? (390 px)");
  await shot(bob, "47-heute-noch-wer-karte");

  const asks = (await api(bob, "GET", "spontaneous_asks?select=id,crew_id,note,expires_at,closed_at&closed_at=is.null")).json ?? [];
  check(asks.length === 1 && asks[0].note === "Bier im Park", "eine Frage, Notiz bereinigt");
  const askId = asks[0]?.id;
  const notified = (await api(alice, "GET", "notifications?type=eq.spontaneous_ask&select=payload")).json ?? [];
  check(notified.length === 1 && notified[0].payload?.ask_id === askId, "Alice bekommt Bescheid");
  const anonRead = await api(null, "GET", "spontaneous_asks?select=id");
  check(anonRead.status >= 400 || anonRead.json?.length === 0, `ohne Konto sieht niemand die Frage (${anonRead.status})`);
  const anonAnswer = await api(null, "POST", "rpc/answer_spontaneous", { p_ask_id: askId, p_answer: "in" });
  check(anonAnswer.status >= 400, `ohne Konto keine Antwort (${anonAnswer.status})`);

  // Alice (Desktop) antwortet auf Home mit einem Tipp – erst „heute nicht“, dann doch „Bock“.
  await alice.page.goto(`${APP}/home`);
  const aliceCard = alice.page.getByTestId("spontaneous-card");
  await aliceCard.getByText(/^Bob fragt in /).waitFor();
  await aliceCard.getByRole("button", { name: "Heute nicht" }).click();
  await toast(alice, "Alles klar, vielleicht nächstes Mal.");
  await aliceCard.getByText("1 heute nicht", { exact: false }).waitFor();
  check((await aliceCard.getAttribute("data-answer")) === "out", "„heute nicht“ färbt die Karte rot");
  await aliceCard.getByRole("button", { name: "Bock" }).click();
  await aliceCard.getByText("2 haben Bock").waitFor();
  check(await aliceCard.getByRole("button", { name: "Bock" }).getAttribute("aria-pressed") === "true", "Antwort lässt sich ändern");
  check(await aliceCard.getByText("Noch 1, dann seid ihr eine Runde.").isVisible(), "zeigt, wie viele noch fehlen");
  check((await aliceCard.getByRole("button", { name: "Frage beenden" }).count()) === 1, "Alice (Owner) darf die Frage beenden");
  await shot(alice, "48-heute-noch-wer-antwort");

  // Carol (Tablet) macht die Runde voll.
  await carol.page.goto(`${APP}/home`);
  const carolCard = carol.page.getByTestId("spontaneous-card");
  await carolCard.getByRole("button", { name: "Bock" }).click();
  await carolCard.getByText("Ihr seid eine Runde – macht was draus!").waitFor();
  check((await carolCard.getByRole("button", { name: "Frage beenden" }).count()) === 0, "einfache Mitglieder beenden fremde Fragen nicht");
  check((await carolCard.getByRole("link", { name: "Plan erstellen" }).getAttribute("href"))?.includes("/plans/new?crew="), "„Plan erstellen“ mit der Crew");
  await shot(carol, "49-heute-noch-wer-runde");

  // S4 Etappe 2: Steht die Runde, zeigt die Karte, was laut OpenStreetMap gerade offen hat – nie Geschlossenes,
  // Unbekanntes als unbekannt. Was offen ist, hängt von der Uhrzeit des Laufs ab; geprüft wird die Ehrlichkeit.
  let planHere = null;
  for (const [user, cardOf] of [[alice, aliceCard], [carol, carolCard]]) {
    if (user === alice) await alice.page.reload();
    await cardOf.getByText("Ihr seid eine Runde – macht was draus!").waitFor();
    const section = cardOf.getByTestId("open-now");
    await section.waitFor();
    await user.page.waitForFunction(() => !document.querySelector('[data-testid="open-now"][aria-busy]'), null, { timeout: 30_000 });
    const text = (await section.innerText()).replace(/\s+/g, " ");
    const places = section.getByTestId("open-now-place");
    const n = await places.count();
    check(n <= 3, `${user.name}: höchstens drei Orte (${n})`);
    for (let i = 0; i < n; i++) {
      const row = places.nth(i);
      const rowText = (await row.innerText()).replace(/\s+/g, " ");
      if ((await row.getAttribute("data-open")) === "true") check(/Geöffnet bis \d\d:\d\d Uhr/.test(rowText), `${user.name}: offener Ort nennt, bis wann („${rowText}“)`);
      else check(/Öffnungszeiten/.test(rowText) && !/Geschlossen/.test(rowText), `${user.name}: Ort ohne bekannte Öffnungszeiten ist so beschriftet („${rowText}“)`);
      const href = await row.getByRole("link", { name: /^Plan hier/ }).getAttribute("href");
      check(/^\/plans\/new\?crew=[^&]+&activity=[^&]+&soon=1$/.test(href ?? ""), `${user.name}: „Plan hier“ mit Crew, Ort und „gleich“ (${href})`);
      planHere ??= { user, href, name: (await row.getByRole("link").first().innerText()).trim() };
    }
    if (n > 0) check(text.includes("Öffnungszeiten laut OpenStreetMap"), `${user.name}: Quelle der Öffnungszeiten steht dabei`);
    else check(/Wähl in Discover deine Stadt|hat laut OpenStreetMap gerade nichts Passendes offen|noch keine Orte geladen/.test(text), `${user.name}: ohne Orte ein ehrlicher Hinweis („${text}“)`);
    check(!/Geschlossen/.test(text), `${user.name}: keine geschlossenen Orte`);
  }
  await noOverflow(carol, "Heute noch wer? – jetzt offen");
  await shot(alice, "49b-heute-noch-wer-jetzt-offen");
  if (planHere) {
    // „Plan hier“: Formular mit Ort als Titel und Beginn in gut einer halben Stunde.
    await planHere.user.page.goto(`${APP}${planHere.href}`);
    const title = planHere.user.page.locator('input[name="title"]');
    await title.waitFor();
    check((await title.inputValue()) === planHere.name, `„Plan hier“ übernimmt den Ort als Titel (${planHere.name})`);
    const date = await planHere.user.page.locator('input[name="date"]').inputValue();
    const time = await planHere.user.page.locator('input[name="time"]').inputValue();
    check(/^\d{4}-\d\d-\d\d$/.test(date) && /^\d\d:(00|15|30|45)$/.test(time), `„Plan hier“ setzt Tag und Uhrzeit auf die Viertelstunde (${date} ${time})`);
    await planHere.user.page.goto(`${APP}/home`);
  }
  const match =(await api(bob, "GET", "notifications?type=eq.spontaneous_match&select=payload")).json ?? [];
  check(match.length === 1 && match[0].payload?.in_count === 3, "Bob erfährt: ihr seid drei");
  await page.goto(`${APP}/home`);
  await card.getByText("Ihr seid eine Runde – macht was draus!").waitFor();
  await card.getByText("3 haben Bock").waitFor();
  await shot(bob, "50-heute-noch-wer-runde-mobile");

  // Bob beendet die Frage – die Karte verschwindet, der Knopf ist wieder da.
  await card.getByRole("button", { name: "Frage beenden" }).click();
  await toast(bob, "Frage beendet.");
  await page.getByRole("button", { name: "Heute noch wer?" }).waitFor();
  check((await page.getByTestId("spontaneous-card").count()) === 0, "beendete Frage verschwindet von Home");
  const after = await api(carol, "POST", "rpc/answer_spontaneous", { p_ask_id: askId, p_answer: "out" });
  check(after.status >= 400 && after.json?.message === "spontaneous_over", "nach dem Beenden keine Antwort mehr");

  // S4 Etappe 2: App-Kurzbefehl im Manifest öffnet „Heute noch wer?“ direkt – nur einmal.
  const manifest = await (await fetch(`${APP}/manifest.webmanifest`)).json();
  check(manifest.shortcuts?.some((s) => s.url === "/home?frage=heute" && s.name === "Heute noch wer?"), "Manifest bietet den Kurzbefehl „Heute noch wer?“");
  await page.goto(`${APP}/home?frage=heute`);
  // Die Hülle des Dialogs selbst hat keine Größe – sichtbar ist das Feld darin.
  await page.getByRole("dialog", { name: "Heute noch wer?" }).getByLabel("Worauf hast du Lust? (optional)").waitFor();
  await page.waitForFunction(() => !location.search.includes("frage="));
  check(true, "Kurzbefehl öffnet das Sheet, die Adresse vergisst ihn");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.reload();
  await page.getByRole("button", { name: "Heute noch wer?" }).waitFor();
  check((await page.getByRole("dialog").count()) === 0, "Neuladen öffnet das Sheet nicht erneut");

  // Nach 2 Stunden verschwindet eine Frage von selbst.
  if (DB_URL) {
    const asked = await api(carol, "POST", "rpc/ask_spontaneous", { p_crew_id: asks[0]?.crew_id, p_note: "Pizza?" });
    check(asked.status < 300, "Carol fragt neu");
    await alice.page.reload();
    await alice.page.getByTestId("spontaneous-card").getByText("Pizza?").waitFor();
    execFileSync("psql", [DB_URL, "-qc", `update public.spontaneous_asks set created_at = now() - interval '3 hours', expires_at = now() - interval '1 hour' where id = '${asked.json}'`]);
    await alice.page.reload();
    await alice.page.getByRole("button", { name: "Heute noch wer?" }).waitFor();
    check((await alice.page.getByTestId("spontaneous-card").count()) === 0, "abgelaufene Frage verschwindet von Home");
  }
  // Fehlerzustand: Lassen sich die Fragen nicht laden, sagt Home das – mit „Erneut versuchen“.
  await page.route("**/rest/v1/spontaneous_asks**", (route) => route.abort("failed"));
  await page.goto(`${APP}/home`);
  await page.getByText("Die Daten konnten nicht geladen werden.").waitFor({ timeout: 30_000 });
  check((await page.getByRole("button", { name: "Heute noch wer?" }).count()) === 0, "ohne geladene Fragen kein Knopf (sonst doppelte Frage)");
  await page.unroute("**/rest/v1/spontaneous_asks**");
  await page.getByRole("button", { name: "Erneut versuchen" }).click();
  await page.getByRole("button", { name: "Heute noch wer?" }).waitFor();
  check(true, "„Erneut versuchen“ lädt die Fragen");
});

await step("S7 – Runde jede Woche von selbst: „Freitag, was geht?“ (Bob, Carol)", async () => {
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
  const created = await api(bob, "POST", "rpc/create_poll", {
    p_crew_id: ids.crew, p_title: "Freitag, was geht?", p_ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    p_options: [{ title: "Bowling", proposed_date: day, proposed_time: "20:00" }, { title: "Kino" }],
    p_description: null, p_meeting_point: null, p_budget_cents: null, p_min_participants: null,
  });
  if (created.status >= 300) throw new Error(`Abstimmung anlegen fehlgeschlagen (${created.status} ${created.json?.message})`);
  const pollId = created.json;
  let seriesId = null;
  try {
    await bob.page.goto(`${APP}/polls/${pollId}`);
    const toggle = bob.page.getByRole("switch", { name: /^Jede Woche neu/ });
    await toggle.waitFor();
    check(!(await toggle.isChecked()), "„Jede Woche neu“ ist standardmäßig aus");
    await toggle.click();
    await toast(bob, "Läuft ab jetzt jede Woche.");
    await bob.page.getByTestId("poll-repeat").getByText(/Nächste Runde ab .+, entscheidet sich bis /).waitFor();
    await bob.page.getByText("Jede Woche", { exact: true }).first().waitFor();
    check(true, "Ersteller:in schaltet „Jede Woche neu“ ein und sieht, wann die nächste Runde startet");
    await noOverflow(bob, "Jede Woche neu");
    await shot(bob, "47-jede-woche");
    seriesId = (await api(bob, "GET", `polls?id=eq.${pollId}&select=series_id`)).json?.[0]?.series_id;
    check(Boolean(seriesId), "Abstimmung gehört zu einer Serie");
    await carol.page.goto(`${APP}/polls/${pollId}`);
    await carol.page.getByText("Jede Woche", { exact: true }).first().waitFor();
    check((await carol.page.getByRole("switch", { name: /^Jede Woche neu/ }).count()) === 0, "einfache Mitglieder sehen das Kennzeichen, aber keinen Schalter");
    const outsider = await api(mallory, "POST", "rpc/set_poll_repeat", { p_poll_id: pollId, p_enabled: false });
    check(outsider.status >= 400, `API: Außenstehende schalten nichts um (${outsider.status})`);

    // Die Runde ist vorbei, die nächste müsste schon laufen: Home stößt sie an.
    psql(`update public.polls set ends_at = now() - interval '5 days', created_at = now() - interval '8 days', status = 'closed', closed_at = now() - interval '5 days' where id = '${pollId}'`);
    await bob.page.goto(`${APP}/home`);
    let rounds = [];
    for (let i = 0; i < 30 && rounds.length < 2; i++) {
      rounds = (await api(bob, "GET", `polls?series_id=eq.${seriesId}&select=id,status,ends_at,poll_options!poll_options_poll_id_fkey(title,proposed_date)&order=ends_at`)).json ?? [];
      if (rounds.length < 2) await bob.page.waitForTimeout(500);
    }
    check(rounds.length === 2 && rounds[1].status === "open", `Home startet die nächste Runde von selbst (${rounds.length} Runden)`);
    const nextDay = new Date(new Date(`${day}T12:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    check(rounds[1]?.poll_options?.find((o) => o.title === "Bowling")?.proposed_date === nextDay, "gleiche Vorschläge, Termin eine Woche später");
    await bob.page.reload();
    await bob.page.getByRole("button", { name: "Was geht?" }).waitFor();
    check((await api(bob, "GET", `polls?series_id=eq.${seriesId}&select=id`)).json?.length === 2, "Neuladen startet keine zweite Runde");
    await carol.page.goto(`${APP}/notifications`);
    await carol.page.getByText("Neue Runde – was geht diese Woche?").first().waitFor();
    check(true, "die Crew bekommt „Neue Runde – was geht diese Woche?“");
    await carol.page.goto(`${APP}/polls/${rounds[1].id}`);
    await carol.page.getByRole("heading", { level: 1 }).filter({ hasText: /was geht/i }).waitFor();
    await carol.page.getByText("Jede Woche", { exact: true }).first().waitFor();
    check(true, "die neue Runde trägt „Jede Woche“");
  } finally {
    // Aufräumen: Die übrige Journey kennt diese Abstimmungen nicht.
    if (seriesId) psql(`delete from public.polls where series_id = '${seriesId}'; delete from public.poll_series where id = '${seriesId}'`);
    psql(`delete from public.polls where id = '${pollId}'`);
  }
});

await step("Fehlerzustände – unbekannte Seite, Serverausfall, langsames Netz", async () => {
  const { page } = carol;
  await page.goto(`${APP}/gibt-es-nicht`);
  await page.getByText("Diese Seite gibt es nicht").waitFor();
  check(true, "unbekannte Adresse zeigt eine 404-Seite");
  // API-Ausfall simulieren: Abfragen an die REST-Schnittstelle schlagen fehl.
  await page.route("**/rest/v1/rpc/search_activities**", (route) => route.abort("failed"));
  await page.goto(`${APP}/discover`);
  await page.getByText("Die Daten konnten nicht geladen werden.").waitFor({ timeout: 30_000 });
  check(await page.getByRole("button", { name: "Erneut versuchen" }).isVisible(), "fehlgeschlagene Abfrage zeigt Fehlermeldung mit „Erneut versuchen“");
  await shot(carol, "28-fehlerzustand");
  await page.unroute("**/rest/v1/rpc/search_activities**");
  await page.getByRole("button", { name: "Erneut versuchen" }).click();
  await page.getByRole("heading", { name: "Strike District Bowling" }).waitFor();
  check(true, "erneuter Versuch lädt die Daten");
  // Langsames Netz: Platzhalter statt leerer Seite.
  await page.route("**/rest/v1/plans**", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto(`${APP}/plans`);
  check(await page.getByRole("status").first().isVisible(), "langsames Netz zeigt einen Ladezustand");
  await page.getByRole("link", { name: /Strike District Bowling/ }).first().waitFor({ state: "attached" }).catch(() => {});
  await page.unroute("**/rest/v1/plans**");
});

await browser.close();

console.log("");
if (A11Y) {
  const findings = [...a11yFindings.values()].sort((a, b) => Number(A11Y_BLOCKING.has(b.impact)) - Number(A11Y_BLOCKING.has(a.impact)));
  const blocking = findings.filter((f) => A11Y_BLOCKING.has(f.impact));
  console.log(`Barrierefreiheit: ${a11yScans} Bildschirme geprüft, ${blocking.length} schwere und ${findings.length - blocking.length} leichtere Befunde.`);
  for (const f of findings.slice(0, 100)) {
    console.log(`  ${A11Y_BLOCKING.has(f.impact) ? "✗" : "·"} [${f.impact}] ${f.rule} – ${f.help}`);
    console.log(`      ${f.target}  ${f.html.slice(0, 160)}`);
    if (f.detail) console.log(`      ${f.detail.slice(0, 300)}`);
    console.log(`      auf: ${f.screens.slice(0, 6).join(", ")}${f.screens.length > 6 ? ` (+${f.screens.length - 6})` : ""}`);
  }
  for (const f of blocking) failures.push(`Barrierefreiheit: ${f.rule} bei ${f.target} (${f.screens.length} Bildschirme)`);
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, "a11y.json"), JSON.stringify({ scans: a11yScans, findings }, null, 2));
}
if (problems.length > 0) {
  console.log(`Konsolen-/Serverfehler während des Tests (${problems.length}):`);
  for (const problem of [...new Set(problems)].slice(0, 20)) console.log(`  - ${problem}`);
  failures.push(`${problems.length} Konsolen- oder Serverfehler`);
}
console.log(`${passed} Prüfungen bestanden, ${failures.length} fehlgeschlagen.`);
for (const failure of failures) console.log(`  ✗ ${failure}`);
process.exit(failures.length > 0 ? 1 : 0);
