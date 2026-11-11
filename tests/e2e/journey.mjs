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
import crypto from "node:crypto";
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
/** P11 Etappe 2d: neueste E-Mail an diese Adresse (Betreff, HTML), sobald es mehr als `sinceCount` sind – null ohne Mailpit. */
async function lastMail(email, sinceCount = 0) {
  if (!mailpitAvailable) return null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    if ((list.messages?.length ?? 0) > sinceCount) return await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Keine neue E-Mail für ${email}`);
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
  // Laufende Übergänge (Farbwechsel, Stempel, Seitenwechsel) erst zu Ende laufen lassen – sonst zeigt das Bild einen
  // Zwischenstand und die Kontrastprüfung misst eine Mischfarbe (z. B. ein gerade abgewählter roter Knopf).
  await user.page
    .evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))))
    .catch(() => undefined);
  await noOverflow(user, name);
  await a11y(user, name);
  if (!SHOTS) return;
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

/** D4 Etappe 2: Kartenstapel über der Überschrift, Symbol des Schritts vorn, für Screenreader ausgeblendet. */
async function stepArt(page, n, label) {
  const art = page.locator("main [data-empty-art]").first();
  await art.waitFor();
  check((await art.getAttribute("aria-hidden")) === "true", `${label}: Bild ist für Screenreader ausgeblendet`);
  check((await art.locator(`[data-step-art="${n}"]`).count()) === 1, `${label}: Bild zeigt das Symbol von Schritt ${n}`);
}

async function onboard(user, { full = false } = {}) {
  const { page } = user;
  await page.getByRole("heading", { name: "Wie sollen dich deine Freunde sehen?" }).waitFor();
  check((await page.getByLabel("Anzeigename").inputValue()) === user.name, `${user.name}: Anzeigename aus der Registrierung ist vorausgefüllt`);
  if (full) {
    await page.locator('input[type="file"]').setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Bild entfernen" }).waitFor();
    await page.getByLabel("Stadt oder Region").fill("Berlin");
    await stepArt(page, 1, "Onboarding Profil");
    await shot(user, "02-onboarding-profil");
  }
  await page.getByRole("button", { name: "Weiter" }).click();
  if (full) {
    await page.getByRole("button", { name: "Essen & Cafés" }).click();
    await page.getByRole("button", { name: "Sport", exact: true }).first().click();
    await page.getByRole("button", { name: "Bowling" }).click();
    await stepArt(page, 2, "Onboarding Interessen");
    await shot(user, "03-onboarding-interessen");
  }
  await page.getByRole("button", { name: "Weiter" }).click();
  if (full) {
    await page.getByRole("button", { name: "bis 20 €" }).click();
    await stepArt(page, 3, "Onboarding Vorlieben");
  }
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

/** P4: Push entschlüsseln wie ein Gerät (RFC 8291, aes128gcm) – Gegenprobe zur Edge Function. */
function decryptWebPush(body, device, authSecret) {
  const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
  const hkdf = (salt, ikm, info, length) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const senderPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const devicePublic = device.getPublicKey();
  const ecdhSecret = device.computeSecret(senderPublic);
  const ikm = hkdf(authSecret, ecdhSecret, Buffer.concat([Buffer.from("WebPush: info\0"), devicePublic, senderPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const record = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end--;
  if (record[end] !== 2) throw new Error("Push: ungültiger Trenner");
  return record.subarray(0, end).toString("utf8");
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

// V2 Etappe 3o: Datenschutz-Seite ohne Anmeldung – Kopf als Karte, Abschnitte als Glas-Karten, Sprung-Pillen.
await step("V2 – Datenschutz als Glas-Karten (ohne Anmeldung)", async () => {
  for (const user of [alice, bob]) {
    const { page } = user;
    await page.goto(`${APP}/privacy`);
    await page.getByRole("heading", { level: 1, name: "Datenschutz und deine Daten" }).waitFor();
    const hero = page.getByTestId("privacy-hero");
    for (const fact of ["Kein Tracking", "Keine Werbung", "Standort aus"]) await hero.getByText(fact, { exact: true }).waitFor();
    check((await page.getByTestId("privacy-disclaimer").innerText()).includes("ersetzt keine rechtlich geprüfte Datenschutzerklärung"), `Datenschutz: Hinweis „nicht rechtlich geprüft“ steht in der Karte (${user.viewport})`);
    check((await page.locator("section.plan-panel[data-tone]").count()) === 5, `Datenschutz: fünf Abschnitte als Glas-Karten mit Farbschein (${user.viewport})`);
    const jump = page.getByRole("navigation", { name: "Springe zu" });
    check((await jump.getByRole("link").count()) === 5, `Datenschutz: fünf Sprung-Pillen (${user.viewport})`);
    await jump.getByRole("link", { name: "Standort" }).click();
    await page.waitForFunction(() => location.hash === "#privacy-location");
    check(await page.getByRole("heading", { level: 2, name: "Standort" }).isVisible(), `Datenschutz: Sprung-Pille führt zu „Standort“ (${user.viewport})`);
    await page.evaluate(() => window.scrollTo(0, 0));
    check((await page.getByRole("link", { name: "Zur Anmeldung" }).count()) === 1, `Datenschutz ohne Konto führt zur Anmeldung (${user.viewport})`);
    await shot(user, "00-datenschutz");
  }
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
    page.evaluate(async () => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // Laufende Übergänge (transition-colors) zu Ende abwarten – eine feste Pause reicht unter Last nicht immer.
      await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
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

  // D4: Leere Zustände im Stil 2.0 – Kartenstapel mit dem Symbol des Bereichs, Text und nächster Schritt.
  const { page } = alice;
  for (const [path, title, name] of [
    ["/crews", "Noch keine Crew", "04b-leer-crews"],
    ["/plans", null, "04c-leer-plaene"],
    ["/notifications", "Alles gelesen", "04d-leer-benachrichtigungen"],
  ]) {
    await page.goto(`${APP}${path}`);
    const empty = page.locator("[data-empty-state]").filter({ has: page.locator("[data-empty-art]") }).first();
    await empty.waitFor();
    if (title) check(await empty.getByText(title, { exact: true }).isVisible(), `${path}: leerer Zustand „${title}“ mit Bild`);
    else check(true, `${path}: leerer Zustand mit Bild`);
    check((await empty.locator("[data-empty-art]").getAttribute("aria-hidden")) === "true", `${path}: Bild ist für Screenreader ausgeblendet`);
    await shot(alice, name);
  }
  await page.goto(`${APP}/home`);
  await page.getByText("In drei Schritten zum ersten Plan").waitFor();
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
  // W9: Link als QR-Code – erst auf Tipp, im Browser erzeugt, kein Bild von außen.
  check((await dialog(alice).getByTestId("qr-code").count()) === 0, "W9: QR-Code erst auf Tipp");
  const qrRequests = [];
  const onQrRequest = (request) => {
    if (!request.url().startsWith(APP) && !/supabase|127\.0\.0\.1|localhost/.test(request.url())) qrRequests.push(request.url());
  };
  alice.page.on("request", onQrRequest);
  await dialog(alice).getByRole("button", { name: "Als QR-Code zeigen" }).click();
  const qr = dialog(alice).getByRole("img", { name: "QR-Code mit dem Einladungslink für „Weekend Crew“" });
  await qr.waitFor();
  const { qrMatrix, qrPath } = await import("../../src/lib/qr.ts");
  check((await qr.locator("path").getAttribute("d")) === qrPath(qrMatrix(ids.invite)), "W9: QR-Code enthält genau den Einladungslink");
  const qrBox = await qr.boundingBox();
  const modules = Number(await qr.getAttribute("data-modules"));
  check(qrBox.width >= 200 && qrBox.width / (modules + 8) >= 4, `W9: groß genug zum Scannen (${Math.round(qrBox.width)} px, ${modules} Module)`);
  check(await dialog(alice).getByText(/^Mit der Handy-Kamera scannen/).isVisible(), "W9: Hinweis zum Scannen");
  check(qrRequests.length === 0, `W9: keine Anfrage an Dritte (${qrRequests.join(", ")})`);
  alice.page.off("request", onQrRequest);
  await shot(alice, "05b-einladung-qr");
  await dialog(alice).getByRole("button", { name: "QR-Code ausblenden" }).click();
  check((await dialog(alice).getByTestId("qr-code").count()) === 0, "W9: QR-Code lässt sich ausblenden");
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
    // V2 Etappe 3f: Einladung als Karte – wer einlädt als Lime-Pille, Crew in Chrom, Frist ruhig als Glas-Pille.
    check(/Alice lädt dich ein/.test(await pass.getByTestId("invite-by").innerText()), `${friend.name}: V2 – wer einlädt als Pille`);
    check(await pass.locator("#invite-crew.chrome").isVisible(), `${friend.name}: V2 – Crew-Name als Chrom-Plakat`);
    const expires = (await pass.getByTestId("invite-expires").innerText()).trim();
    check(/^Link (läuft .+ ab|gilt bis .+)$/.test(expires), `${friend.name}: V2 – Frist des Links („${expires}“)`);
    check((await pass.locator(".ticket-stub").count()) === 0, `${friend.name}: V2 – kein Ticket-Abriss mehr`);
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
  // V2 Etappe 3j: Mitglieder als Glas-Karte, Rollen als Pillen (Owner in Lime).
  {
    const members = alice.page.getByTestId("crew-members");
    check((await members.evaluate((el) => getComputedStyle(el).borderRadius)) === "28px", "Mitgliederliste als Glas-Karte");
    const roles = await members.getByTestId("member-role").evaluateAll((els) => els.map((el) => [el.textContent?.trim(), getComputedStyle(el).backgroundColor]));
    check(roles.some(([label, bg]) => label === "Owner" && bg === "rgb(200, 255, 46)"), `Owner-Rolle als Lime-Pille (${roles.map((r) => r.join(" ")).join("; ")})`);
  }
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
  // V2 Etappe 3n: Abschnitte als Glas-Karten, Art als Auswahlkarten, Zähler, Frist als Lime-Pille.
  for (const id of ["poll-form-question", "poll-form-when", "poll-form-options", "poll-form-ends", "poll-form-more"]) {
    check((await page.getByTestId(id).count()) === 1, `Abstimmung-Formular: Abschnitt ${id}`);
  }
  check((await page.getByRole("tab", { name: /Was machen wir\?/ }).getAttribute("aria-selected")) === "true", "Abstimmung-Formular: „Was machen wir?“ ist als Karte gewählt");
  check((await page.getByTestId("poll-form-option").count()) === 3 && (await page.getByTestId("poll-form-options").getByText("3 von 10").isVisible()), "Abstimmung-Formular: drei Vorschläge als Karten, Zähler „3 von 10“");
  check((await page.getByTestId("poll-form-when-preview").getAttribute("data-filled")) === "true", "Abstimmung-Formular: Datumskachel zeigt den vorgeschlagenen Tag");
  check((await page.getByTestId("poll-form-ends-at").innerText()).trim() === "Endet morgen, 12:00 Uhr", "Abstimmung-Formular: Frist als Lime-Pille („Endet morgen, 12:00 Uhr“)");
  await page.getByRole("button", { name: "in 2 Stunden" }).click();
  check(/^Endet (heute|morgen), \d{2}:\d{2} Uhr$/.test((await page.getByTestId("poll-form-ends-at").innerText()).trim()), "Abstimmung-Formular: Pille folgt der gewählten Frist");
  await page.getByRole("button", { name: "morgen 12 Uhr" }).click();
  await shot(alice, "10-abstimmung-erstellen");
  await page.getByRole("button", { name: "Abstimmung starten" }).click();
  await page.waitForURL(/\/polls\/[0-9a-f-]{36}/);
  ids.poll = idFromUrl(page);
  await page.getByRole("heading", { name: ids.pollTitle }).waitFor();
  check((await page.getByRole("radiogroup").count()) === 3, "Abstimmung hat drei Optionen");
  // Auf dem Handy (390 px): dieselben Karten ohne seitlichen Überlauf, auch bei „Wann könnt ihr?“.
  await bob.page.goto(`${APP}/polls/new`);
  await bob.page.getByTestId("poll-form-question").waitFor();
  await noOverflow(bob, "Abstimmung starten");
  await shot(bob, "10b-abstimmung-erstellen");
  await bob.page.getByRole("tab", { name: /Wann könnt ihr\?/ }).click();
  await bob.page.getByTestId("poll-form-dates").waitFor();
  check((await bob.page.getByTestId("poll-form-slot").count()) === 3 && (await bob.page.getByTestId("poll-form-dates").getByText("3 von 10").isVisible()), "Termin-Abstimmung: drei Termine als Karten, Zähler „3 von 10“");
  await noOverflow(bob, "Termin-Abstimmung starten");
  await shot(bob, "10c-termin-abstimmung-erstellen");
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
  // W9 Etappe 2: derselbe Link als QR-Code – für Freunde am Tisch, im Browser erzeugt.
  {
    const { qrMatrix, qrPath } = await import("../../src/lib/qr.ts");
    await bob.page.getByRole("button", { name: "Als QR-Code zeigen" }).click();
    const qrDialog = bob.page.getByRole("dialog", { name: "Zum Scannen" });
    const qr = qrDialog.getByRole("img", { name: `QR-Code mit dem Link zu „${ids.pollTitle}“` });
    await qr.waitFor();
    check((await qr.locator("path").getAttribute("d")) === qrPath(qrMatrix(ids.pollShareUrl)), "W9 Etappe 2: QR-Code enthält genau den geteilten Abstimmungs-Link");
    const box = await qr.boundingBox();
    const modules = Number(await qr.getAttribute("data-modules"));
    check(box.width >= 200 && box.width / (modules + 8) >= 4, `W9 Etappe 2: groß genug zum Scannen (${Math.round(box.width)} px, ${modules} Module)`);
    check(await qrDialog.getByText(/^Freunde am Tisch halten die Handy-Kamera drauf/).isVisible(), "W9 Etappe 2: Hinweis zum Scannen");
    await shot(bob, "11a-abstimmung-qr");
    await qrDialog.getByRole("button", { name: "Schließen" }).click();
    await qrDialog.waitFor({ state: "detached" });
    check(true, "W9 Etappe 2: QR-Dialog schließt");
  }

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

  // D3 Etappe 1: Carol stimmt direkt auf Home ab – Vorschlag für Vorschlag, ohne die Abstimmung zu öffnen.
  await carol.page.goto(`${APP}/home`);
  const quick = carol.page.getByTestId("poll-quick-vote");
  await quick.waitFor();
  const quickState = async () => [(await quick.getByTestId("poll-quick-progress").textContent()).trim(), (await quick.getByTestId("poll-quick-option").textContent()).trim()];
  check(JSON.stringify(await quickState()) === JSON.stringify(["Vorschlag 1 von 3", "Strike District Bowling"]), `D3: Home legt den ersten Vorschlag ohne Antwort auf (${await quickState()})`);
  await noOverflow(carol, "Home – abstimmen");
  await shot(carol, "11b-home-abstimmen");
  const quickAnswer = async (option, label) => {
    const saved = carol.page.waitForResponse((r) => r.url().includes("/rpc/cast_vote") && r.request().method() === "POST");
    await quick.getByRole("group", { name: `Schnell antworten für ${option}` }).getByRole("button", { name: label, exact: true }).click();
    check((await saved).ok(), `D3: „${label}“ für ${option} auf Home gespeichert`);
  };
  await quickAnswer("Strike District Bowling", "Bin dabei");
  await quick.getByRole("group", { name: "Schnell antworten für Lichtspielhaus Nord" }).waitFor();
  check(JSON.stringify(await quickState()) === JSON.stringify(["Vorschlag 2 von 3", "Lichtspielhaus Nord"]), "D3: nach dem Tipp liegt sofort der nächste Vorschlag oben");
  await quickAnswer("Lichtspielhaus Nord", "Bin dabei");
  await quick.getByRole("group", { name: "Schnell antworten für Grillen bei Bob" }).waitFor();
  await quick.getByRole("button", { name: "Überspringen" }).click();
  await carol.page.getByTestId("poll-quick-done").waitFor();
  check(await carol.page.getByRole("heading", { name: "Deine Antwort fehlt" }).isVisible(), "D3: wer durch ist, sieht „Du bist durch“ – die Karte springt nicht mitten im Abstimmen weg");
  await carol.page.reload();
  await carol.page.getByRole("heading", { name: "Laufende Abstimmungen" }).waitFor();
  check((await carol.page.getByTestId("poll-quick-vote").count()) === 0, "D3: beim nächsten Öffnen steht die Abstimmung unter „Laufende Abstimmungen“, übersprungener Vorschlag bleibt ohne Antwort");
  await carol.page.goto(`${APP}/polls/${ids.poll}`);
  await answered(carol, "Strike District Bowling", "Bin dabei").waitFor();
  await answered(carol, "Lichtspielhaus Nord", "Bin dabei").waitFor();
  check((await carol.page.locator(".vote-card:not([data-answer])").filter({ hasText: "Grillen bei Bob" }).count()) === 1, "D3: die Abstimmung zeigt Carols Antworten von Home");
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
  // V2 Etappe 3d: Kopf der Abstimmung als Pillen – Frist in Lime, Beteiligung mit Balken.
  check((await alice.page.getByTestId("poll-ends").innerText()).startsWith("Endet"), "Kopf: Frist als Lime-Pille");
  check(/^(\d+) von \1 haben abgestimmt$/.test((await alice.page.getByTestId("poll-turnout").innerText()).trim()), "Kopf: Beteiligung als Pille mit Balken");
  await shot(alice, "12-abstimmung-zwischenstand");
  await carol.page.reload();
  await optionCard(carol, "Strike District Bowling").getByText("3 Zusagen").waitFor();
  // D1: Die Stimmbalken wachsen beim Öffnen von null auf ihren Stand (@starting-style, ohne JavaScript).
  const growth = await carol.page.evaluate(() => {
    const rules = (list) => [...list].flatMap((r) => [r, ...(r.cssRules ? rules(r.cssRules) : [])]);
    const all = [...document.styleSheets].flatMap((sheet) => {
      try {
        return rules(sheet.cssRules);
      } catch {
        return [];
      }
    });
    const starting = all.some((r) => r.constructor.name === "CSSStartingStyleRule" && r.cssText.includes(".bar-grow"));
    const bars = [...document.querySelectorAll(".poll-option .poll-bar-fill")];
    return { starting, bars: bars.length, grow: bars.every((b) => b.classList.contains("bar-grow") && getComputedStyle(b).transitionProperty.includes("width")) };
  });
  check(growth.starting && growth.bars > 0 && growth.grow, `D1: Stimmbalken wachsen beim Öffnen auf ihren Stand (${JSON.stringify(growth)})`);
  await shot(carol, "12-abstimmung-zwischenstand");
  const bowlingBar = await optionCard(carol, "Strike District Bowling").locator(".poll-bar-fill").evaluate((b) => b.getBoundingClientRect().width / b.parentElement.getBoundingClientRect().width);
  check(bowlingBar > 0.2, `D1: nach dem Wachsen steht der Balken auf seinem Anteil (${Math.round(bowlingBar * 100)} %)`);

  // P38: „Zwischenstand teilen“ auf der Abstimmung (Bob, 390 px) – Zusagen je Vorschlag, nur Zahlen, gleicher /v/-Link.
  {
    const { page, context } = bob;
    const pollShareToken = page.waitForResponse((r) => r.url().includes("/rpc/poll_share_token") && r.ok());
    await page.goto(`${APP}/polls/${ids.poll}`);
    await optionCard(bob, "Strike District Bowling").getByText("3 Zusagen").waitFor();
    await pollShareToken;
    await page.getByTestId("poll-standing").scrollIntoViewIfNeeded();
    await noOverflow(bob, "Abstimmung – Zwischenstand teilen");
    await shot(bob, "12b-abstimmung-zwischenstand-teilen");
    await stubShare(page);
    await page.getByRole("button", { name: "Zwischenstand teilen" }).click();
    await page.waitForFunction(() => (window.__shared ?? []).length >= 1);
    const standing = (await sharedData(page))[0];
    const text = standing?.text ?? "";
    check(
      text.startsWith(`${ids.pollTitle} – Strike District Bowling: 3 dabei · Lichtspielhaus Nord: 1 dabei · Grillen bei Bob: noch niemand dabei. Aus der Crew haben alle abgestimmt. Läuft bis `),
      `P38: Zwischenstand mit Zusagen je Vorschlag, die meisten zuerst („${text}“)`,
    );
    check(/ (Stimm mit einem Tipp ab|Zur Abstimmung):$/.test(text), "P38: Zwischenstand endet mit dem Hinweis auf den Link");
    check(standing?.url === ids.pollShareUrl, `P38: Zwischenstand teilt denselben Abstimm-Link wie „Abstimmung teilen“ (${standing?.url})`);
    // „Grillen bei Bob“ ist ein Vorschlag, kein Name – darüber hinaus keine Namen oder Adressen.
    check(!/Alice|Carol|@/.test(JSON.stringify(standing ?? {}).replaceAll("Grillen bei Bob", "")), "P38: keine Namen oder E-Mail-Adressen im Zwischenstand");
    // Rückfall ohne Teilen-Menü: Text und Link landen in der Zwischenablage.
    await unstubShare(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(APP).origin }).catch(() => {});
    await page.getByRole("button", { name: "Zwischenstand teilen" }).click();
    await toast(bob, "Text und Link kopiert");
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (clip !== null) check(clip.startsWith(`${ids.pollTitle} – `) && clip.trim().endsWith(ids.pollShareUrl), "P38: Zwischenablage enthält Zwischenstand und Link");
    else check(true, "P38: Zwischenstand ohne Web Share API kopiert (Zwischenablage nicht lesbar)");
    // Rechte für die Zwischenablage wieder zurücknehmen – sonst gelten für Bob später andere (P13 Standort).
    await context.clearPermissions();
  }

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
    // V2 Etappe 3e: Kopf im neuen Stil – Frist als Lime-Pille, Frage als Chrom-Plakat, Aurora dahinter.
    check(/^Endet \S/.test((await guest.page.getByTestId("shared-poll-ends").innerText()).trim()), "V2: Frist als Pille („Endet in …“)");
    check(await card.locator("#shared-poll-title.chrome").isVisible(), "V2: Frage als Chrom-Plakat");
    check((await guest.page.locator(".aurora").count()) === 1, "V2: Aurora hinter der geteilten Abstimmung");
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
    // W11 Etappe 2: Nach dem Beitritt geht es direkt zur Abstimmung, dort wartet die Übernahme der Gast-Stimme.
    await hanna.page.waitForURL(new RegExp(`/polls/${poll.json}$`));
    check(true, "Hanna ist mit dem Link aus dem Stimmzettel in der Crew und landet direkt bei der Abstimmung");
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
  // V2 Etappe 3d: Ergebnis als Karte ganz in Lime, sobald es einen Gewinner gibt.
  check((await page.locator('.result-card[data-answer="yes"]').filter({ hasText: "Es wird Strike District Bowling" }).count()) === 1, "Ergebnis: Karte in Lime mit Gewinner");
  check((await page.getByTestId("poll-standing").count()) === 0, "P38: nach dem Ende kein „Zwischenstand teilen“ mehr");
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
  // Gezielt das Ticket des Plans: Zwischen 16 und 23 Uhr zeigt Home auch „Heute Abend“ mit Orten (D3 2b),
  // darunter womöglich derselbe Ort als Link zu Discover.
  await bob.page.locator(`main a[href$="/plans/${ids.plan}"]`).filter({ hasText: /Strike District Bowling/ }).first().click();
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
  // V2 Etappe 3c: „Bist du dabei?“ ist eine Karte in der Farbe der eigenen Antwort, die Antworten sind Pillen.
  await bob.page.locator('.answer-card[data-answer="yes"]').waitFor();
  check((await bob.page.locator(".answer-card .vote-pill[aria-checked=true]").innerText()) === "Bin dabei", "Zusage: Antwort-Karte grün, „Bin dabei“ als gewählte Pille");
  check((await bob.page.locator(".plan-facts").count()) === 1, "Was/Wann/Wo stehen auf einer Karte");
  await shot(bob, "16-plan");
  await carol.page.goto(`${APP}/plans/${ids.plan}`);
  await carol.page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  check((await answerOf(carol)) === "invited" && (await carol.page.locator(".ticket-feature .ticket-stamp").count()) === 0, "Ohne Antwort: graues Ticket mit Strichcode statt Stempel");
  check((await carol.page.locator(".answer-card.answer-open:not([data-answer])").count()) === 1, "Ohne Antwort: Antwort-Karte aus Glas mit Lime-Rand");
  await shot(carol, "16f-plan-ohne-antwort");
  await carol.page.getByRole("radiogroup", { name: "Bist du dabei?" }).getByRole("radio", { name: "Vielleicht" }).click();
  await carol.page.locator('.ticket-feature-wrap[data-answer="maybe"]').waitFor();
  await carol.page.locator('.answer-card[data-answer="maybe"]').waitFor();
  check((await carol.page.locator(".ticket-feature .ticket-stamp").innerText()).toLowerCase() === "vielleicht", "Vielleicht: gelbes Ticket mit Stempel");
  await toast(carol, "Antwort gespeichert.");
  await shot(carol, "16b-plan-vielleicht");
  await carol.page.getByRole("radiogroup", { name: "Bist du dabei?" }).getByRole("radio", { name: "Kann nicht" }).click();
  await carol.page.locator('.ticket-feature-wrap[data-answer="declined"]').waitFor();
  await carol.page.locator('.answer-card[data-answer="no"]').waitFor();
  check((await carol.page.locator(".ticket-feature .ticket-stamp").innerText()).toLowerCase() === "abgesagt", "Absage: rotes Ticket mit Stempel „Abgesagt“");
  await shot(carol, "16-plan");
  await alice.page.reload();
  await alice.page.getByText("Dabei (2)").waitFor();
  await alice.page.getByText("Abgesagt (1)").waitFor();
  check(true, "Organisatorin sieht Zu- und Absagen");
  check((await alice.page.locator('.who-chip[data-status="going"]').count()) === 2 && (await alice.page.locator('.who-chip[data-status="declined"]').count()) === 1, "Wer kommt: Personen als Pillen in der Farbe ihrer Antwort");
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
  // V2 Etappe 3j: Kopf der Crew-Seite als Karte in der Farbwelt der Crew, Name in Chrom, Zahlen als Pillen.
  {
    const pass = bob.page.getByTestId("crew-pass");
    const world = await pass.getAttribute("data-world");
    check(["violet", "pink", "lime", "amber"].includes(world ?? ""), `Crew-Kopf trägt die Farbwelt der Crew (${world})`);
    check((await pass.evaluate((el) => getComputedStyle(el).backgroundImage)).includes("radial-gradient"), "Crew-Kopf leuchtet in seiner Farbwelt");
    const h1 = pass.getByRole("heading", { level: 1 });
    check((await h1.innerText()).trim().toLowerCase() === "weekend crew" && (await h1.getAttribute("class"))?.includes("chrome"), "Crew-Name in Chrom, ohne Symbol in der Überschrift");
    check((await pass.getByTestId("crew-pass-members").innerText()).includes("3 Mitglieder"), "Mitgliederzahl als Glas-Pille");
    check((await pass.getByTestId("crew-pass-role").innerText()).trim() === "Du bist Mitglied", "eigene Rolle als Glas-Pille");
    check((await pass.getByRole("link", { name: "Abstimmung starten" }).count()) === 1 && (await pass.getByRole("button", { name: "Einladen" }).count()) === 0, "Aktionen im Kopf, Einladen nur für Owner/Admins");
    const box = await pass.boundingBox();
    const vw = bob.page.viewportSize()?.width ?? 0;
    check(!!box && box.x >= 0 && box.x + box.width <= vw + 1, `Crew-Kopf passt in die Breite (${vw} px)`);
    const clipped = await pass.locator("a, button").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent?.trim()));
    check(clipped.length === 0, `Knöpfe im Crew-Kopf schneiden nichts ab (${clipped.join(", ") || "keiner"})`);
  }
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

  // P6 Etappe 3: kleiner Stadtplan auf der Planseite – erst nach Tipp (gleiche Einwilligung wie in Discover).
  const TILES = /^https:\/\/tile\.openstreetmap\.org\//;
  const spotTiles = [];
  await page.route(TILES, (route) => {
    spotTiles.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  const offer = page.getByTestId("spot-map-offer");
  await offer.waitFor();
  check(spotTiles.length === 0, "Planseite: ohne Einwilligung keine Anfrage an den Kachelserver");
  check(await offer.getByText(/Beim Laden gehen deine IP-Adresse und der Kartenausschnitt dorthin/).isVisible(), "Planseite: Hinweis, was beim Laden übertragen wird");
  await offer.getByRole("button", { name: "Auf dem Stadtplan zeigen" }).click();
  const spot = page.getByTestId("spot-map");
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('[data-testid="spot-map"] img[data-map-tile]')];
    return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
  });
  check(spotTiles.length > 0 && spotTiles.length <= 12 && spotTiles.every((u) => /^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/.test(u)), `Planseite: nur der Ausschnitt um den Ort, Zoom 16 (${spotTiles.length} Kacheln)`);
  check(await spot.getByRole("group", { name: "Stadtplan: Strike District Bowling in der Mitte" }).isVisible(), "Planseite: Stadtplan nennt den Ort");
  check(await spot.getByText("Demo-Ort: Die Position auf der Karte ist ein Beispiel.").isVisible(), "Planseite: Demo-Ort als Beispiel gekennzeichnet");
  check((await spot.getByRole("link", { name: "© OpenStreetMap-Mitwirkende" }).getAttribute("href")) === "https://www.openstreetmap.org/copyright", "Planseite: Namensnennung");
  await spot.getByRole("button", { name: "Näher heran" }).click();
  check((await spot.getByRole("group").getAttribute("data-zoom")) === "17", "Planseite: „Näher heran“ zoomt eine Stufe");
  await spot.scrollIntoViewIfNeeded();
  await shot(carol, "16f-plan-stadtplan");
  await spot.getByRole("button", { name: "Stadtplan aus" }).click();
  await offer.waitFor();
  check((await page.evaluate(() => localStorage.getItem("afterhours.map.tiles"))) === null, "Planseite: „Stadtplan aus“ nimmt die Einwilligung zurück");
  await page.unroute(TILES);

  // P41: „Wie komm ich hin?“ – Route in der Karten-App, erst aufklappen, nichts geht vorab hinaus.
  const MAPS = /^https:\/\/(maps\.apple\.com|www\.google\.com|www\.openstreetmap\.org)\//;
  const mapsRequests = [];
  await page.route(MAPS, (route) => {
    mapsRequests.push(route.request().url());
    return route.abort();
  });
  const directions = page.getByTestId("directions");
  const routeButton = directions.getByRole("button", { name: "Wie komm ich hin?" });
  await routeButton.waitFor();
  check((await routeButton.getAttribute("aria-expanded")) === "false", "P41: Route-Auswahl ist zugeklappt");
  check((await directions.getByRole("link").count()) === 0, "P41: zugeklappt keine Links");
  await routeButton.click();
  const routeLinks = directions.getByRole("list", { name: "Route öffnen in" }).getByRole("link");
  await routeLinks.first().waitFor();
  const apps = await routeLinks.evaluateAll((els) => els.map((a) => [a.dataset.app, a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]));
  check(apps.map(([app]) => app).join(",") === "google,osm,apple", `P41: am Rechner Google Maps zuerst, dann OpenStreetMap und Apple Karten (${apps.map(([app]) => app).join(",")})`);
  check(apps.every(([, href]) => /destination=-?\d+\.\d{5}%2C-?\d+\.\d{5}$|to=-?\d+\.\d{5}%2C-?\d+\.\d{5}$|daddr=-?\d+\.\d{5}%2C-?\d+\.\d{5}$/.test(href)), "P41: mit Ort aus Discover zählt nur der Punkt (5 Stellen)");
  check(apps.every(([, , target, rel]) => target === "_blank" && rel === "noopener noreferrer"), "P41: Links öffnen neu, ohne Verweis zurück");
  check(await directions.getByText("Erst beim Antippen geht der Ort an den Anbieter.").isVisible(), "P41: Hinweis, wann der Ort an den Anbieter geht");
  check((await routeButton.getAttribute("aria-expanded")) === "true", "P41: Knopf meldet „aufgeklappt“");
  check(mapsRequests.length === 0, "P41: keine Anfrage an Karten-Anbieter ohne Tipp");
  await directions.scrollIntoViewIfNeeded();
  await shot(carol, "16g-plan-route");
  await routeButton.click();
  check((await directions.getByRole("link").count()) === 0, "P41: zweiter Tipp klappt wieder zu");
  await page.unroute(MAPS);
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
  // W9 Etappe 2: Plan-Link als QR-Code (Tablet).
  {
    const { qrMatrix, qrPath } = await import("../../src/lib/qr.ts");
    await page.getByRole("button", { name: "Als QR-Code zeigen" }).click();
    const qr = page.getByRole("dialog", { name: "Zum Scannen" }).getByRole("img", { name: "QR-Code mit dem Link zu „Strike District Bowling“" });
    await qr.waitFor();
    check((await qr.locator("path").getAttribute("d")) === qrPath(qrMatrix(ids.shareUrl)), "W9 Etappe 2: QR-Code enthält genau den geteilten Plan-Link");
    await shot(carol, "16b-plan-qr");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Zum Scannen" }).waitFor({ state: "detached" });
  }
  // P37: „Zwischenstand teilen“ – Zahlen wie bei „Wer kommt mit?“, keine Namen, gleicher Vorschau-Link.
  {
    const main = await page.locator("main").innerText();
    const group = (label) => Number(new RegExp(`${label} \\((\\d+)\\)`).exec(main)?.[1] ?? 0);
    const [going, maybe, open] = [group("Dabei"), group("Vielleicht"), group("Noch offen")];
    await page.getByTestId("plan-standing").scrollIntoViewIfNeeded();
    await shot(carol, "16c-zwischenstand");
    await page.getByRole("button", { name: "Zwischenstand teilen" }).click();
    await page.waitForFunction(() => (window.__shared ?? []).length >= 2);
    const standing = (await sharedData(page))[1];
    const counts = [going === 0 ? "noch niemand dabei" : `${going} dabei`];
    if (maybe > 0) counts.push(`${maybe} vielleicht`);
    if (open > 0) counts.push(open === 1 ? "1 hat noch nicht geantwortet" : `${open} haben noch nicht geantwortet`);
    check(
      (standing?.text ?? "").startsWith(`Strike District Bowling, `) && (standing?.text ?? "").includes(` – ${counts.join(", ")}.`),
      `P37: Zwischenstand mit den Zahlen der Planseite (${counts.join(", ")}) – „${standing?.text}“`,
    );
    check(/ (Antwort mit einem Tipp|Zum Plan):$/.test(standing?.text ?? ""), "P37: Zwischenstand endet mit dem Hinweis auf den Link");
    check(standing?.url === ids.shareUrl, "P37: Zwischenstand teilt denselben Vorschau-Link wie „Plan teilen“");
    check(!/Alice|Bob|Carol|@/.test(JSON.stringify(standing ?? {})), "P37: keine Namen oder E-Mail-Adressen im Zwischenstand");
  }
  // Rückfall ohne Teilen-Menü: Text und Link landen in der Zwischenablage.
  await unstubShare(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(APP).origin }).catch(() => {});
  await page.getByRole("button", { name: "Plan teilen" }).click();
  await toast(carol, "Text und Link kopiert");
  check(true, "Plan teilen ohne Web Share API: Text und Link werden kopiert");
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) check(clip.startsWith("Strike District Bowling – ") && clip.trim().endsWith(ids.shareUrl), "Zwischenablage enthält Text und Link");
  // P37: auch der Zwischenstand fällt auf Kopieren zurück.
  await page.getByRole("button", { name: "Zwischenstand teilen" }).click();
  await toast(carol, "Text und Link kopiert");
  const standingClip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (standingClip !== null) check(standingClip.startsWith("Strike District Bowling, ") && standingClip.trim().endsWith(ids.shareUrl), "P37: Zwischenablage enthält Zwischenstand und Link");

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
    // V2 Etappe 3f: geteilter Plan als Karte – Titel in Chrom, Datum als Kachel, Aurora dahinter.
    check(await ticket.locator("#shared-plan-title.chrome").isVisible(), "V2: Plan-Titel als Chrom-Plakat");
    check(/^\S+\s+\d{1,2}\s+\S+$/.test((await guest.page.getByTestId("shared-plan-date").innerText()).replace(/\s+/g, " ").trim()), "V2: Datum als Kachel (Wochentag, Tag, Monat)");
    check((await guest.page.locator(".aurora").count()) === 1 && (await ticket.locator(".ticket-stub").count()) === 0, "V2: Aurora dahinter, kein Ticket-Abriss mehr");
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

await step("W10 – Zusagen ohne Konto beim geteilten Plan", async () => {
  if (!ids.shareUrl) throw new Error("kein Teilen-Link aus W8");
  const token = new URL(ids.shareUrl).pathname.split("/").pop();
  // Einfache Mitglieder sehen den Schalter nicht und können ihn auch über die API nicht umlegen.
  await bob.page.goto(`${APP}/plans/${ids.plan}`);
  await bob.page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  check((await bob.page.locator("#gaeste").count()) === 0, "W10: einfache Mitglieder sehen „Freunde ohne Konto“ nicht");
  const bobToggle = await api(bob, "POST", "rpc/set_plan_guests", { p_plan_id: ids.plan, p_allowed: true });
  check(bobToggle.status >= 400, `W10: Bob kann Zusagen ohne Konto nicht einschalten (HTTP ${bobToggle.status})`);
  const anonToggle = await api(null, "POST", "rpc/set_plan_guests", { p_plan_id: ids.plan, p_allowed: true });
  check(anonToggle.status >= 400, `W10: ohne Konto auch nicht (HTTP ${anonToggle.status})`);

  // Alice organisiert: Schalter an, Leerzustand.
  const { page } = alice;
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  const panel = page.locator("#gaeste");
  await panel.getByRole("switch", { name: /Über den Link zusagen lassen/ }).waitFor();
  check((await panel.getByRole("switch", { name: /Über den Link zusagen lassen/ }).getAttribute("aria-checked")) === "false", "W10: Zusagen ohne Konto sind standardmäßig aus");
  await panel.getByRole("switch", { name: /Über den Link zusagen lassen/ }).click();
  await toast(alice, "Freunde ohne Konto können jetzt über den Link zusagen.");
  await panel.getByText("Noch hat niemand über den Link geantwortet.").waitFor();
  check(await panel.getByTestId("plan-guests-count").filter({ hasText: "Noch keine" }).isVisible(), "W10: Leerzustand mit Pille „Noch keine“");
  await shot(alice, "16w1-plan-gaeste-an");

  // Dana hat kein Konto: Zusagekarte mit Ort und Treffpunkt, ohne Namen der Crew.
  const guest = await newUser("Dana", "mobile");
  try {
    await guest.page.goto(ids.shareUrl);
    await guest.page.getByRole("heading", { level: 1, name: "Bist du dabei?" }).waitFor();
    const where = guest.page.getByTestId("rsvp-where");
    await where.waitFor();
    check((await where.innerText()).includes("Demochaussee 220"), "W10: Gast sieht, wohin es geht");
    check((await where.innerText()).includes("U-Bahn Ausgang Nord"), "W10: Gast sieht den Treffpunkt");
    // P41: Gäste ohne Konto finden den Weg auch – über Ort und Adresse als Text.
    await where.getByRole("button", { name: "Wie komm ich hin?" }).click();
    const guestRoute = where.getByRole("list", { name: "Route öffnen in" }).getByRole("link");
    await guestRoute.first().waitFor();
    const googleHref = await where.locator('a[data-app="google"]').getAttribute("href");
    check((await guestRoute.count()) === 3 && googleHref.startsWith("https://www.google.com/maps/dir/?api=1&destination=") && googleHref.includes("Demochaussee%20220"), `P41: Gast bekommt die Route über die Adresse (${googleHref})`);
    await shot(guest, "16w1b-plan-gast-route");
    check(!/Alice|Bob|Carol/.test(await guest.page.locator("body").innerText()), "W10: keine Namen der Crew");
    // Ohne Namen geht nichts raus.
    await guest.page.getByRole("radio", { name: "Bin dabei" }).click();
    await guest.page.getByRole("button", { name: "Antwort senden" }).click();
    await guest.page.getByText("Bitte gib deinen Namen ein (mindestens 2 Zeichen).").waitFor();
    check(true, "W10: ohne Namen kein Senden");
    await guest.page.getByLabel("Dein Name").fill("Dana");
    await shot(guest, "16w2-plan-gast-zusage");
    // Fehlerzustand: Antwort des Servers wird verständlich angezeigt.
    await guest.page.route("**/rpc/guest_rsvp_shared_plan", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "plan_guests_started", details: null, hint: null }) }),
    );
    await guest.page.getByRole("button", { name: "Antwort senden" }).click();
    await guest.page.getByText("Der Plan hat schon angefangen – über den Link geht das nur vorher.").waitFor();
    check(true, "W10: Fehler beim Senden wird angezeigt");
    await guest.page.unroute("**/rpc/guest_rsvp_shared_plan");
    await guest.page.getByRole("button", { name: "Antwort senden" }).click();
    await guest.page.getByRole("heading", { level: 1, name: "Hallo Dana" }).waitFor();
    check((await guest.page.getByTestId("rsvp-card").getAttribute("data-answer")) === "yes", "W10: Karte in der Antwortfarbe (grün dabei)");
    check(await guest.page.getByTestId("rsvp-cta").isVisible(), "W10: danach der Weg zum eigenen Konto");
    // Ein Tipp ändert die Antwort.
    const changed = guest.page.waitForResponse((r) => r.url().includes("/rpc/guest_rsvp_shared_plan") && r.ok());
    await guest.page.getByRole("radio", { name: "Vielleicht" }).click();
    await changed;
    await guest.page.waitForFunction(() => document.querySelector('[data-testid="rsvp-card"]')?.getAttribute("data-answer") === "maybe");
    check(true, "W10: ein Tipp ändert die Antwort auf „Vielleicht“");
    await shot(guest, "16w3-plan-gast-eingetragen");
    // P24 Etappe 2: Dana hängt einen Zusatz an – mit einem Tipp auf einen Vorschlag zu „Vielleicht“.
    await guest.page.getByTestId("answer-note-add").click();
    await guest.page.getByTestId("answer-note-form").getByRole("button", { name: "Hängt vom Wetter ab" }).click();
    await guest.page.getByTestId("answer-note").filter({ hasText: "Hängt vom Wetter ab" }).waitFor();
    check(true, "P24: Gast speichert einen Zusatz mit einem Tipp");
    await noOverflow(guest, "Gast-Zusatz");
    await a11y(guest, "plan-gast-zusatz");
    await shot(guest, "16w3b-plan-gast-zusatz");

    // P27: Dana holt sich den Abend in den Kalender – Datei aus dem Browser, nur was die Karte zeigt.
    const calendar = guest.page.getByTestId("rsvp-calendar");
    await calendar.waitFor();
    check((await calendar.innerText()).includes("Ohne Konto"), "P27: Gast sieht „Im Kalender“ mit Hinweis, dass ohne Konto keine Nachricht kommt");
    const [guestDownload] = await Promise.all([guest.page.waitForEvent("download"), calendar.getByRole("button", { name: "In meinen Kalender" }).click()]);
    check(guestDownload.suggestedFilename() === "strike-district-bowling.ics", `P27: Kalenderdatei heißt nach dem Plan (${guestDownload.suggestedFilename()})`);
    const guestIcs = fs.readFileSync(await guestDownload.path(), "utf8");
    const guestIcsFlat = guestIcs.replace(/\r\n /g, "");
    check(guestIcs.startsWith("BEGIN:VCALENDAR\r\n") && guestIcs.endsWith("END:VCALENDAR\r\n"), "P27: gültiges iCalendar mit CRLF");
    check(guestIcsFlat.includes("\r\nSUMMARY:Strike District Bowling\r\n"), "P27: Titel des Plans");
    check(guestIcsFlat.includes("Demochaussee 220") && guestIcsFlat.includes("Treffpunkt: U-Bahn Ausgang Nord"), "P27: Ort und Treffpunkt in der Datei");
    check(guestIcsFlat.includes("\r\nSTATUS:TENTATIVE\r\n"), "P27: „Vielleicht“ steht als vorläufig im Kalender");
    check(guestIcsFlat.includes(`\r\nURL:${new URL(ids.shareUrl).origin}/s/${token}\r\n`), "P27: Link zurück zur Karte");
    check(!/Alice|Bob|Carol|ATTENDEE|ORGANIZER/.test(guestIcsFlat), "P27: keine Namen der Crew in der Datei");
    if (DB_URL) {
      const guestStart = execFileSync("psql", [DB_URL, "-tAc", `select to_char(starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') from public.plans where id = '${ids.plan}'`], { encoding: "utf8" }).trim();
      check(guestIcsFlat.includes(`\r\nDTSTART:${guestStart}\r\n`), `P27: Beginn wie in der Datenbank (${guestStart})`);
    }
    await toast(guest, "Kalenderdatei geladen – öffne sie, um den Termin einzutragen.");
    await guest.page.getByTestId("rsvp-calendar-saved").waitFor();
    check(true, "P27: danach steht da, mit welchem Stand der Termin geladen wurde");
    // Änderungshinweis: Das Gerät hat einen älteren Stand gemerkt (wie nach einem Verschieben durch die Crew).
    await guest.page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      saved.starts_at = new Date(Date.parse(saved.starts_at) - 3_600_000).toISOString();
      localStorage.setItem(key, JSON.stringify(saved));
    }, `afterhours.planguest.ics.${token}`);
    await guest.page.reload();
    const calendarChanged = guest.page.getByTestId("rsvp-calendar-changed");
    await calendarChanged.waitFor();
    check((await calendarChanged.innerText()).includes("Uhrzeit"), "P27: Karte sagt, dass sich die Uhrzeit seit dem Kalendereintrag geändert hat");
    await calendarChanged.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await noOverflow(guest, "Gast-Kalender geändert");
    await a11y(guest, "plan-gast-kalender");
    await shot(guest, "16w3c-plan-gast-kalender-geaendert");
    const [guestUpdate] = await Promise.all([guest.page.waitForEvent("download"), guest.page.getByRole("button", { name: "Kalender aktualisieren" }).click()]);
    check(fs.readFileSync(await guestUpdate.path(), "utf8").includes("UID:guest-"), "P27: neue Datei mit derselben UID ersetzt den alten Termin");
    await guest.page.getByTestId("rsvp-calendar-saved").waitFor();
    check((await calendarChanged.count()) === 0, "P27: nach dem neuen Download kein Änderungshinweis mehr");

    // Die Crew sieht Dana bei „Wer“, Alice bekommt Bescheid.
    await page.reload();
    await page.getByTestId("who-guest").filter({ hasText: "Dana (Gast)" }).waitFor();
    check((await page.getByTestId("who-guest").getAttribute("data-status")) === "maybe", "W10: Dana steht bei „Vielleicht“, gekennzeichnet als Gast");
    check((await page.getByTestId("who-guest").innerText()).includes("„Hängt vom Wetter ab“"), "P24: die Crew sieht den Zusatz des Gasts");
    // Die Gästeliste ist ein eigener Chunk und lädt ihre Texte nach – erst warten, dann prüfen.
    await panel.getByTestId("plan-guest").filter({ hasText: "Dana (Gast)" }).waitFor();
    check(true, "W10: Dana in der Gästeliste");
    const notes = await api(alice, "GET", "notifications?type=eq.plan_attendance&select=payload,actor_id");
    check(Array.isArray(notes.json) && notes.json.some((n) => n.payload?.guest === "Dana" && n.actor_id === null), "W10: Alice bekommt Bescheid über Danas Antwort");
    await shot(alice, "16w4-plan-gast-in-der-crew");
    const anonRead = await api(null, "GET", "plan_guests?select=display_name");
    check(!(Array.isArray(anonRead.json) && anonRead.json.length > 0), "W10: ohne Konto liest niemand die Gäste über die API");
    const bobAsGuest = await api(bob, "POST", "rpc/guest_rsvp_shared_plan", { p_token: token, p_secret: "b".repeat(64), p_name: "Bob", p_status: "going" });
    check(bobAsGuest.status >= 400 && bobAsGuest.json?.message === "plan_guest_member", "W10: Mitglieder sagen nicht als Gast zu");

    // Zurückziehen, dann mit dem gemerkten Namen ein Tipp.
    await guest.page.getByTestId("rsvp-withdraw").click();
    await guest.page.getByText("Deine Antwort ist zurückgezogen.").waitFor();
    await guest.page.getByRole("heading", { level: 1, name: "Bist du dabei?" }).waitFor();
    await guest.page.getByTestId("rsvp-one-tap").waitFor();
    const declined = guest.page.waitForResponse((r) => r.url().includes("/rpc/guest_rsvp_shared_plan") && r.ok());
    await guest.page.getByRole("radio", { name: "Kann nicht" }).click();
    await declined;
    await guest.page.getByRole("heading", { level: 1, name: "Hallo Dana" }).waitFor();
    check(true, "W10: zurückziehen und mit gemerktem Namen per Tipp absagen");
    check((await guest.page.getByTestId("rsvp-calendar").count()) === 0, "P27: nach „Kann nicht“ kein Kalender-Angebot");

    // Alice entfernt Dana und schaltet aus – der Link zeigt wieder nur die Karte.
    await page.reload();
    await panel.getByRole("button", { name: "Dana entfernen" }).click();
    await dialog(alice).getByRole("button", { name: "Entfernen" }).click();
    await toast(alice, "Gast entfernt.");
    await panel.getByRole("switch", { name: /Über den Link zusagen lassen/ }).click();
    await toast(alice, "Zusagen über den Link sind aus.");
    check((await page.getByTestId("who-guest").count()) === 0, "W10: entfernte Gäste stehen nicht mehr bei „Wer“");
    await guest.page.reload();
    await guest.page.getByRole("heading", { level: 1, name: "Bist du dabei?" }).waitFor();
    check((await guest.page.getByTestId("rsvp-card").count()) === 0 && (await guest.page.getByRole("link", { name: "Konto erstellen" }).isVisible()), "W10: ausgeschaltet zeigt der Link nur noch die Karte");
  } finally {
    users.splice(users.indexOf(guest), 1);
    await guest.context.close();
  }
});

await step("W10 Etappe 2 + W11 – Gast tritt vom Plan-Link aus bei und übernimmt die Zusage", async () => {
  if (!ANON) {
    console.log("   (übersprungen: SUPABASE_ANON_KEY fehlt)");
    return;
  }
  // Eigene kleine Crew, damit der Rest der Journey (Weekend Crew, Zusagen beim Bowling) unberührt bleibt.
  const ida = await newUser("Ida", "desktop");
  const jonas = await newUser("Jonas", "mobile");
  try {
    await register(ida);
    await onboard(ida);
    const crew = await api(ida, "POST", "rpc/create_crew", { p_name: "Tresen Crew", p_emoji: "🍺" });
    check(crew.status === 200, `Ida gründet die Tresen Crew (${crew.status})`);
    const plan = await api(ida, "POST", "rpc/create_plan", {
      p_crew_id: crew.json, p_title: "Quiz im Eck", p_starts_at: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(), p_activity_id: null,
      p_address: "Eckstraße 5, Berlin", p_meeting_point: null, p_notes: null, p_cost_per_person_cents: null, p_total_cost_cents: null, p_ends_at: null, p_confirmed: true,
    });
    check(plan.status < 300, `Plan steht (${plan.status})`);
    const token = (await api(ida, "POST", "rpc/plan_share_token", { p_plan_id: plan.json })).json;

    // W11: Ida (Owner) schaltet auf der Planseite erst Zusagen über den Link, dann den Beitritt frei.
    await ida.page.goto(`${APP}/plans/${plan.json}`);
    await ida.page.getByRole("heading", { level: 1, name: "Quiz im Eck" }).waitFor();
    const guestsPanel = ida.page.locator("#gaeste");
    check((await guestsPanel.getByRole("switch", { name: /Gäste dürfen der Crew beitreten/ }).count()) === 0, "W11: Beitritt erst wählbar, wenn Gäste zusagen dürfen");
    await guestsPanel.getByRole("switch", { name: /Über den Link zusagen lassen/ }).click();
    await toast(ida, "Freunde ohne Konto können jetzt über den Link zusagen.");
    await guestsPanel.getByRole("switch", { name: /Gäste dürfen der Crew beitreten/ }).click();
    await toast(ida, "Gäste können der Crew jetzt über den Plan-Link beitreten.");
    await guestsPanel.getByRole("switch", { name: /Gäste dürfen der Crew beitreten/, checked: true }).waitFor();
    check(true, "W11: Owner schaltet den Beitritt frei");
    await guestsPanel.getByTestId("plan-guest-join").scrollIntoViewIfNeeded();
    await shot(ida, "16w4b-plan-gaeste-beitreten-schalter");

    // Jonas sagt ohne Konto zu – erst danach erscheint der Beitritt.
    await jonas.page.goto(`${APP}/s/${token}`);
    await jonas.page.getByRole("heading", { level: 1, name: "Bist du dabei?" }).waitFor();
    check((await jonas.page.getByTestId("plan-guest-join-card").count()) === 0, "W11: vor der Antwort kein Beitritt");
    await jonas.page.getByLabel("Dein Name").fill("Jonas");
    await jonas.page.getByRole("radio", { name: "Bin dabei" }).click();
    await jonas.page.getByRole("button", { name: "Antwort senden" }).click();
    await jonas.page.getByRole("heading", { level: 1, name: "Hallo Jonas" }).waitFor();
    const joinCard = jonas.page.getByRole("region", { name: "Komm in die Crew, Jonas" });
    await joinCard.waitFor();
    check((await jonas.page.getByTestId("rsvp-cta").count()) === 0, "W11: statt „Konto erstellen“ der Weg direkt in die Crew");
    check(!/Tresen Crew|Ida/.test(await jonas.page.locator("body").innerText()), "W11: die Zusagekarte verrät vor dem Beitritt weder Crew-Namen noch Mitglieder");
    await joinCard.scrollIntoViewIfNeeded();
    await shot(jonas, "16w4c-plan-gast-crew-beitreten");
    for (const viewport of ["tablet", "desktop"]) {
      await jonas.page.setViewportSize(VIEWPORTS[viewport]);
      await shot({ ...jonas, viewport }, "16w4c-plan-gast-crew-beitreten");
    }
    await jonas.page.setViewportSize(VIEWPORTS.mobile);

    // Fehlerzustand: Antwort des Servers wird verständlich angezeigt, die Karte bleibt.
    await jonas.page.route("**/rpc/guest_join_shared_plan", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "plan_guest_join_off", details: null, hint: null }) }),
    );
    await joinCard.getByRole("button", { name: "Crew beitreten" }).click();
    await joinCard.getByText("Die Crew nimmt über diesen Plan gerade keine Gäste auf.", { exact: false }).waitFor();
    check(true, "W11: Fehler beim Beitritt wird angezeigt");
    await jonas.page.unroute("**/rpc/guest_join_shared_plan");

    // Ein Tipp: persönliche Einladung, Konto anlegen, beitreten.
    await joinCard.getByRole("button", { name: "Crew beitreten" }).click();
    await jonas.page.waitForURL(/\/invite\/[0-9a-f]{64}$/);
    await jonas.page.getByText(/Tresen Crew/).first().waitFor();
    check(true, "W11: die Einladung zeigt jetzt die Crew");
    const inviteToken = jonas.page.url().split("/invite/")[1];
    await register(jonas, { here: true });
    await jonas.page.getByRole("heading", { name: "Fast drin" }).waitFor();
    await jonas.page.getByRole("button", { name: "Tresen Crew beitreten" }).click();
    // W11 Etappe 2: Nach dem Beitritt geht es direkt zum Plan, dort wartet die Übernahme.
    await jonas.page.waitForURL(new RegExp(`/plans/${plan.json}$`));
    await jonas.page.getByRole("heading", { level: 1, name: "Quiz im Eck" }).waitFor();
    check(true, "W11 Etappe 2: nach dem Beitritt direkt auf der Planseite statt auf der Crew-Seite");
    const card = jonas.page.getByRole("region", { name: "Du hast hier schon als Gast geantwortet" });
    await card.waitFor();
    check(await card.getByText("Als „Jonas“ hast du über den Link mit „Bin dabei“ geantwortet.", { exact: false }).isVisible(), "W10: Hinweis nennt Gastname und Antwort");
    await jonas.page.getByTestId("who-guest").filter({ hasText: "Jonas (Gast)" }).waitFor();
    check(true, "W10: vor der Übernahme steht Jonas noch als Gast bei „Wer“");
    await shot(jonas, "16w5-plan-gast-zusage-uebernehmen");

    // Ida (ohne Gast-Antwort auf dem Gerät) sieht den Hinweis nicht.
    await ida.page.goto(`${APP}/plans/${plan.json}`);
    await ida.page.getByRole("heading", { level: 1, name: "Quiz im Eck" }).waitFor();
    await ida.page.getByTestId("who-guest").filter({ hasText: "Jonas (Gast)" }).waitFor();
    check((await ida.page.getByRole("region", { name: "Du hast hier schon als Gast geantwortet" }).count()) === 0, "W10: ohne Gast-Antwort auf dem Gerät kein Hinweis");

    // Fehlerzustand: Antwort des Servers wird verständlich angezeigt, die Karte bleibt.
    await jonas.page.route("**/rpc/claim_plan_guest", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "plan_guest_not_found", details: null, hint: null }) }),
    );
    await card.getByRole("button", { name: "Antwort übernehmen" }).click();
    await toast(jonas, "Diese Gast-Antwort gibt es nicht mehr – vielleicht wurde sie schon übernommen oder entfernt.");
    check(await card.isVisible(), "W10: nach einem Fehler bleibt die Karte stehen");
    await jonas.page.unroute("**/rpc/claim_plan_guest");

    await card.getByRole("button", { name: "Antwort übernehmen" }).click();
    await toast(jonas, "Antwort übernommen – du stehst jetzt als du selbst bei „Wer kommt mit?“.");
    await card.waitFor({ state: "detached" });
    await jonas.page.waitForFunction(() => document.querySelectorAll('[data-testid="who-guest"]').length === 0);
    check(true, "W10: Jonas steht nicht mehr als Gast bei „Wer“");
    check((await jonas.page.getByRole("radio", { name: "Bin dabei" }).getAttribute("aria-checked")) === "true", "W10: „Bin dabei“ ist jetzt Jonas’ eigene Antwort");
    check(await jonas.page.evaluate((key) => localStorage.getItem(key) === null, `afterhours.planguest.${token}`), "W10: das Gast-Geheimnis ist vom Gerät gelöscht");
    await shot(jonas, "16w6-plan-gast-zusage-uebernommen");

    const guests = await api(ida, "GET", `plan_guests?select=id&plan_id=eq.${plan.json}`);
    check(guests.status === 200 && guests.json.length === 0, "W10: in der Datenbank gibt es keinen Gast mehr");
    // W11: Der persönliche Link gilt nur einmal; die Einladungsliste der Crew zeigt ihn nicht.
    const reuse = await api(null, "POST", "rpc/preview_public_invitation", { p_token: inviteToken });
    check(reuse.json?.status === "exhausted", `W11: der Gast-Link ist verbraucht (${reuse.json?.status})`);
    const listed = await api(ida, "GET", `crew_invitations?select=id&crew_id=eq.${crew.json}&via_plan_id=is.null`);
    const all = await api(ida, "GET", `crew_invitations?select=id,via_plan_id&crew_id=eq.${crew.json}`);
    check(listed.status === 200 && listed.json.length === 0 && all.json?.some((i) => i.via_plan_id === plan.json), "W11: Gast-Links stehen nicht in der Einladungsliste");
    const joinAsMember = await api(jonas, "POST", "rpc/guest_join_shared_plan", { p_token: token, p_secret: "a".repeat(64) });
    check(joinAsMember.status === 400 && joinAsMember.json?.message === "plan_guest_member", `W11: Mitglieder holen keinen Gast-Link (${joinAsMember.json?.message})`);
    const attack = await api(null, "POST", "rpc/claim_plan_guest", { p_plan_id: plan.json, p_secret: "a".repeat(64), p_keep: true });
    check(attack.status >= 400, `W10: ohne Konto keine Übernahme (${attack.status})`);
    const guess = await api(ida, "POST", "rpc/claim_plan_guest", { p_plan_id: plan.json, p_secret: "a".repeat(64), p_keep: true });
    check(guess.status === 400 && guess.json?.message === "plan_guest_not_found", `W10: geratenes Geheimnis findet keinen Gast (${guess.status} ${guess.json?.message})`);
  } finally {
    for (const user of [ida, jonas]) {
      users.splice(users.indexOf(user), 1);
      await user.context.close();
    }
  }
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
  // V2 Etappe 3g: Reservierung als Glas-Karte mit eigenem Schein, bestätigte Reservierung als Lime-Pille.
  check((await page.locator('section.plan-panel[data-tone="violet"]').getByRole("heading", { name: "Reservierung" }).count()) === 1, "V2: Reservierung als Glas-Karte mit Überschrift");
  check((await page.getByTestId("booking-status").getAttribute("data-tone")) === "lime", "V2: bestätigte Reservierung als Lime-Pille");
  check(!/\brounded-card\b/.test((await page.getByTestId("booking-card").getAttribute("class")) ?? ""), "V2: Reservierung als Glas-Karte statt altem Kasten");
  await page.locator("#reservierung").scrollIntoViewIfNeeded();
  await shot(alice, "17-reservierung");

  await page.getByRole("button", { name: "Fahrt anbieten" }).click();
  await dialog(alice).getByLabel("Abfahrtsort oder Treffpunkt").fill("Bahnhof Ostkreuz");
  await dialog(alice).getByLabel("Freie Plätze").fill("2");
  await dialog(alice).getByRole("button", { name: "Angebot speichern" }).click();
  await page.getByText("ab Bahnhof Ostkreuz").waitFor();
  // P36: Wer zugesagt hat und noch keinen Platz im Auto hat, sehen alle – die Fahrerin steht nicht drin.
  {
    const without = page.getByTestId("ride-without");
    await without.waitFor();
    check((await without.getByText("Bob", { exact: true }).count()) === 1, "P36: Bob steht bei „Noch ohne Platz im Auto“");
    check((await without.getByText("du", { exact: true }).count()) === 0, "P36: die Fahrerin selbst steht nicht bei „Noch ohne Platz“");
  }
  await bob.page.reload();
  await bob.page.getByRole("button", { name: "Mitfahrt anfragen" }).click();
  await bob.page.getByText("Deine Anfrage: Angefragt").waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Mitnehmen" }).click();
  await page.getByText("1 Platz frei").waitFor();
  // V2 Etappe 3g: Plätze als Punkte – einer belegt (Bob), einer frei; „frei“ als Lime-Pille.
  const dots = page.getByTestId("ride-seat-dots").locator("span");
  check((await dots.count()) === 2 && (await page.getByTestId("ride-seat-dots").locator("span.bg-pink").count()) === 1, "V2: Fahrt zeigt 2 Plätze als Punkte, einer belegt");
  check((await page.getByTestId("ride-seats").getAttribute("data-tone")) === "lime", "V2: freie Plätze als Lime-Pille");
  await page.locator("#fahrten").scrollIntoViewIfNeeded();
  await shot(alice, "17a-fahrten");
  check(!(await page.getByTestId("ride-without").getByText("Bob", { exact: true }).isVisible().catch(() => false)), "P36: Bob hat jetzt einen Platz – nicht mehr „ohne Platz“");
  await bob.page.reload();
  await bob.page.getByText("Deine Anfrage: Bestätigt").waitFor();
  check(true, "Mitfahrt: Anfrage und Bestätigung durch die Fahrerin");
  // P36: Wer mitfährt, sehen alle am Auto – Bob sieht sich selbst als „du“.
  check((await bob.page.getByTestId("ride-passengers").getAttribute("aria-label")) === "Fährt mit: du", "P36: Mitfahrende am Auto sichtbar („Fährt mit: du“)");
  await bob.page.locator("#fahrten").scrollIntoViewIfNeeded();
  await shot(bob, "17b-fahrten-mitfahrer");
  await bob.page.goto(`${APP}/notifications`);
  await bob.page.getByText("Reservierung bestätigt").waitFor();
  await bob.page.getByText("Alice nimmt dich mit").waitFor();
  check(true, "Bob wurde über Reservierung und Mitfahrt benachrichtigt");
  // V2 Etappe 3l: Benachrichtigungen als Glas-Karten, nach Tagen gruppiert, Farbschein je Bereich.
  {
    const p = bob.page;
    const cards = p.getByTestId("inbox-card");
    check((await cards.count()) >= 3, "Benachrichtigungen als Glas-Karten");
    check((await p.getByTestId("inbox-group").first().getAttribute("data-group")) === "today", "erste Gruppe ist „Heute“");
    check(await p.getByRole("heading", { name: "Heute", exact: true }).isVisible(), "Überschrift „Heute“");
    const booking = cards.filter({ hasText: "Reservierung bestätigt" }).first();
    check((await booking.getAttribute("data-area")) === "plan" && (await booking.getAttribute("data-tone")) === "lime", "Reservierung: Bereich Plan, Lime-Schein");
    check(await booking.getByText("Plan", { exact: true }).isVisible(), "Karte nennt den Bereich");
    const poll = cards.filter({ hasText: "hat eine Abstimmung gestartet" }).first();
    if ((await poll.count()) > 0) check((await poll.getAttribute("data-tone")) === "violet", "Abstimmung: violetter Schein");
    const unreadCards = await p.locator('[data-testid="inbox-card"][data-unread="true"]').count();
    const status = (await p.getByTestId("inbox-status").innerText()).trim();
    check(unreadCards > 0 ? status === (unreadCards === 1 ? "1 neu" : `${unreadCards} neu`) : status === "Alles gelesen", `Stand-Pille passt zu den ungelesenen (${status})`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Benachrichtigungen ohne seitliches Scrollen");
  }
  await shot(bob, "18-benachrichtigungen");

  await page.getByRole("button", { name: "Plan bearbeiten" }).click();
  await dialog(alice).getByLabel("Treffpunkt").fill("Vor dem Eingang");
  await dialog(alice).getByRole("button", { name: "Änderungen speichern" }).click();
  await toast(alice, "Plan aktualisiert.");
  await carol.page.goto(`${APP}/notifications`);
  await carol.page.getByText("Alice hat einen Plan geändert: Treffpunkt").waitFor();
  check(true, "Planänderung benachrichtigt die Teilnehmenden – mit dem, was sich geändert hat");
});

await step("P14 – Wer bringt was? Mitbring-Liste auf der Planseite (Alice, Bob)", async () => {
  const { page } = alice;
  await page.goto(`${APP}/plans/${ids.plan}`);
  const panel = page.locator("section#mitbringen");
  await panel.getByRole("heading", { name: "Wer bringt was?" }).waitFor();
  check((await panel.getAttribute("data-tone")) === "amber", "Mitbring-Liste als Glas-Karte mit gelbem Schein");
  check(await panel.getByText("Noch steht nichts auf der Liste.").isVisible(), "Leerzustand ohne Einträge");
  // Alice schreibt zwei Sachen auf, eine davon bringt sie selbst mit.
  const field = panel.getByLabel("Was wird gebraucht?");
  await field.fill("  Snacks   für die Bahn ");
  await panel.getByRole("button", { name: "Auf die Liste" }).click();
  await toast(alice, "Steht auf der Liste.");
  await panel.getByTestId("plan-item").filter({ hasText: "Snacks für die Bahn" }).waitFor();
  check((await field.inputValue()) === "", "Feld ist nach dem Eintragen wieder leer");
  await field.fill("Wasser");
  await panel.getByLabel("Bring ich selbst mit").check();
  await panel.getByRole("button", { name: "Auf die Liste" }).click();
  await toast(alice, "Steht auf der Liste – du bringst es mit.");
  const water = panel.getByTestId("plan-item").filter({ hasText: "Wasser" });
  await water.getByText("Du bringst es").waitFor();
  check((await water.getAttribute("data-state")) === "mine", "„Bring ich selbst mit“: Alice bringt das Wasser");
  check((await panel.getByTestId("items-progress").innerText()).trim() === "1 von 2 vergeben", "Stand: 1 von 2 vergeben");
  // Dubletten fängt schon die Oberfläche ab, ohne Anfrage an den Server.
  await field.fill("wasser");
  await panel.getByRole("button", { name: "Auf die Liste" }).click();
  await panel.getByText("Das steht schon auf der Liste.").waitFor();
  check(true, "dieselbe Sache in anderer Schreibweise wird abgewiesen");
  await field.fill("");

  // Bob sieht die Liste und übernimmt die Snacks.
  await bob.page.goto(`${APP}/plans/${ids.plan}`);
  const bobPanel = bob.page.locator("section#mitbringen");
  const snacks = bobPanel.getByTestId("plan-item").filter({ hasText: "Snacks für die Bahn" });
  check((await snacks.getAttribute("data-state")) === "open", "für Bob: Snacks noch offen");
  check(await bobPanel.getByTestId("plan-item").filter({ hasText: "Wasser" }).getByText("Alice bringt es").isVisible(), "Bob sieht, dass Alice das Wasser bringt");
  check((await bobPanel.getByTestId("plan-item").filter({ hasText: "Wasser" }).getByRole("button", { name: "Bring ich" }).count()) === 0, "was schon jemand bringt, kann Bob nicht übernehmen");
  check((await bobPanel.getByRole("button", { name: /von der Liste nehmen/ }).count()) === 0, "Bob kann Alices Einträge nicht löschen");
  await snacks.getByRole("button", { name: "Bring ich" }).click();
  await toast(bob, "Danke – du bringst es mit.");
  await snacks.getByText("Du bringst es").waitFor();
  const youFits = await snacks.getByText("Du bringst es").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  check(youFits, "„Du bringst es“ steht ungekürzt neben „Doch nicht“");
  check((await bobPanel.getByTestId("items-progress").innerText()).trim() === "Alles vergeben", "Stand: Alles vergeben");
  check((await bobPanel.getByTestId("items-progress").getAttribute("data-tone")) === "lime", "Alles vergeben als Lime-Pille");
  await bob.page.locator("#mitbringen").scrollIntoViewIfNeeded();
  await shot(bob, "17b-mitbringen");

  // Alice sieht Bobs Zusage (Realtime oder Neuladen) und räumt als Organisatorin auf.
  await page.reload();
  await panel.getByTestId("plan-item").filter({ hasText: "Snacks für die Bahn" }).getByText("Bob bringt es").waitFor();
  check(true, "Alice sieht: Bob bringt die Snacks");
  await panel.getByRole("button", { name: "„Wasser“ von der Liste nehmen" }).click();
  await toast(alice, "Von der Liste genommen.");
  await panel.getByTestId("plan-item").filter({ hasText: "Wasser" }).waitFor({ state: "detached" });
  check(true, "Organisatorin nimmt einen Eintrag von der Liste");

  // Bob überlegt es sich anders: die Snacks sind wieder offen.
  await snacks.getByRole("button", { name: "Doch nicht" }).click();
  await toast(bob, "Wieder frei – jemand anderes kann es übernehmen.");
  await snacks.getByRole("button", { name: "Bring ich" }).waitFor();
  check((await snacks.getAttribute("data-state")) === "open", "„Doch nicht“ gibt die Snacks wieder frei");
  await snacks.getByRole("button", { name: "Bring ich" }).click();
  await snacks.getByText("Du bringst es").waitFor();
  check(true, "Bob nimmt die Snacks doch mit");

  if (ANON) {
    const item = (await api(alice, "GET", `plan_items?plan_id=eq.${ids.plan}&select=id&limit=1`)).json[0]?.id;
    const steal = await api(carol, "POST", "rpc/claim_plan_item", { p_item_id: item, p_claim: false });
    check(steal.status === 400 && /plan_item_taken/.test(JSON.stringify(steal.json)), `API: Carol gibt Bobs Zusage nicht frei (${steal.status})`);
    check((await api(carol, "PATCH", `plan_items?id=eq.${item}`, { claimed_by: null })).status === 403, "API: direkte Änderung an plan_items ist verboten (403)");
  }
});

await step("P13 – Wo seid ihr? Live-Standort rund um den Plan (Alice, Bob, Carol)", async () => {
  if (!DB_URL) {
    console.log("   (E2E_DB_URL nicht gesetzt – Live-Standort wird übersprungen)");
    return;
  }
  const sql = (q) => execFileSync("psql", [DB_URL, "-Atqc", q]).toString().trim();
  const uidOf = (user) => sql(`select id from auth.users where email = '${user.email}'`);
  const startsBefore = sql(`select starts_at from public.plans where id = '${ids.plan}'`);
  const answersBefore = sql(`select user_id || '=' || attendance_status from public.plan_participants where plan_id = '${ids.plan}'`).split("\n").filter(Boolean);
  const answer = (user, status) =>
    sql(`insert into public.plan_participants (plan_id, user_id, attendance_status) values ('${ids.plan}', '${uidOf(user)}', '${status}')
         on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status`);
  try {
    // Gut 2 Stunden vor dem Fenster: nur der Hinweis, ab wann es geht.
    sql(`update public.plans set starts_at = now() + interval '3 hours' where id = '${ids.plan}'`);
    answer(alice, "going");
    answer(bob, "maybe");
    answer(carol, "declined");
    const { page } = alice;
    await page.goto(`${APP}/plans/${ids.plan}`);
    const panel = page.locator("section#live");
    await panel.getByRole("heading", { name: "Wo seid ihr?" }).waitFor();
    check((await panel.getAttribute("data-tone")) === "violet", "P13: „Wo seid ihr?“ als Glas-Karte mit violettem Schein");
    check(await panel.getByText(/^Ab .+ könnt ihr hier euren Standort teilen/).isVisible(), "P13: vor dem Fenster nur der Hinweis, ab wann");
    check((await panel.getByRole("button").count()) === 0, "P13: vor dem Fenster kein Knopf zum Teilen");

    // Eine halbe Stunde vor Beginn: Teilen geht. Alice steht am Alexanderplatz.
    sql(`update public.plans set starts_at = now() + interval '30 minutes' where id = '${ids.plan}'`);
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({ latitude: 52.52186, longitude: 13.41321, accuracy: 15 });
    await page.reload();
    await panel.getByText("Noch teilt niemand aus der Crew seinen Standort.").waitFor();
    check(true, "P13: Leerzustand, solange niemand teilt");
    check(await panel.getByText(/Nur auf rund 10 m genau, ohne Verlauf/).isVisible(), "P13: Hinweis zu Genauigkeit und wer es sieht");
    await panel.getByRole("button", { name: /^Standort teilen bis / }).click();
    await toast(alice, /^Du teilst deinen Standort bis /);
    await panel.getByTestId("live-mine").waitFor();
    check(/^Du teilst bis /.test((await panel.getByTestId("live-status").innerText()).trim()), "P13: eigene Freigabe als Lime-Pille mit Frist");
    check(await panel.getByText("Wird aktualisiert, solange diese Seite offen ist.").isVisible(), "P13: ehrlich – nur solange die Seite offen ist");
    const stored = sql(`select latitude || ',' || longitude || ',' || accuracy_m || ',' || round(extract(epoch from expires_at - now()) / 60) from public.plan_live_locations where plan_id = '${ids.plan}' and user_id = '${uidOf(alice)}'`);
    const [lat, lng, acc, minutes] = stored.split(",").map(Number);
    check(lat === 52.5219 && lng === 13.4132 && acc === 15, `P13: Position gerundet gespeichert (${stored})`);
    check(minutes >= 178 && minutes <= 180, `P13: Freigabe gilt höchstens 3 Stunden (${minutes} min)`);

    // Bob („vielleicht“) steht 300 m weiter am Fernsehturm und sieht Alice.
    await bob.page.context().grantPermissions(["geolocation"]);
    await bob.page.context().setGeolocation({ latitude: 52.52082, longitude: 13.40942, accuracy: 20 });
    await bob.page.goto(`${APP}/plans/${ids.plan}`);
    const bobPanel = bob.page.locator("section#live");
    const aliceRow = bobPanel.getByTestId("live-person").filter({ hasText: "Alice" });
    await aliceRow.waitFor();
    check(true, "P13: Bob sieht Alice in der Liste");
    await bobPanel.getByRole("button", { name: /^Standort teilen bis / }).click();
    await toast(bob, /^Du teilst deinen Standort bis /);
    await aliceRow.getByTestId("live-distance").getByText(/^\d+ m von dir$/).waitFor();
    const meters = Number((await aliceRow.getByTestId("live-distance").innerText()).match(/\d+/)[0]);
    check(meters >= 250 && meters <= 320, `P13: Entfernung zu Alice von Bob aus (${meters} m)`);
    // P13 Etappe 2a: alle, die teilen, auf dem kleinen Stadtplan – ohne Einwilligung nur auf dem Raster.
    const liveMap = bobPanel.getByTestId("live-map");
    await liveMap.waitFor();
    await liveMap.getByTestId("live-marker").nth(1).waitFor();
    check((await liveMap.getByTestId("live-marker").count()) === 2, "P13: Bob und Alice als Profilbild auf dem Stadtplan");
    check((await liveMap.locator('[data-testid="live-marker"][data-mine]').count()) === 1, "P13: die eigene Position ist hervorgehoben");
    check(await liveMap.getByRole("group", { name: /^Stadtplan: 2 Personen aus der Crew/ }).isVisible(), "P13: Stadtplan mit Zusammenfassung für Screenreader");
    check((await liveMap.locator("img[data-map-tile]").count()) === 0 && (await liveMap.getByTestId("live-map-offer").isVisible()), "P13: ohne Einwilligung keine Kacheln, nur das Angebot");
    const markerBoxes = await liveMap.getByTestId("live-marker").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })));
    const frameBox = await liveMap.getByRole("group").boundingBox();
    check(
      markerBoxes.every((m) => m.x > frameBox.x && m.x < frameBox.x + frameBox.width && m.y > frameBox.y && m.y < frameBox.y + frameBox.height),
      "P13: beide Marker liegen im Kartenausschnitt",
    );
    check(Math.hypot(markerBoxes[0].x - markerBoxes[1].x, markerBoxes[0].y - markerBoxes[1].y) >= 36, "P13: Marker verdecken sich nicht");
    const liveTiles = [];
    await bob.page.route(/^https:\/\/tile\.openstreetmap\.org\//, (route) => {
      liveTiles.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    });
    await liveMap.getByRole("button", { name: "Mit Stadtplan zeigen" }).click();
    await liveMap.locator("img[data-map-tile]").first().waitFor();
    check(liveTiles.length > 0 && liveTiles.length <= 12, `P13: Stadtplan erst nach Tipp, nur der Ausschnitt (${liveTiles.length} Kacheln)`);
    const fitZoom = Number(await liveMap.getByRole("group").getAttribute("data-zoom"));
    await liveMap.getByRole("button", { name: "Näher heran" }).click();
    check(Number(await liveMap.getByRole("group").getAttribute("data-zoom")) === fitZoom + 1, "P13: „Näher heran“ auf dem Live-Stadtplan");
    await liveMap.getByRole("button", { name: "Weiter weg" }).click();
    await bob.page.locator("#live").scrollIntoViewIfNeeded();
    await shot(bob, "17c-wo-seid-ihr");
    await liveMap.getByRole("button", { name: "Stadtplan aus" }).click();
    await liveMap.getByTestId("live-map-offer").waitFor();
    await bob.page.unroute(/^https:\/\/tile\.openstreetmap\.org\//);

    // Alice sieht Bob (Realtime oder Nachladen).
    await panel.getByTestId("live-person").filter({ hasText: "Bob" }).waitFor({ timeout: 40_000 });
    check(true, "P13: Alice sieht Bob ohne Neuladen");

    // P13 Etappe 2b: „Bin gleich da“ – Alice sagt an, wann sie da ist; Bob sieht die Uhrzeit.
    const picker = panel.getByTestId("live-arrival-picker");
    await picker.waitFor();
    check(await picker.getByText("Wann bist du da?").isVisible(), "P13 2b: „Wann bist du da?“ in der eigenen Freigabe");
    check((await picker.getByRole("button").count()) === 5, "P13 2b: fünf Antipp-Knöpfe (5 bis 45 Minuten)");
    check((await picker.getByText(/^Zu Fuß rund/).count()) === 0, "P13 2b: keine Gehzeit bei rund 6 km Luftlinie – nichts Geschätztes, wo Gehen keine Annahme ist");
    await picker.getByRole("button", { name: "in 15 Min." }).click();
    await toast(alice, /^Die Crew sieht: gegen \d\d:\d\d Uhr da\.$/);
    const myArrival = panel.getByTestId("live-arrival-mine");
    await myArrival.waitFor();
    check(/^Du bist gegen \d\d:\d\d Uhr da$/.test((await myArrival.innerText()).trim()), "P13 2b: eigene Ansage als Lime-Pille");
    const etaMinutes = Number(sql(`select round(extract(epoch from arrival_eta - now()) / 60) from public.plan_live_locations where plan_id = '${ids.plan}' and user_id = '${uidOf(alice)}'`));
    check(etaMinutes >= 14 && etaMinutes <= 15, `P13 2b: Uhrzeit vom Server, 15 Minuten ab jetzt (${etaMinutes})`);
    const aliceEta = aliceRow.getByTestId("live-arrival");
    await aliceEta.waitFor({ timeout: 40_000 });
    check(/^da gegen \d\d:\d\d Uhr$/.test((await aliceEta.innerText()).trim()), "P13 2b: Bob sieht „da gegen …“ bei Alice");
    // Bob steht am Ort (Position direkt gesetzt, damit nicht auf das nächste Senden gewartet werden muss).
    sql(`update public.plan_live_locations set latitude = 52.5158, longitude = 13.4983 where plan_id = '${ids.plan}' and user_id = '${uidOf(bob)}'`);
    const bobThere = panel.getByTestId("live-person").filter({ hasText: "Bob" }).getByTestId("live-arrival");
    await bobThere.filter({ hasText: "Ist da" }).waitFor({ timeout: 40_000 });
    check(true, "P13 2b: Alice sieht Bob als „Ist da“, sobald er am Ort steht");
    await panel.scrollIntoViewIfNeeded();
    await shot(alice, "17d-bin-gleich-da");
    if (ANON) {
      const carolEta = await api(carol, "POST", "rpc/set_plan_live_arrival", { p_plan_id: ids.plan, p_minutes: 10 });
      check(carolEta.status === 400 && /live_location_not_going/.test(JSON.stringify(carolEta.json)), `API: Carol (abgesagt) sagt keine Ankunft an (${carolEta.status})`);
      check((await api(bob, "PATCH", `plan_live_locations?plan_id=eq.${ids.plan}`, { arrival_eta: null })).status === 403, "API: Ankunft nicht direkt änderbar (403)");
      const tooLong = await api(alice, "POST", "rpc/set_plan_live_arrival", { p_plan_id: ids.plan, p_minutes: 500 });
      check(tooLong.status === 400 && /invalid_arrival/.test(JSON.stringify(tooLong.json)), `API: mehr als 2 Stunden wird abgewiesen (${tooLong.status})`);
    }
    await panel.getByRole("button", { name: "Zurücknehmen" }).click();
    await toast(alice, "Ansage zurückgenommen.");
    await picker.waitFor();
    check(sql(`select coalesce(arrival_eta::text, 'leer') from public.plan_live_locations where plan_id = '${ids.plan}' and user_id = '${uidOf(alice)}'`) === "leer", "P13 2b: „Zurücknehmen“ löscht die Ansage");

    // Carol hat abgesagt: kein Knopf, keine Positionen – auch nicht über die API.
    await carol.page.goto(`${APP}/plans/${ids.plan}`);
    await carol.page.locator("section#live").getByText(/^Nur wer dabei ist oder „vielleicht“ gesagt hat/).waitFor();
    check((await carol.page.locator("section#live").getByTestId("live-person").count()) === 0, "P13: Carol (abgesagt) sieht niemanden");
    if (ANON) {
      check(((await api(carol, "GET", `plan_live_locations?plan_id=eq.${ids.plan}&select=user_id`)).json ?? []).length === 0, "API: Carol liest keine Positionen");
      const carolShare = await api(carol, "POST", "rpc/share_plan_live_location", { p_plan_id: ids.plan, p_latitude: 52.5, p_longitude: 13.4 });
      check(carolShare.status === 400 && /live_location_not_going/.test(JSON.stringify(carolShare.json)), `API: Carol kann nicht teilen (${carolShare.status})`);
      check((await api(bob, "PATCH", `plan_live_locations?plan_id=eq.${ids.plan}`, { expires_at: "2099-01-01T00:00:00Z" })).status === 403, "API: Frist nicht direkt verlängerbar (403)");
      const anon = await api(null, "GET", `plan_live_locations?select=user_id`);
      check(anon.status >= 400 || (Array.isArray(anon.json) && anon.json.length === 0), `API: ohne Anmeldung nichts (${anon.status})`);
    }

    // Alice hört auf: ihre Position ist sofort weg, auch bei Bob.
    await panel.getByRole("button", { name: "Nicht mehr teilen" }).click();
    await toast(alice, "Du teilst deinen Standort nicht mehr.");
    await panel.getByRole("button", { name: /^Standort teilen bis / }).waitFor();
    check(sql(`select count(*) from public.plan_live_locations where plan_id = '${ids.plan}' and user_id = '${uidOf(alice)}'`) === "0", "P13: „Nicht mehr teilen“ löscht die Position");
    await aliceRow.waitFor({ state: "detached", timeout: 40_000 });
    check(true, "P13: Bob sieht Alice nicht mehr");

    // Bob sagt ab: seine Position ist weg.
    sql(`update public.plan_participants set attendance_status = 'declined' where plan_id = '${ids.plan}' and user_id = '${uidOf(bob)}'`);
    check(sql(`select count(*) from public.plan_live_locations where plan_id = '${ids.plan}'`) === "0", "P13: Absage löscht Bobs Position");
  } finally {
    sql(`update public.plans set starts_at = '${startsBefore}' where id = '${ids.plan}'`);
    // Antworten wie vorher (nur der Status; Zeilen, die es vorher nicht gab, wieder weg).
    const kept = answersBefore.map((row) => row.split("=")[0]);
    sql(`delete from public.plan_participants where plan_id = '${ids.plan}'${kept.length ? ` and user_id not in (${kept.map((id) => `'${id}'`).join(", ")})` : ""}`);
    for (const row of answersBefore) {
      const [userId, status] = row.split("=");
      sql(`update public.plan_participants set attendance_status = '${status}' where plan_id = '${ids.plan}' and user_id = '${userId}'`);
    }
    // Seiten verlassen, bevor die Freigabe im Browser endet – sonst meldet die laufende Beobachtung „nicht freigegeben“.
    for (const user of [alice, bob]) {
      await user.page.goto(`${APP}/plans/${ids.plan}`).catch(() => {});
      await user.page.context().clearPermissions();
    }
  }
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
  // P17: „Nochmal?“ – ein Tipp startet die Terminsuche für denselben Ort mit derselben Crew.
  const again = page.getByTestId("plan-again");
  await again.waitFor();
  check((await again.getByRole("heading", { name: "Nochmal?" }).count()) === 1, "P17: abgeschlossener Plan fragt „Nochmal?“");
  check((await again.innerText()).includes("War gut bei Strike District Bowling?"), "P17: Karte nennt den Ort des Abends");
  check(/^\d+ waren? dabei$/.test((await page.getByTestId("plan-again-went").innerText()).trim()), "P17: Pille zählt, wer dabei war");
  const againLink = again.getByRole("link", { name: "Nochmal hier – Termin finden" });
  const againHref = (await againLink.getAttribute("href")) ?? "";
  check(againHref.includes("kind=date") && againHref.includes(`crew=${ids.crew}`) && againHref.includes("place="), "P17: Link führt zur Terminsuche mit Crew und Ort");
  await again.scrollIntoViewIfNeeded();
  await shot(alice, "19a-nochmal");
  await againLink.click();
  await page.waitForURL(/\/polls\/new\?/);
  await page.getByTestId("poll-form-date-place-chosen").waitFor();
  check((await page.getByTestId("poll-form-date-place-chosen").innerText()).includes("Strike District Bowling"), "P17: Terminsuche hat den Ort schon eingetragen");
  // Mit nur einer Crew blendet das Formular die Auswahl aus; mit mehreren muss die Crew des Plans gewählt sein.
  const crewPicker = page.getByTestId("poll-form-crew");
  check((await crewPicker.count()) === 0 || (await crewPicker.getByRole("radio", { checked: true }).count()) === 1, "P17: Crew ist vorgewählt (oder die einzige)");
  await page.goBack();
  await again.waitFor();

  // P29: „Wie war’s?“ – wer dabei war, urteilt mit einem Tipp; die Crew sieht nur Zahlen, nie wer was gesagt hat.
  const sql = (q) => execFileSync("psql", [DB_URL, "-Atqc", q]).toString().trim();
  const uidOf = (user) => sql(`select id from auth.users where email = '${user.email}'`);
  check(sql(`select attendance_status from public.plan_participants where plan_id = '${ids.plan}' and user_id = '${uidOf(bob)}'`) === "going" &&
        sql(`select attendance_status from public.plan_participants where plan_id = '${ids.plan}' and user_id = '${uidOf(carol)}'`) === "declined",
        "P29: Ausgangslage – Bob war dabei, Carol hat abgesagt");
  const feedback = page.getByTestId("plan-feedback");
  await feedback.waitFor();
  check((await feedback.getByRole("heading", { name: "Wie war’s?" }).count()) === 1, "P29: abgeschlossener Plan fragt „Wie war’s?“");
  const verdicts = feedback.getByRole("radiogroup", { name: "Wie war der Abend?" }).getByRole("radio");
  check((await verdicts.count()) === 3 && (await feedback.getAttribute("data-answer")) === null, "P29: drei Antworten, Karte noch ohne Farbe");
  check((await page.getByTestId("plan-feedback-tally").innerText()).includes("Noch hat niemand geantwortet."), "P29: Leerzustand ohne Antworten");
  const feedbackBox = await feedback.boundingBox();
  const againBox = await again.boundingBox();
  check(Boolean(feedbackBox && againBox && feedbackBox.y < againBox.y), "P29: „Wie war’s?“ steht vor „Nochmal?“");
  await feedback.getByRole("radio", { name: "Nochmal!" }).click();
  await toast(alice, "Notiert – das klingt nach Nochmal.");
  await page.locator('[data-testid=plan-feedback][data-answer="yes"]').waitFor();
  check((await feedback.getByRole("radio", { name: "Nochmal!" }).getAttribute("aria-checked")) === "true", "P29: „Nochmal!“ gewählt, Karte grün");
  await page.getByTestId("plan-feedback-tally").getByText("1 × Nochmal").waitFor();
  check(sql(`select verdict from public.plan_feedback where plan_id = '${ids.plan}' and user_id = '${uidOf(alice)}'`) === "again", "P29: Urteil gespeichert");
  await feedback.scrollIntoViewIfNeeded();
  await shot(alice, "19b-wie-wars");

  // Bob (390 px) sagt erst „Eher nicht“, entscheidet sich um und zieht zurück – die Zahlen folgen sofort.
  {
    const bp = bob.page;
    await bp.goto(`${APP}/plans/${ids.plan}`);
    const card = bp.getByTestId("plan-feedback");
    await card.waitFor();
    check((await card.innerText()).includes("1 × Nochmal") && !(await card.innerText()).includes("Alice"), "P29: Bob sieht Alices Urteil nur als Zahl");
    await card.getByRole("radio", { name: "Eher nicht" }).click();
    await bp.locator('[data-testid=plan-feedback][data-answer="no"]').waitFor();
    await card.getByText("1 × eher nicht").waitFor();
    await card.getByRole("radio", { name: "War okay" }).click();
    await bp.locator('[data-testid=plan-feedback][data-answer="maybe"]').waitFor();
    await card.getByText("1 × okay").waitFor();
    check((await card.getByText("1 × eher nicht").count()) === 0, "P29: umentschieden – „eher nicht“ zählt nicht mehr");
    await card.scrollIntoViewIfNeeded();
    await shot(bob, "19b-wie-wars");
    await card.getByTestId("plan-feedback-undo").click();
    await toast(bob, "Antwort zurückgezogen.");
    await bp.waitForFunction(() => !document.querySelector("[data-testid=plan-feedback]")?.hasAttribute("data-answer"));
    check(sql(`select count(*) from public.plan_feedback where plan_id = '${ids.plan}' and user_id = '${uidOf(bob)}'`) === "0", "P29: zurückgezogen – Bobs Urteil ist weg");
    await card.getByRole("radio", { name: "War okay" }).click();
    await bp.locator('[data-testid=plan-feedback][data-answer="maybe"]').waitFor();
  }

  // Carol hat abgesagt: Sie sieht die Zahlen, aber keine Knöpfe; über die API scheitert sie wie Außenstehende.
  {
    const cp = carol.page;
    await cp.goto(`${APP}/plans/${ids.plan}`);
    const card = cp.getByTestId("plan-feedback");
    await card.waitFor();
    check((await card.getByRole("radio").count()) === 0, "P29: Carol (abgesagt) bekommt keine Knöpfe");
    check((await card.innerText()).includes("1 × Nochmal") && (await card.innerText()).includes("1 × okay"), "P29: Carol sieht die Zahlen der Crew");
    await shot(carol, "19b-wie-wars");
    if (ANON) {
      const carolSet = await api(carol, "POST", "rpc/set_plan_feedback", { p_plan_id: ids.plan, p_verdict: "meh" });
      check(carolSet.status === 400 && /plan_feedback_not_going/.test(JSON.stringify(carolSet.json)), `API: Carol urteilt nicht (${carolSet.status})`);
      const direct = await api(carol, "GET", `plan_feedback?plan_id=eq.${ids.plan}&select=user_id,verdict`);
      check(direct.status >= 400, `API: Urteile nicht direkt lesbar (${direct.status})`);
      const anon = await api(null, "POST", "rpc/plan_feedback_summary", { p_plan_id: ids.plan });
      check(anon.status >= 400, `API: ohne Anmeldung keine Zahlen (${anon.status})`);
    }
    // Fehlerzustand: Ist der Server nicht erreichbar, steht das dort – mit „Nochmal versuchen“.
    await cp.route("**/rest/v1/rpc/plan_feedback_summary", (route) => route.abort());
    await cp.reload();
    await cp.getByTestId("plan-feedback-error").waitFor({ timeout: 20_000 });
    check(true, "P29: Fehlerzustand statt leerer Karte");
    await cp.unroute("**/rest/v1/rpc/plan_feedback_summary");
    await cp.getByTestId("plan-feedback-error").getByRole("button", { name: "Nochmal versuchen" }).click();
    await card.waitFor();
    check(true, "P29: „Nochmal versuchen“ lädt die Karte");
  }

  // P31: „Gut heimgekommen?“ – der Abend hat vor zwei Stunden begonnen, also ist die Karte offen (bis 12 h nach dem
  // Ende). Wer dabei war, tippt „Bin zuhause“; die Crew sieht Namen mit Uhrzeit, wer fehlt, nur als Zahl.
  {
    const missingNow = () =>
      sql(`select count(*) from public.plan_participants pp where pp.plan_id = '${ids.plan}' and pp.attendance_status in ('going', 'maybe')
           and not exists (select 1 from public.plan_home_checkins h where h.plan_id = pp.plan_id and h.user_id = pp.user_id)`);
    await page.reload();
    const card = page.getByTestId("plan-home");
    await card.waitFor();
    check((await card.getByRole("heading", { name: "Gut heimgekommen?" }).count()) === 1, "P31: Plan in der Nacht fragt „Gut heimgekommen?“");
    check((await card.getAttribute("data-answer")) === null, "P31: Karte noch ohne Farbe");
    check((await card.getByTestId("plan-home-list").innerText()).includes("Noch hat sich niemand gemeldet."), "P31: Leerzustand ohne Meldungen");
    check((await card.getByTestId("plan-home-honest").innerText()).includes("Im Notfall 112"), "P31: Karte sagt ehrlich, dass sie kein Notruf ist");
    const homeBox = await card.boundingBox();
    const feedbackBox = await page.getByTestId("plan-feedback").boundingBox();
    check(Boolean(homeBox && feedbackBox && homeBox.y < feedbackBox.y), "P31: „Gut heimgekommen?“ steht vor „Wie war’s?“");
    const before = Number(missingNow());
    await card.getByTestId("plan-home-report").click();
    await toast(alice, "Gemeldet – gute Nacht!");
    await page.locator('[data-testid=plan-home][data-answer="yes"]').waitFor();
    check(sql(`select count(*) from public.plan_home_checkins where plan_id = '${ids.plan}' and user_id = '${uidOf(alice)}'`) === "1", "P31: Meldung gespeichert");
    check((await card.getByTestId("plan-home-person").first().innerText()).startsWith("Du · "), "P31: die eigene Meldung steht vorn");
    check((await card.getByTestId("plan-home-lead").innerText()).includes("zuhause seit"), "P31: Uhrzeit der eigenen Meldung");
    check(Number(missingNow()) === before - 1, "P31: eine Person weniger ohne Meldung");
    await card.scrollIntoViewIfNeeded();
    await shot(alice, "19d-heimgekommen");
  }
  // Bob (390 px) sieht Alice mit Uhrzeit, meldet sich und nimmt es zurück.
  {
    const bp = bob.page;
    await bp.goto(`${APP}/plans/${ids.plan}`);
    const card = bp.getByTestId("plan-home");
    await card.waitFor();
    await card.getByTestId("plan-home-person").first().waitFor();
    check(/^Alice · \d{2}:\d{2} Uhr$/.test((await card.getByTestId("plan-home-person").first().innerText()).trim()), "P31: Bob sieht Alice mit Uhrzeit");
    check((await card.getByTestId("plan-home-missing").innerText()).includes("noch nicht gemeldet"), "P31: wer fehlt, steht nur als Zahl da");
    await card.getByTestId("plan-home-report").click();
    await bp.locator('[data-testid=plan-home][data-answer="yes"]').waitFor();
    await card.scrollIntoViewIfNeeded();
    await noOverflow(bob, "Gut heimgekommen?");
    await shot(bob, "19d-heimgekommen");
    await card.getByTestId("plan-home-undo").click();
    await toast(bob, "Meldung zurückgenommen.");
    await bp.waitForFunction(() => !document.querySelector("[data-testid=plan-home]")?.hasAttribute("data-answer"));
    check(sql(`select count(*) from public.plan_home_checkins where plan_id = '${ids.plan}' and user_id = '${uidOf(bob)}'`) === "0", "P31: zurückgenommen – Bobs Meldung ist weg");
  }
  // P31 Etappe 2: Gegen Ende des Abends steht „Gut heimgekommen?“ auch auf Home – nur bei eigener Zusage. Bob (390 px)
  // meldet sich direkt dort, blendet die Karte aus (hält nach dem Neuladen); Carol (abgesagt) sieht auf Home nichts.
  {
    // Ohne Ende gilt Home ab zwei Stunden nach Beginn; mit Ende ab zwei Stunden davor – sicherheitshalber festlegen.
    sql(`update public.plans set ends_at = now() - interval '5 minutes' where id = '${ids.plan}' and ends_at is not null and ends_at > now()`);
    const bp = bob.page;
    await bp.goto(`${APP}/home`);
    const box = bp.getByTestId("home-plan-home");
    await box.waitFor({ timeout: 20_000 });
    const card = box.getByTestId("plan-home");
    await card.waitFor();
    check((await card.getByRole("heading", { name: "Gut heimgekommen?" }).count()) === 1, "P31 2: Home fragt nachts „Gut heimgekommen?“");
    check((await box.getByTestId("home-plan-home-link").innerText()).includes("Strike District Bowling"), "P31 2: Home sagt, um welchen Abend es geht");
    check((await box.getByTestId("home-plan-home-link").getAttribute("href"))?.endsWith(`/plans/${ids.plan}#heimgekommen`), "P31 2: Link führt zur Karte auf der Planseite");
    await card.getByTestId("plan-home-report").click();
    await toast(bob, "Gemeldet – gute Nacht!");
    await bp.locator('[data-testid=home-plan-home] [data-testid=plan-home][data-answer="yes"]').waitFor();
    check(sql(`select count(*) from public.plan_home_checkins where plan_id = '${ids.plan}' and user_id = '${uidOf(bob)}'`) === "1", "P31 2: Meldung von Home gespeichert");
    await noOverflow(bob, "Gut heimgekommen? auf Home");
    await shot(bob, "19e-heimgekommen-home");
    await box.getByTestId("home-plan-home-hide").click();
    await toast(bob, "Ausgeblendet – auf der Planseite bleibt die Karte.");
    await box.waitFor({ state: "detached" });
    await bp.reload();
    await bp.getByRole("heading", { level: 1 }).first().waitFor();
    await bp.waitForLoadState("networkidle");
    check((await bp.getByTestId("home-plan-home").count()) === 0, "P31 2: „Ausblenden“ hält nach dem Neuladen");
    // Aufräumen: Bob ist für die weiteren Schritte wieder „nicht gemeldet“.
    sql(`delete from public.plan_home_checkins where plan_id = '${ids.plan}' and user_id = '${uidOf(bob)}'`);
    // Die folgenden Schritte erwarten Bob wieder auf der Planseite.
    await bp.goto(`${APP}/plans/${ids.plan}`);
    await bp.getByTestId("plan-feedback").waitFor();
  }
  {
    const cp = carol.page;
    await cp.goto(`${APP}/home`);
    await cp.getByRole("heading", { level: 1 }).first().waitFor();
    await cp.waitForLoadState("networkidle");
    check((await cp.getByTestId("home-plan-home").count()) === 0, "P31 2: Carol (abgesagt) sieht auf Home keine Karte");
  }
  // Carol hat abgesagt: Sie sieht, wer zuhause ist, meldet aber nichts; über die API scheitert sie.
  {
    const cp = carol.page;
    await cp.goto(`${APP}/plans/${ids.plan}`);
    const card = cp.getByTestId("plan-home");
    await card.waitFor();
    check((await card.getByTestId("plan-home-report").count()) === 0, "P31: Carol (abgesagt) bekommt keinen Knopf");
    check((await card.getByTestId("plan-home-lead").innerText()).includes("schon zuhause"), "P31: Carol sieht, wer schon zuhause ist");
    await shot(carol, "19d-heimgekommen");
    if (ANON) {
      const carolSet = await api(carol, "POST", "rpc/set_plan_home", { p_plan_id: ids.plan, p_home: true });
      check(carolSet.status === 400 && /plan_home_not_going/.test(JSON.stringify(carolSet.json)), `API: Carol meldet nichts (${carolSet.status})`);
      const direct = await api(carol, "GET", `plan_home_checkins?plan_id=eq.${ids.plan}&select=user_id`);
      check(direct.status >= 400, `API: Meldungen nicht direkt lesbar (${direct.status})`);
      const anon = await api(null, "POST", "rpc/plan_home_status", { p_plan_id: ids.plan });
      check(anon.status >= 400, `API: ohne Anmeldung kein Stand (${anon.status})`);
    }
    // Fehlerzustand mit „Nochmal versuchen“.
    await cp.route("**/rest/v1/rpc/plan_home_status", (route) => route.abort());
    await cp.reload();
    await cp.getByTestId("plan-home-error").waitFor({ timeout: 20_000 });
    check(true, "P31: Fehlerzustand statt leerer Karte");
    await cp.unroute("**/rest/v1/rpc/plan_home_status");
    await cp.getByTestId("plan-home-error").getByRole("button", { name: "Nochmal versuchen" }).click();
    await card.waitFor();
    check(true, "P31: „Nochmal versuchen“ lädt die Karte");
  }

  // P29 Etappe 2: Mit nur einem „Nochmal!“ (Alice; Bob „War okay“) ist der Abend noch kein Lieblingsabend.
  {
    const cp = carol.page;
    await cp.goto(`${APP}/crews/${ids.crew}`);
    const favorites = cp.getByTestId("crew-recap").getByTestId("recap-favorites");
    await cp.locator('[data-testid=crew-recap] [data-testid=recap-favorites][data-state="empty"]').waitFor({ timeout: 20_000 });
    check(await favorites.getByText("Sagen nach einem Abend die meisten „Nochmal!“, steht er hier.").isVisible(), "P29 Etappe 2: Leerzustand der Lieblingsabende");
    check((await page.getByTestId("plan-again-favorite").count()) === 0, "P29 Etappe 2: 1 × Nochmal – noch kein Hinweis bei „Nochmal?“");
  }
  // Bob entscheidet sich um: 2 von 2 sagen „Nochmal!“ – jetzt ist es ein Lieblingsabend, „Nochmal?“ zeigt es sofort.
  {
    const bp = bob.page;
    await bp.getByTestId("plan-feedback").getByRole("radio", { name: "Nochmal!" }).click();
    await bp.locator('[data-testid=plan-feedback][data-answer="yes"]').waitFor();
    const pill = bp.getByTestId("plan-again").getByTestId("plan-again-favorite");
    await pill.waitFor();
    check((await pill.innerText()).trim() === "2 wollen nochmal", "P29 Etappe 2: „2 wollen nochmal“ auf „Nochmal?“");
    check(sql(`select count(*) from public.plan_feedback where plan_id = '${ids.plan}' and verdict = 'again'`) === "2", "P29 Etappe 2: zwei „Nochmal!“ gespeichert");
    await bp.getByTestId("plan-again").scrollIntoViewIfNeeded();
    await noOverflow(bob, "Nochmal? mit Lieblingsabend");
    await shot(bob, "19c-nochmal-lieblingsabend");
  }

  await page.goto(`${APP}/rewards`);
  await page.getByText("Plan organisiert").first().waitFor();
  check((await page.locator("section[aria-labelledby=balance-label]").innerText()).includes("40"), "Organisatorin erhält 30 + 10 Punkte");
  // V2 Etappe 3o: Punktestand als Karte – Zahl in Chrom, Stufe als Lime-Pille, Leiter mit fünf Stufen.
  check((await page.getByTestId("rewards-points").innerText()).trim() === "40", "V2: Punktestand steht groß auf der Karte");
  check((await page.getByTestId("rewards-level").getAttribute("data-tone")) === "lime", "V2: Stufe als Lime-Pille, sobald es Punkte gibt");
  const levels = page.getByTestId("rewards-levels").getByRole("listitem");
  check((await levels.count()) === 5 && (await page.locator('[data-testid=rewards-levels] li[data-reached="true"]').count()) === 1, "V2: Leiter zeigt fünf Stufen, die erste erreicht");
  // innerText folgt `uppercase` – daher ohne Groß-/Kleinschreibung vergleichen.
  check(/neu dabei/i.test(await page.locator('[data-testid=rewards-levels] li[aria-current="step"]').innerText()), "V2: eigene Stufe in der Leiter markiert");
  check((await page.getByTestId("rewards-history").locator(".bg-lime").count()) === 2, "V2: Verlauf zeigt die Punkte als Lime-Pillen");
  check((await page.locator('[data-testid=rewards-milestones] li[data-done="true"]').count()) === 2, "V2: zwei Meilensteine erreicht (erste Unternehmung, zum ersten Mal organisiert)");
  await shot(alice, "19-rewards");
  await bob.page.goto(`${APP}/rewards`);
  await bob.page.getByText("Dabei gewesen").first().waitFor();
  check((await bob.page.locator("section[aria-labelledby=balance-label]").innerText()).includes("10"), "Bob (zugesagt) erhält 10 Punkte");
  await shot(bob, "19-rewards");
  await carol.page.goto(`${APP}/rewards`);
  await carol.page.getByText("Noch keine Punkte").waitFor();
  check(true, "Carol (abgesagt) erhält keine Punkte");
  check(
    (await carol.page.getByTestId("rewards-level").getAttribute("data-tone")) === "glass" && (await carol.page.locator('[data-testid=rewards-levels] li[data-reached="true"]').count()) === 0,
    "V2: ohne Punkte bleibt die Karte ruhig (Stufe als Glas-Pille, keine Stufe erreicht)",
  );
  await shot(carol, "19-rewards");
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
  // V2 Etappe 3g: Kosten als Glas-Karte mit Lime-Schein, der Stand trägt die Farbe des eigenen Saldos.
  check((await b.locator('section#kosten.plan-panel[data-tone="lime"]').count()) === 1, "V2: Kosten teilen als Glas-Karte");
  check((await b.getByTestId("expense-balance").getAttribute("data-balance")) === "owes", "V2: Bobs Stand in Gelb (gibt noch)");
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
  check((await page.getByTestId("expense-balance").getAttribute("data-balance")) === "gets", "V2: Alices Stand in Lime (bekommt noch)");
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

await step("P10 – Fotos vom Abend: hochladen ohne Metadaten, ansehen, löschen (Alice, Bob)", async () => {
  const sql = (q) => execFileSync("psql", [DB_URL, "-Atqc", q]).toString().trim();
  const { page } = alice;
  await page.goto(`${APP}/plans/${ids.plan}`);
  const panel = page.locator("section#fotos");
  await panel.getByRole("heading", { name: "Fotos vom Abend" }).waitFor();
  check((await panel.getAttribute("data-tone")) === "pink", "Fotos als Glas-Karte mit eigenem Schein");
  await panel.getByText("Noch keine Fotos.").waitFor();
  check(await panel.getByText("Nur eure Crew sieht die Fotos.", { exact: false }).isVisible(), "Hinweis: nur die Crew, Aufnahmeort fällt weg");

  // Testfoto 2400 × 1800 als JPEG mit EXIF-Block, der einen erkennbaren Standort trägt.
  const base = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 2400;
      c.height = 1800;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, 2400, 1800);
      g.addColorStop(0, "#c6ff3d");
      g.addColorStop(1, "#7b5cff");
      x.fillStyle = g;
      x.fillRect(0, 0, 2400, 1800);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    }),
    "base64",
  );
  const marker = "AFTERHOURS-GPS-52.5200N-13.4050E";
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]), Buffer.from(marker)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif]);
  const photo = Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
  check(photo.includes(marker), "Testfoto trägt einen Standort in den Metadaten");

  // Ein Foto und ein PDF: das PDF wird abgewiesen, das Foto trotzdem geteilt.
  await panel.getByTestId("photos-input").setInputFiles([
    { name: "abend.jpg", mimeType: "image/jpeg", buffer: photo },
    { name: "notiz.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
  ]);
  await toast(alice, "Foto geteilt.");
  await panel.getByTestId("plan-photo").first().waitFor();
  check(await panel.getByText("Dieses Foto lässt sich nicht hochladen. Versuch ein anderes.").isVisible(), "Nicht-Bild wird mit verständlicher Meldung abgewiesen");
  check((await panel.getByTestId("photos-count").innerText()).trim() === "1 Foto", "Zähler: 1 Foto");
  check(await panel.getByText("Du kannst noch 9 Fotos teilen.").isVisible(), "Alice sieht, wie viele Fotos sie noch teilen kann");
  const row = sql(`select width || 'x' || height || ' ' || path from public.plan_photos where plan_id = '${ids.plan}'`);
  check(row.startsWith("1600x1200 ") && row.endsWith(".webp"), `auf 1600 × 1200 verkleinert und als WebP gespeichert (${row.split(" ")[0]})`);
  const src = await panel.getByTestId("plan-photo").first().locator("img").getAttribute("src");
  const stored = Buffer.from(await (await fetch(src)).arrayBuffer());
  check(stored.subarray(0, 4).toString() === "RIFF" && stored.subarray(8, 12).toString() === "WEBP", "gespeicherte Datei ist ein WebP");
  check(!stored.includes(marker) && !stored.includes("Exif"), "Standort und EXIF sind nicht mitgekommen");
  check(stored.length < 2 * 1024 * 1024, `Datei unter 2 MB (${Math.round(stored.length / 1024)} kB)`);
  await noOverflow(alice, "Fotos vom Abend");
  await a11y(alice, "fotos");
  await panel.scrollIntoViewIfNeeded();
  await shot(alice, "17c-fotos");

  // Ohne Anmeldung kein Zugriff auf die Datei.
  const path = row.split(" ")[1];
  if (ANON) {
    const anon = await fetch(`${API}/storage/v1/object/authenticated/plan-photos/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
    check(anon.status >= 400, `ohne Anmeldung keine Datei (${anon.status})`);
  }

  // Bob sieht das Foto groß, kann es aber nicht löschen; er teilt selbst eins.
  const b = bob.page;
  await b.goto(`${APP}/plans/${ids.plan}`);
  const bobPanel = b.locator("section#fotos");
  await bobPanel.getByRole("button", { name: "Foto von Alice ansehen" }).click();
  const big = dialog(bob).getByRole("img", { name: "Foto von Alice vom Abend" });
  await big.waitFor();
  check(await big.evaluate((img) => img.decode().then(() => img.naturalWidth === 1600, () => false)), "Bob sieht das Foto in voller Größe");
  check((await dialog(bob).getByRole("button", { name: "Foto löschen" }).count()) === 0, "Bob kann Alices Foto nicht löschen");
  await noOverflow(bob, "Foto groß");
  await shot(bob, "17c-foto-gross");
  await dialog(bob).getByRole("button", { name: "Schließen" }).first().click();
  await bobPanel.getByTestId("photos-input").setInputFiles({ name: "bob.png", mimeType: "image/png", buffer: PNG });
  await toast(bob, "Foto geteilt.");
  await bobPanel.getByTestId("plan-photo").nth(1).waitFor();
  check(true, "Bob teilt ein Foto");
  await noOverflow(bob, "Fotos vom Abend");

  // Etappe 2b: Ab zwei Fotos liegt oben ein Stapel (neuestes vorn); in der Großansicht blättern.
  const stack = bobPanel.getByRole("button", { name: "Alle 2 Fotos durchblättern" });
  await stack.waitFor();
  check((await stack.locator("[data-layer]").count()) === 2, "Stapel mit beiden Fotos");
  await noOverflow(bob, "Fotostapel");
  await a11y(bob, "fotostapel");
  await stack.scrollIntoViewIfNeeded();
  await shot(bob, "17c-fotostapel");
  await stack.click();
  await dialog(bob).getByRole("img", { name: "Foto von dir vom Abend" }).waitFor();
  check((await dialog(bob).getByTestId("photo-position").innerText()).trim() === "2 / 2", "Stapel öffnet das neueste Foto (2 / 2)");
  check(await dialog(bob).getByRole("button", { name: "Nächstes Foto" }).isDisabled(), "am letzten Foto geht es nicht weiter");
  await dialog(bob).getByRole("button", { name: "Vorheriges Foto" }).click();
  await dialog(bob).getByRole("img", { name: "Foto von Alice vom Abend" }).waitFor();
  check((await dialog(bob).getByTestId("photo-position").innerText()).trim() === "1 / 2", "Pfeil blättert zum Foto davor");
  check((await dialog(bob).getByRole("button", { name: "Foto löschen" }).count()) === 0, "auch beim Blättern kein Löschen fremder Fotos");
  await b.keyboard.press("ArrowRight");
  await dialog(bob).getByRole("img", { name: "Foto von dir vom Abend" }).waitFor();
  check(true, "Pfeiltaste blättert weiter");
  check((await dialog(bob).getByRole("button", { name: "Foto löschen" }).count()) === 1, "beim eigenen Foto erscheint „Foto löschen“");
  // Wischen nach rechts = zurück.
  const view = dialog(bob).getByTestId("photo-view");
  await b.waitForTimeout(500); // Blätter-Animation abwarten, damit die Lage des Fotos feststeht
  const box = await view.boundingBox();
  if (box) {
    const y = box.y + box.height / 2;
    await b.mouse.move(box.x + box.width * 0.3, y);
    await b.mouse.down();
    await b.mouse.move(box.x + box.width * 0.3 + 60, y, { steps: 4 });
    await b.mouse.move(box.x + box.width * 0.3 + 140, y, { steps: 4 });
    await b.mouse.up();
    await dialog(bob).getByRole("img", { name: "Foto von Alice vom Abend" }).waitFor();
    check(true, "Wischen blättert zurück");
  }
  await noOverflow(bob, "Foto groß mit Blättern");
  await shot(bob, "17c-foto-blaettern");
  await dialog(bob).getByRole("button", { name: "Schließen" }).first().click();
  ids.bobPhotoPath = sql(`select path from public.plan_photos where plan_id = '${ids.plan}' and uploaded_by = (select id from auth.users where email = '${bob.email}')`);

  // Alice löscht ihr Foto: Zeile und Datei sind weg, Bobs Foto bleibt.
  await page.reload();
  await panel.getByRole("button", { name: "Foto von dir ansehen" }).click();
  await dialog(alice).getByRole("button", { name: "Foto löschen" }).click();
  await dialog(alice).getByText("Das Foto verschwindet für die ganze Crew.").waitFor();
  await dialog(alice).getByRole("button", { name: "Endgültig löschen" }).click();
  await toast(alice, "Foto gelöscht.");
  await panel.getByRole("button", { name: "Foto von dir ansehen" }).waitFor({ state: "detached" });
  check((await panel.getByTestId("plan-photo").count()) === 1, "Bobs Foto bleibt");
  check((await panel.getByTestId("photo-stack").count()) === 0, "mit nur einem Foto kein Stapel");
  check(sql(`select count(*) from storage.objects where bucket_id = 'plan-photos' and name = '${path}'`) === "0", "Alices Datei ist aus dem Speicher gelöscht");
});

await step("P10 Etappe 2a – Foto melden: weg für Carol, ausgeblendet für die Crew, Alice entscheidet (Carol, Bob, Alice)", async () => {
  const sql = (q) => execFileSync("psql", [DB_URL, "-Atqc", q]).toString().trim();
  const c = carol.page;
  await c.goto(`${APP}/plans/${ids.plan}`);
  const panel = c.locator("section#fotos");
  await panel.getByRole("button", { name: "Foto von Bob ansehen" }).click();
  await dialog(carol).getByRole("button", { name: "Melden" }).click();
  await dialog(carol).getByText("Warum soll das Foto weg?").waitFor();
  const send = dialog(carol).getByRole("button", { name: "Foto melden" });
  check(await send.isDisabled(), "ohne Grund lässt sich nicht melden");
  check(await dialog(carol).getByText("Niemand erfährt, dass du es gemeldet hast.", { exact: false }).isVisible(), "Hinweis: anonym, für dich sofort weg");
  await dialog(carol).getByRole("button", { name: "Ich bin drauf und will das nicht" }).click();
  await noOverflow(carol, "Foto melden");
  await a11y(carol, "foto-melden");
  await shot(carol, "17d-foto-melden");
  await send.click();
  await toast(carol, "Gemeldet – das Foto ist für dich weg.");
  await panel.getByRole("button", { name: "Foto von Bob ansehen" }).waitFor({ state: "detached" });
  check(true, "für Carol ist Bobs Foto sofort weg");
  check(sql(`select count(*) from public.reports where entity_type = 'plan_photo' and status = 'open'`) === "1", "Meldung gespeichert");

  // Bob sieht sein Foto mit gelber Pille und Hinweis, ohne Grund und ohne Namen.
  const b = bob.page;
  await b.goto(`${APP}/plans/${ids.plan}`);
  const bobPanel = b.locator("section#fotos");
  await bobPanel.locator('[data-testid="plan-photo"][data-flagged]').getByText("Gemeldet").waitFor();
  await bobPanel.getByRole("button", { name: "Foto von dir ansehen" }).click();
  await dialog(bob).getByText("Jemand hat dein Foto gemeldet.", { exact: false }).waitFor();
  check(!(await dialog(bob).innerText()).includes("Carol"), "Bob erfährt nicht, wer gemeldet hat");
  check(!(await dialog(bob).innerText()).includes("Ich bin drauf"), "Bob sieht den Grund nicht");
  await dialog(bob).getByRole("button", { name: "Schließen" }).first().click();

  // Alice (Organisatorin) bekommt Bescheid, sieht den Grund und zeigt das Foto wieder.
  const a = alice.page;
  await a.goto(`${APP}/notifications`);
  const card = a.getByTestId("inbox-card").filter({ hasText: /Foto bei „.+“ gemeldet/ }).first();
  await card.waitFor();
  check((await card.getAttribute("data-tone")) === "amber", "Benachrichtigung gelb: wartet auf eine Entscheidung");
  await card.getByRole("link").click();
  await a.waitForURL(/\/plans\/[0-9a-f-]{36}#fotos/);
  check(true, "Benachrichtigung führt zu „Fotos vom Abend“");
  const alicePanel = a.locator("section#fotos");
  await alicePanel.getByRole("button", { name: "Foto von Bob ansehen" }).click();
  const flag = dialog(alice).getByTestId("photo-flag");
  await flag.waitFor();
  check((await flag.innerText()).includes("„Ich bin drauf und will das nicht“"), "Alice sieht den Grund");
  check(!(await flag.innerText()).includes("Carol"), "ohne Namen der meldenden Person");
  await noOverflow(alice, "Gemeldetes Foto");
  await shot(alice, "17e-foto-gemeldet");
  await dialog(alice).getByRole("button", { name: "Wieder zeigen" }).click();
  await toast(alice, "Das Foto ist wieder für die Crew sichtbar.");
  check(sql(`select status from public.reports where entity_type = 'plan_photo'`) === "dismissed", "Meldung abgelehnt");
  await b.reload();
  await bobPanel.getByRole("button", { name: "Foto von dir ansehen" }).waitFor();
  check((await bobPanel.locator('[data-testid="plan-photo"][data-flagged]').count()) === 0, "bei Bob keine gelbe Pille mehr");
  await c.reload();
  await panel.getByRole("heading", { name: "Fotos vom Abend" }).waitFor();
  check((await panel.getByRole("button", { name: "Foto von Bob ansehen" }).count()) === 0, "für Carol bleibt das Foto weg");
});

await step("P10 Etappe 3 – Fotos aufräumen: gelöschter Plan und Fotos nach 12 Monaten verschwinden auch als Datei (Alice)", async () => {
  const sql = (q) => execFileSync("psql", [DB_URL, "-Atqc", q]).toString().trim();
  const { page } = alice;
  await page.goto(`${APP}/plans/${ids.plan}`);
  const panel = page.locator("section#fotos");
  await panel.getByRole("heading", { name: "Fotos vom Abend" }).waitFor();
  // Der Hinweis steht erst da, wenn die Fotos geladen sind (vorher Platzhalter) – also warten statt sofort prüfen.
  await panel.getByText("12 Monate nach dem Abend löscht die App die Fotos von selbst.", { exact: false }).waitFor();
  check(true, "Hinweis auf die Löschfrist bei den Fotos");

  // Zwei weitere Abende der Crew: einer vor 13 Monaten, einer von gestern (wird gleich gelöscht).
  const aliceId = sql(`select id from auth.users where email = '${alice.email}'`);
  const oldPlan = sql(`insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status)
    values ('${ids.crew}', '${aliceId}', 'Altes Bowling', now() - interval '13 months', now() - interval '13 months' + interval '3 hours', 'completed') returning id`);
  const gonePlan = sql(`insert into public.plans (crew_id, created_by, title, starts_at, status)
    values ('${ids.crew}', '${aliceId}', 'Gestern', now() - interval '1 day', 'completed') returning id`);
  const accessToken = await token(alice);
  const upload = async (planId) => {
    const reserved = await api(alice, "POST", "rpc/reserve_plan_photo", { p_plan_id: planId, p_width: 1, p_height: 1, p_type: "image/jpeg" });
    check(reserved.status === 200, `Platz für ein Foto reserviert (${reserved.status})`);
    const put = await fetch(`${API}/storage/v1/object/plan-photos/${reserved.json.path}`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${accessToken}`, "Content-Type": "image/jpeg" },
      body: PNG,
    });
    check(put.ok, `Datei hochgeladen (${put.status})`);
    check((await api(alice, "POST", "rpc/confirm_plan_photo", { p_photo_id: reserved.json.id })).status < 300, "Foto bestätigt");
    return reserved.json.path;
  };
  const oldPath = await upload(oldPlan);
  const gonePath = await upload(gonePlan);
  const files = (paths) => Number(sql(`select count(*) from storage.objects where bucket_id = 'plan-photos' and name in (${paths.map((p) => `'${p}'`).join(", ")})`));
  check(files([oldPath, gonePath]) === 2, "beide Dateien liegen im Speicher");
  const keep = sql(`select string_agg(path, ',') from public.plan_photos where plan_id = '${ids.plan}'`).split(",").filter(Boolean);
  check(keep.length > 0, `Fotos des aktuellen Abends vorhanden (${keep.length})`);

  sql(`delete from public.plans where id = '${gonePlan}'`);
  check(sql(`select count(*) from app_private.plan_photo_trash where path = '${gonePath}'`) === "1", "gelöschter Plan: Datei wartet aufs Löschen");

  // Ohne Anmeldung kein Aufräumen von außen.
  if (ANON) {
    const anon = await fetch(`${API}/functions/v1/photo-cleanup`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: "{}" });
    check(anon.status === 401 || anon.status === 403, `ohne Anmeldung kein Aufräumen (${anon.status})`);
    check(files([gonePath]) === 1, "Datei bleibt dabei liegen");
  }

  // Die App stößt beim Start an (je Gerät höchstens alle 6 Stunden); die Function löscht über die Storage-API.
  await page.evaluate(() => localStorage.removeItem("afterhours.photoCleanupAt"));
  await page.reload();
  await panel.getByRole("heading", { name: "Fotos vom Abend" }).waitFor();
  for (let i = 0; i < 40 && files([oldPath, gonePath]) > 0; i++) await page.waitForTimeout(500);
  check(files([gonePath]) === 0, "Datei des gelöschten Plans ist aus dem Speicher gelöscht");
  check(sql(`select count(*) from public.plan_photos where plan_id = '${oldPlan}'`) === "0", "Foto 13 Monate nach dem Abend verfallen");
  check(files([oldPath]) === 0, "und seine Datei gelöscht");
  check(sql(`select count(*) from app_private.plan_photo_trash`) === "0", "Warteschlange leer");
  check(files(keep) === keep.length, "Fotos des aktuellen Abends bleiben unangetastet");
  await panel.getByTestId("plan-photo").first().waitFor();
  sql(`delete from public.plans where id = '${oldPlan}'`);
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
    check((await alice.page.getByTestId("crew-pass-evenings").evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgb(200, 255, 46)", "V2: gemeinsame Abende als Lime-Pille im Crew-Kopf");
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
    // P9 Etappe 3 – „Euer Jahr“: Der Abend liegt im laufenden Jahr, also gibt es neben „Insgesamt“ das Jahr.
    // Im Dezember (und bis zum 15. Januar fürs alte Jahr) öffnet der Rückblick gleich mit dem Jahr.
    const aliceYear = alice.page.getByRole("group", { name: "Zeitraum des Rückblicks" }).getByRole("button", { name: /^\d{4}$/ });
    const recapYear = Number(await aliceYear.innerText());
    const berlinToday = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date()).map((p) => [p.type, Number(p.value)]),
    );
    const yearFirst = berlinToday.month === 12 || (berlinToday.month === 1 && berlinToday.day <= 15 && recapYear === berlinToday.year - 1);
    check(recapYear === berlinToday.year || recapYear === berlinToday.year - 1, `Rückblick: Jahr zur Auswahl (${recapYear})`);
    check((await aliceYear.getAttribute("aria-pressed")) === String(yearFirst), `Rückblick: ${yearFirst ? "im Dezember gleich „Euer Jahr“" : "standardmäßig „Insgesamt“"}`);
    if (yearFirst) await alice.page.getByRole("group", { name: "Zeitraum des Rückblicks" }).getByRole("button", { name: "Insgesamt" }).click();
    check(/^1\s*gemeinsamer Abend/.test((await recap.getByTestId("recap-evenings").innerText()).trim()), "Rückblick: 1 gemeinsamer Abend");
    check(await recap.getByText(/^seit \S+ \d{4}$/).isVisible(), "Rückblick: seit Monat und Jahr des ersten Abends");
    check((await recap.getByRole("listitem").filter({ hasText: /: 1 Abend(?!e)/ }).count()) === 1, "Rückblick: ein Monat mit einem Abend in den letzten 12 Monaten");
    check((await recap.getByText("Eure Stammorte").count()) === 0, "Rückblick: ein einzelner Abend ist noch kein Stammort");
    check((await recap.getByText("Lieblingstag").count()) === 0, "Rückblick: kein Lieblingstag bei nur einem Abend");
    // P29 Etappe 2 – „Eure Lieblingsabende“: Alice und Bob haben „Nochmal!“ gesagt (2 von 2).
    const favorite = recap.getByTestId("recap-favorite");
    await favorite.first().waitFor();
    check((await favorite.count()) === 1, "Rückblick: ein Lieblingsabend");
    const favoriteLabel = (await favorite.getAttribute("aria-label")) ?? "";
    check(/^.+, .+ – 2 × Nochmal\. Zum Abend$/.test(favoriteLabel), `Rückblick: Lieblingsabend mit Titel, Datum und Zahl („${favoriteLabel}“)`);
    check((await favorite.getAttribute("href"))?.endsWith(`/plans/${ids.plan}#nochmal`), "Rückblick: Lieblingsabend führt zu „Nochmal?“");
    check(!/Alice|Bob|Carol/.test(await recap.innerText()), "Rückblick: keine Rangliste von Personen");
    await bob.page.getByRole("tab", { name: "Übersicht" }).click();
    const bobRecap = bob.page.getByTestId("crew-recap");
    await bobRecap.scrollIntoViewIfNeeded();
    const recapView = bob.page.getByRole("group", { name: "Zeitraum des Rückblicks" });
    if (yearFirst) await recapView.getByRole("button", { name: "Insgesamt" }).click();
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

    // P9 Etappe 3 – „Euer Jahr“ (Jahr und Standard oben bei Alice geprüft).
    await recapView.getByRole("button", { name: String(recapYear) }).click();
    check((await bobRecap.getByTestId("recap-heading").innerText()).trim().toLowerCase() === `euer jahr ${recapYear}`, "Rückblick: Überschrift „Euer Jahr …“");
    check(/^1\s*gemeinsamer Abend/.test((await bobRecap.getByTestId("recap-evenings").innerText()).trim()), "Euer Jahr: 1 gemeinsamer Abend");
    check(await bobRecap.getByText(`von Januar bis Dezember ${recapYear}`).isVisible(), "Euer Jahr: Zeitraum statt „seit …“");
    check(await bobRecap.getByRole("list", { name: `${recapYear} Monat für Monat` }).isVisible(), "Euer Jahr: Monate des Jahres");
    check((await bobRecap.getByRole("listitem").filter({ hasText: new RegExp(`^Januar ${recapYear}:`) }).count()) === 1, "Euer Jahr: Balken beginnen im Januar");
    check((await bobRecap.getByRole("listitem").filter({ hasText: new RegExp(`^Dezember ${recapYear}:`) }).count()) === 1, "Euer Jahr: Balken enden im Dezember");
    await noOverflow(bob, "Euer Jahr");
    await shot(bob, "21e-crew-euer-jahr");
    const yearDownload = bob.page.waitForEvent("download");
    await bob.page.getByRole("button", { name: "Als Bild teilen" }).click();
    const yearSaved = await yearDownload;
    check(yearSaved.suggestedFilename() === `afterhours-jahr-${recapYear}.png`, `Euer Jahr: Bild mit Jahr im Dateinamen (${yearSaved.suggestedFilename()})`);
    if (SHOTS) await yearSaved.saveAs(path.join(SHOTS, "21f-euer-jahr-bild.png"));
    await recapView.getByRole("button", { name: "Insgesamt" }).click();
    check((await bobRecap.getByTestId("recap-heading").innerText()).trim().toLowerCase() === "alle eure abende", "Rückblick: zurück zu „Insgesamt“");

    // P10 Etappe 2c – Fotos im Rückblick: Bobs Foto vom abgeschlossenen Abend liegt als kleiner Stapel darunter.
    const recapPhotos = bobRecap.getByTestId("recap-photos");
    await recapPhotos.getByRole("heading", { name: "Eure Fotos" }).waitFor();
    const recapStack = recapPhotos.getByTestId("recap-photo-stack");
    await recapStack.first().waitFor();
    check((await recapStack.count()) === 1, "Rückblick: ein Abend mit Fotos als Stapel");
    const stackLabel = (await recapStack.getAttribute("aria-label")) ?? "";
    check(/^1 Foto von „.+“, .+ – ansehen$/.test(stackLabel), `Rückblick: Stapel mit Zahl, Abend und Datum („${stackLabel}“)`);
    check(await recapStack.locator("img").first().evaluate((img) => img.decode().then(() => img.naturalWidth > 0, () => false)), "Rückblick: Foto geladen (signierte Adresse)");
    await recapStack.scrollIntoViewIfNeeded();
    await noOverflow(bob, "Rückblick mit Fotos");
    await a11y(bob, "rueckblick-fotos");
    await shot(bob, "21g-rueckblick-fotos");
    // Jahresansicht: der Abend liegt im Jahr, also bleibt der Stapel.
    await recapView.getByRole("button", { name: String(recapYear) }).click();
    check((await recapPhotos.getByTestId("recap-photo-stack").count()) === 1, "Euer Jahr: Stapel des Abends im Jahr");
    await bobRecap.locator('[data-testid=recap-favorites][data-state="ready"]').waitFor();
    check((await bobRecap.getByTestId("recap-favorite").count()) === 1, "Euer Jahr: der Lieblingsabend liegt im Jahr");
    await recapView.getByRole("button", { name: "Insgesamt" }).click();

    // Carol hat Bobs Foto gemeldet (P10 Etappe 2a) – im Rückblick fehlt es für sie auch nach „Wieder zeigen“.
    // Erst der Fehlerzustand (Server antwortet nicht), dann nach „Erneut versuchen“ der leere Zustand.
    const c = carol.page;
    await c.route("**/rest/v1/rpc/crew_photo_stacks", (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "42501", message: "forbidden" }) }),
    );
    await c.route("**/rest/v1/rpc/crew_favorite_evenings", (route) => route.abort());
    await c.goto(`${APP}/crews/${ids.crew}`);
    const carolPhotos = c.getByTestId("crew-recap").getByTestId("recap-photos");
    await carolPhotos.getByText("Die Fotos lassen sich gerade nicht laden.").waitFor();
    check((await carolPhotos.getAttribute("data-state")) === "error", "Rückblick-Fotos: Fehlerzustand mit „Erneut versuchen“");
    await c.unroute("**/rest/v1/rpc/crew_photo_stacks");
    await carolPhotos.getByRole("button", { name: "Erneut versuchen" }).click();
    await carolPhotos.getByText("Teilt Fotos auf der Planseite", { exact: false }).waitFor();
    check((await carolPhotos.getByTestId("recap-photo-stack").count()) === 0, "Carol sieht das selbst gemeldete Foto nicht im Rückblick (leerer Zustand)");
    await carolPhotos.scrollIntoViewIfNeeded();
    await noOverflow(carol, "Rückblick ohne Fotos");
    await shot(carol, "21h-rueckblick-fotos-leer");

    // P29 Etappe 2: Lieblingsabende – Fehlerzustand, „Erneut versuchen“, dann der Abend; ein Tipp führt zu „Nochmal?“.
    const carolFavorites = c.getByTestId("crew-recap").getByTestId("recap-favorites");
    await carolFavorites.getByText("Die Lieblingsabende ließen sich gerade nicht laden.").waitFor({ timeout: 20_000 });
    check((await carolFavorites.getAttribute("data-state")) === "error", "Lieblingsabende: Fehlerzustand mit „Erneut versuchen“");
    await c.unroute("**/rest/v1/rpc/crew_favorite_evenings");
    await carolFavorites.getByRole("button", { name: "Erneut versuchen" }).click();
    await carolFavorites.getByTestId("recap-favorite").waitFor();
    check(!/Alice|Bob/.test(await carolFavorites.innerText()), "Lieblingsabende: nur Zahlen, keine Namen");
    await carolFavorites.scrollIntoViewIfNeeded();
    await a11y(carol, "rueckblick-lieblingsabende");
    await shot(carol, "21i-rueckblick-lieblingsabende");
    await carolFavorites.getByTestId("recap-favorite").click();
    await c.waitForURL(`**/plans/${ids.plan}#nochmal`);
    await c.getByTestId("plan-again").getByTestId("plan-again-favorite").waitFor();
    check(true, "Tipp auf den Lieblingsabend führt zu „Nochmal?“ mit „2 wollen nochmal“");

    // Tipp auf den Stapel führt zu „Fotos vom Abend“ des Plans.
    await recapStack.click();
    await bob.page.waitForURL(`**/plans/${ids.plan}#fotos`);
    await bob.page.locator("section#fotos").getByTestId("plan-photo").first().waitFor();
    await bob.page.waitForFunction(() => {
      const top = document.getElementById("fotos")?.getBoundingClientRect().top;
      return top != null && top >= -2 && top < window.innerHeight - 40;
    }, null, { timeout: 5000 });
    check(true, "Tipp auf den Stapel springt zu „Fotos vom Abend“");
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

  // P3 Etappe 3c – Alles auf einmal ausgleichen: Bob schuldet Alice bei zwei Abenden etwas und gleicht
  // beides mit einem Tipp aus. Dazwischen kommt eine Ausgabe dazu – die veraltete Summe wird abgewiesen.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const uidOf = (user) => psql(`select id from auth.users where email = '${user.email}'`);
    const [aliceId, bobId] = [uidOf(alice), uidOf(bob)];
    const kino = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status)
      values ('${ids.crew}', '${aliceId}', 'Kino im Park', now() - interval '3 days', 'completed') returning id`).split("\n")[0];
    const added = await api(alice, "POST", "rpc/add_plan_expense", { p_plan_id: kino, p_description: "Kinotickets", p_amount_cents: 2000, p_paid_by: null, p_split_with: [aliceId, bobId] });
    check(added.status === 200, `Zweiter Abend mit Kosten: Bob gibt Alice 10 € (${added.status})`);

    await bob.page.goto(`${APP}/crews/${ids.crew}`);
    const pairs = bob.page.getByTestId("crew-balances-pairs");
    await pairs.getByText("Du gibst Alice 38 €").waitFor();
    check(await pairs.getByText("2 Abende zusammengefasst").isVisible(), "Alles auf einmal: Bob gibt Alice 38 € für 2 Abende");
    await pairs.scrollIntoViewIfNeeded();
    await noOverflow(bob, "Alles auf einmal ausgleichen");
    await shot(bob, "21g-crew-alles-auf-einmal");
    const settleButton = pairs.getByRole("button", { name: /^Du gibst Alice 38\s€: alles auf einmal als erledigt markieren$/ });
    await settleButton.click();
    const dialog = bob.page.getByRole("dialog", { name: "Alles auf einmal erledigt?" });
    const confirmPair = dialog.getByRole("button", { name: "Ja, alles erledigt" });
    await confirmPair.waitFor();
    const body = await dialog.innerText();
    check(/Kino im Park\s−10\s€/.test(body) && /Strike District Bowling\s−28\s€/.test(body), "Rückfrage nennt jeden Abend mit Betrag");
    await shot(bob, "21h-alles-auf-einmal-rueckfrage");

    // Fehlerzustand: Alice trägt in der Zwischenzeit 2 € ein – die angezeigte Summe stimmt nicht mehr.
    await api(alice, "POST", "rpc/add_plan_expense", { p_plan_id: kino, p_description: "Popcorn", p_amount_cents: 200, p_paid_by: null, p_split_with: [aliceId, bobId] });
    await confirmPair.click();
    await dialog.getByText("Inzwischen hat sich bei den Beträgen etwas geändert.", { exact: false }).waitFor();
    check(psql(`select count(*) from public.plan_expenses where kind = 'settlement' and plan_id = '${kino}'`) === "0", "veraltete Summe trägt nichts ein");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await pairs.getByText("Du gibst Alice 39 €").waitFor();
    check(true, "nach dem Fehler steht die neue Summe da (39 €)");

    const settledBefore = Number(psql(`select count(*) from public.plan_expenses where kind = 'settlement' and created_by = '${bobId}' and plan_id in ('${kino}', '${ids.plan}')`));
    await pairs.getByRole("button", { name: /^Du gibst Alice 39\s€: alles auf einmal als erledigt markieren$/ }).click();
    await confirmPair.click();
    await toast(bob, "Rückzahlungen bei 2 Abenden eingetragen.");
    await bob.page.getByTestId("crew-balances").waitFor({ state: "detached" });
    check(true, "danach ist bei Bob nichts mehr offen – die Karte verschwindet");
    check(Number(psql(`select count(*) from public.plan_expenses where kind = 'settlement' and created_by = '${bobId}' and plan_id in ('${kino}', '${ids.plan}')`)) === settledBefore + 2, "je Abend eine Rückzahlung");
    await bob.page.goto(`${APP}/plans/${ids.plan}#kosten`);
    await bob.page.getByRole("heading", { name: "Kosten teilen" }).waitFor();
    check((await bob.page.getByText("Du gibst noch 28 €").count()) === 0, "auch auf der Planseite ist der Abend ausgeglichen");

    await alice.page.goto(`${APP}/notifications`);
    const note = alice.page.getByRole("link", { name: /Bob hat dir 39\s€ auf einmal zurückgegeben/ });
    await note.waitFor();
    check(await note.getByText(/2 Abende ausgeglichen/).isVisible(), "Alice bekommt eine Nachricht für beide Abende");
    check(psql(`select count(*) from public.notifications where type = 'plan_settlement' and user_id = '${aliceId}' and payload ? 'bundle'`) === "1", "genau eine Nachricht statt einer je Abend");
  }

  // P4 Etappe 2 – Erinnerung am Tag des Plans: Ein Plan, der vor zwei Tagen angelegt wurde, beginnt in
  // 40 Minuten. Bob öffnet die App – die ganze Crew bekommt genau eine Erinnerung. (Kurz vor Mitternacht
  // läge der Beginn schon morgen; dann wird der Schritt übersprungen.)
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const aliceId = psql(`select id from auth.users where email = '${alice.email}'`);
    const sameDay = psql(`select ((now() + interval '40 minutes') at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date`) === "t";
    if (!sameDay) {
      console.log("  – Erinnerung am Tag des Plans übersprungen (Beginn läge nach Mitternacht)");
    } else {
      const dayPlan = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status, created_at)
        values ('${ids.crew}', '${aliceId}', 'Tischtennis im Park', date_trunc('minute', now()) + interval '40 minutes', 'confirmed', now() - interval '2 days')
        returning id`).split("\n")[0];
      try {
        await bob.page.goto(`${APP}/notifications`);
        const reminder = bob.page.getByRole("link", { name: /Heute \d{2}:\d{2} Uhr: Tischtennis im Park/ });
        await reminder.waitFor();
        check(await reminder.getByText("Bist du dabei? Ein Tipp genügt.").isVisible(), "Erinnerung am Tag: „Heute … Uhr: Tischtennis im Park – Bist du dabei?“");
        await noOverflow(bob, "Erinnerung am Tag des Plans");
        await shot(bob, "21e-erinnerung-am-tag");
        const members = psql(`select count(*) from public.crew_members where crew_id = '${ids.crew}'`);
        check(psql(`select count(*) from public.notifications where type = 'plan_day_reminder' and related_entity_id = '${dayPlan}'`) === members, `Bobs Start erinnert die ganze Crew (${members})`);
        await bob.page.reload();
        await reminder.waitFor();
        check((await bob.page.getByRole("link", { name: /Tischtennis im Park/ }).count()) === 1, "Neuladen erinnert nicht noch einmal");
        await reminder.click();
        await bob.page.waitForURL(`**/plans/${dayPlan}`);
        await bob.page.getByRole("heading", { name: /Tischtennis im Park/ }).first().waitFor();
        check(true, "Erinnerung führt zum Plan");
        await bob.page.goto(`${APP}/settings`);
        await bob.page.getByText("Am Tag des Plans").first().waitFor();
        check(true, "Erinnerung am Tag lässt sich in den Einstellungen abschalten");
      } finally {
        psql(`delete from public.notifications where related_entity_id = '${dayPlan}'; delete from public.plans where id = '${dayPlan}'`);
      }
    }
  }

  // P15 – Endspurt: Eine Abstimmung, die seit zwei Tagen läuft, endet in zwei Stunden. Bob öffnet die App –
  // alle ohne Stimme bekommen genau eine Erinnerung, ohne dass jemand von Hand erinnert.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const aliceId = psql(`select id from auth.users where email = '${alice.email}'`);
    const closingPoll = psql(`insert into public.polls (crew_id, created_by, title, ends_at, created_at)
      values ('${ids.crew}', '${aliceId}', 'Endspurt: Tischkicker oder Darts?', date_trunc('minute', now()) + interval '2 hours', now() - interval '2 days')
      returning id`).split("\n")[0];
    psql(`insert into public.poll_options (poll_id, title, position) values ('${closingPoll}', 'Tischkicker', 0), ('${closingPoll}', 'Darts', 1)`);
    try {
      await bob.page.goto(`${APP}/notifications`);
      const reminder = bob.page.getByRole("link", { name: /Endet um \d{2}:\d{2} Uhr – deine Stimme fehlt/ });
      await reminder.waitFor();
      check(await reminder.getByText("Endspurt: Tischkicker oder Darts?").isVisible(), "Endspurt: „Endet um … Uhr – deine Stimme fehlt“ mit der Frage");
      await noOverflow(bob, "Endspurt-Erinnerung");
      await shot(bob, "21f-endspurt-abstimmung");
      const expected = psql(`select count(*) from public.crew_members m left join public.user_settings s on s.user_id = m.user_id
        where m.crew_id = '${ids.crew}' and coalesce(s.notification_preferences ->> 'poll_reminder', 'true') <> 'false'`);
      check(psql(`select count(*) from public.notifications where type = 'poll_reminder' and related_entity_id = '${closingPoll}' and actor_id is null`) === expected,
        `Bobs Start erinnert alle ohne Stimme (${expected})`);
      await bob.page.reload();
      await reminder.waitFor();
      check((await bob.page.getByRole("link", { name: /Endet um .* deine Stimme fehlt/ }).count()) === 1, "Neuladen erinnert nicht noch einmal");
      await reminder.click();
      await bob.page.waitForURL(`**/polls/${closingPoll}`);
      check(true, "Endspurt-Erinnerung führt zur Abstimmung");
      // Ohne Anmeldung lässt sich nichts anstoßen.
      if (ANON) {
        const res = await fetch(`${API}/rest/v1/rpc/send_poll_closing_reminders`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: "{}",
        });
        check(res.status === 401 || res.status === 403, `ohne Anmeldung kein Anstoßen (${res.status})`);
      }
    } finally {
      psql(`delete from public.notifications where related_entity_id = '${closingPoll}'; delete from public.polls where id = '${closingPoll}'`);
    }
  }

  // P16 – Fotos einsammeln: Der Abend war gestern (vor 10 Uhr Berliner Zeit: vorgestern), alle haben zugesagt,
  // noch niemand hat Fotos geteilt. Bob öffnet die App – alle bekommen genau einmal „Fotos von gestern?“.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const aliceId = psql(`select id from auth.users where email = '${alice.email}'`);
    const nudgePlan = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status, created_at)
      values ('${ids.crew}', '${aliceId}', 'Tischtennis-Turnier',
        ((now() at time zone 'Europe/Berlin')::date - case when (now() at time zone 'Europe/Berlin')::time >= time '10:00' then 1 else 2 end + time '20:00') at time zone 'Europe/Berlin',
        'confirmed', now() - interval '5 days')
      returning id`).split("\n")[0];
    psql(`insert into public.plan_participants (plan_id, user_id, attendance_status)
      select '${nudgePlan}', m.user_id, 'going' from public.crew_members m where m.crew_id = '${ids.crew}'`);
    try {
      await bob.page.goto(`${APP}/notifications`);
      const nudge = bob.page.getByRole("link", { name: /Fotos (von gestern|vom Abend)\? Teilt sie mit der Crew/ }).filter({ hasText: "Tischtennis-Turnier" });
      await nudge.waitFor();
      check(true, "Fotos einsammeln: „Fotos von gestern? Teilt sie mit der Crew“ mit dem Plan");
      await noOverflow(bob, "Fotos einsammeln");
      await shot(bob, "21g-fotos-einsammeln");
      const expected = psql(`select count(*) from public.crew_members m left join public.user_settings s on s.user_id = m.user_id
        where m.crew_id = '${ids.crew}' and coalesce(s.notification_preferences ->> 'plan_photo_nudge', 'true') <> 'false'`);
      check(psql(`select count(*) from public.notifications where type = 'plan_photo_nudge' and related_entity_id = '${nudgePlan}' and actor_id is null`) === expected,
        `Bobs Start erinnert alle, die zugesagt hatten (${expected})`);
      await bob.page.reload();
      await nudge.waitFor();
      check((await nudge.count()) === 1, "Neuladen erinnert nicht noch einmal");
      await nudge.click();
      await bob.page.waitForURL(`**/plans/${nudgePlan}#fotos`);
      await bob.page.getByRole("heading", { name: "Fotos vom Abend" }).first().waitFor();
      check(true, "Fotos einsammeln führt zu „Fotos vom Abend“");
      // Ohne Anmeldung lässt sich nichts anstoßen.
      if (ANON) {
        const res = await fetch(`${API}/rest/v1/rpc/send_plan_photo_nudges`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: "{}",
        });
        check(res.status === 401 || res.status === 403, `ohne Anmeldung kein Anstoßen (${res.status})`);
      }
    } finally {
      psql(`delete from public.notifications where related_entity_id = '${nudgePlan}'; delete from public.plans where id = '${nudgePlan}'`);
    }
  }

  // P29 Etappe 3 – „Wie war’s?“ am Morgen danach: Der Abend war gestern und ist abgeschlossen, alle haben zugesagt,
  // niemand hat geurteilt. Dieselbe eine Erinnerung fragt jetzt zuerst „Wie war’s?“ und führt zu `#wie-wars`; ein Tipp
  // dort speichert das Urteil. Wer schon geurteilt hat (Alice), bekommt nichts, solange Fotos fehlen – nur die Fotos.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const aliceId = psql(`select id from auth.users where email = '${alice.email}'`);
    const bobId = psql(`select id from auth.users where email = '${bob.email}'`);
    const evening = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status, completed_at, created_at)
      values ('${ids.crew}', '${aliceId}', 'Karaoke im Keller',
        ((now() at time zone 'Europe/Berlin')::date - case when (now() at time zone 'Europe/Berlin')::time >= time '10:00' then 1 else 2 end + time '20:00') at time zone 'Europe/Berlin',
        'completed', now() - interval '1 hour', now() - interval '5 days')
      returning id`).split("\n")[0];
    psql(`insert into public.plan_participants (plan_id, user_id, attendance_status)
      select '${evening}', m.user_id, 'going' from public.crew_members m where m.crew_id = '${ids.crew}'`);
    psql(`insert into public.plan_feedback (plan_id, user_id, verdict) values ('${evening}', '${aliceId}', 'again')`);
    try {
      await bob.page.goto(`${APP}/notifications`);
      const nudge = bob.page.getByRole("link", { name: /Wie war(’s gestern| der Abend)\? Sag’s mit einem Tipp/ }).filter({ hasText: "Karaoke im Keller" });
      await nudge.waitFor();
      check((await nudge.innerText()).includes("Und teilt eure Fotos mit der Crew"), "P29 Etappe 3: eine Erinnerung fragt „Wie war’s?“ und nach Fotos");
      check(psql(`select count(*) from public.notifications where related_entity_id = '${evening}' and user_id = '${bobId}'`) === "1",
        "P29 Etappe 3: genau eine Benachrichtigung, keine zweite fürs Urteil");
      check(psql(`select payload ->> 'feedback' from public.notifications where related_entity_id = '${evening}' and user_id = '${aliceId}' and type = 'plan_photo_nudge'`) === "false",
        "P29 Etappe 3: Alice hat schon geurteilt – ihre Erinnerung fragt nur nach Fotos");
      await noOverflow(bob, "Wie war’s am Morgen danach");
      await shot(bob, "21h-wie-wars-morgen");
      await nudge.click();
      await bob.page.waitForURL(`**/plans/${evening}#wie-wars`);
      const card = bob.page.getByTestId("plan-feedback");
      await card.waitFor();
      await bob.page.waitForFunction(() => {
        const r = document.getElementById("wie-wars")?.getBoundingClientRect();
        return Boolean(r && r.top >= -2 && r.top < window.innerHeight / 2);
      });
      check(true, "P29 Etappe 3: Tipp führt zu „Wie war’s?“, die Karte steht oben im Bild");
      await card.getByRole("radio", { name: "Nochmal!" }).click();
      await bob.page.locator('[data-testid=plan-feedback][data-answer="yes"]').waitFor();
      check(psql(`select verdict from public.plan_feedback where plan_id = '${evening}' and user_id = '${bobId}'`) === "again",
        "P29 Etappe 3: Urteil aus der Erinnerung gespeichert");
      await shot(bob, "21i-wie-wars-aus-erinnerung");
    } finally {
      psql(`delete from public.notifications where related_entity_id = '${evening}'; delete from public.plans where id = '${evening}'`);
    }
  }

  // P19 – Nachfragen beim Plan: Bob organisiert (390 px), alle anderen haben noch nicht geantwortet. Ein Tipp auf
  // „Nachfragen“ fragt alle ohne Antwort; Carol (einfaches Mitglied) bekommt „Bob fragt: Bist du dabei?“, sieht selbst
  // aber keinen Knopf. Ein zweiter Tipp innerhalb von 6 Stunden wird abgewiesen.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const bobId = psql(`select id from auth.users where email = '${bob.email}'`);
    const askPlan = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status)
      values ('${ids.crew}', '${bobId}', 'Minigolf am Kanal', now() + interval '3 days', 'proposed')
      returning id`).split("\n")[0];
    psql(`insert into public.plan_participants (plan_id, user_id, attendance_status)
      select '${askPlan}', m.user_id, case when m.user_id = '${bobId}' then 'going'::public.attendance_status else 'invited'::public.attendance_status end
      from public.crew_members m where m.crew_id = '${ids.crew}'`);
    const others = Number(psql(`select count(*) from public.crew_members where crew_id = '${ids.crew}' and user_id <> '${bobId}'`));
    try {
      await bob.page.goto(`${APP}/plans/${askPlan}`);
      await bob.page.getByRole("heading", { level: 1, name: "Minigolf am Kanal" }).waitFor();
      const ask = bob.page.getByTestId("plan-remind");
      await ask.waitFor();
      check((await ask.getAttribute("aria-label")) === `Nachfragen – alle ${others} ohne Antwort fragen, ob sie dabei sind`, "Nachfragen: Knopf bei „Noch offen“ mit verständlicher Beschriftung");
      await noOverflow(bob, "Nachfragen");
      await a11y(bob, "plan-nachfragen");
      // Das Bild zeigt „Wer kommt“ mit dem Knopf, nicht den Kopf der Seite.
      await ask.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(bob, "21h-plan-nachfragen");
      await ask.click();
      await toast(bob, `${others} Personen gefragt.`);
      check(psql(`select count(*) from public.notifications where type = 'plan_reminder' and related_entity_id = '${askPlan}' and actor_id = '${bobId}'`) ===
        psql(`select count(*) from public.crew_members m left join public.user_settings s on s.user_id = m.user_id
          where m.crew_id = '${ids.crew}' and m.user_id <> '${bobId}' and coalesce(s.notification_preferences ->> 'plan_reminder', 'true') <> 'false'`),
        "Nachfragen: alle ohne Antwort bekommen genau eine Benachrichtigung");
      await ask.click();
      await toast(bob, "Du hast gerade erst erinnert. Die nächste Erinnerung ist in 6 Stunden möglich.");
      check(true, "Nachfragen: zweiter Tipp innerhalb von 6 Stunden wird abgewiesen");

      // Carol: kein Knopf (nicht ihr Plan), aber die Nachfrage in den Benachrichtigungen – Antippen öffnet den Plan.
      await carol.page.goto(`${APP}/plans/${askPlan}`);
      await carol.page.getByRole("heading", { level: 1, name: "Minigolf am Kanal" }).waitFor();
      await carol.page.getByText(/Noch offen \(\d+\)/).first().waitFor();
      check((await carol.page.getByTestId("plan-remind").count()) === 0, "Nachfragen: einfache Mitglieder sehen keinen Knopf bei fremden Plänen");
      await carol.page.goto(`${APP}/notifications`);
      const asked = carol.page.getByRole("link", { name: /Bob fragt: Bist du dabei\?/ }).filter({ hasText: "Minigolf am Kanal" });
      await asked.waitFor();
      check(true, "Nachfragen: „Bob fragt: Bist du dabei?“ mit Plan und Termin");
      await shot(carol, "21i-nachfrage-benachrichtigung");
      await asked.first().click();
      await carol.page.waitForURL(`**/plans/${askPlan}`);
      await carol.page.getByRole("radiogroup", { name: "Bist du dabei?" }).waitFor();
      check(true, "Nachfrage führt zur Antwortkarte des Plans");
      // Ohne Anmeldung lässt sich nicht nachfragen.
      if (ANON) {
        const res = await fetch(`${API}/rest/v1/rpc/remind_plan`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_plan_id: askPlan }),
        });
        check(res.status === 401 || res.status === 403, `ohne Anmeldung kein Nachfragen (${res.status})`);
      }
    } finally {
      psql(`delete from public.notifications where related_entity_id = '${askPlan}'; delete from public.plans where id = '${askPlan}'`);
    }
  }

  // P23 – Neue Uhrzeit, alle neu fragen: Bob verschiebt seinen Plan (390 px), Carol hatte zugesagt. Beim Ändern der
  // Uhrzeit erscheint „Alle neu fragen“ (vorausgewählt); nach dem Speichern steht Carol wieder bei „Noch offen“, sieht
  // „Vorher: Bin dabei“ und bekommt „Neue Zeit: … – bist du noch dabei?“ statt nur „Plan geändert“.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const bobId = psql(`select id from auth.users where email = '${bob.email}'`);
    const carolId = psql(`select id from auth.users where email = '${carol.email}'`);
    const movePlan = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status)
      values ('${ids.crew}', '${bobId}', 'Tischtennis im Park', date_trunc('day', now()) + interval '4 days 19 hours', 'confirmed')
      returning id`).split("\n")[0];
    psql(`insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
      select '${movePlan}', m.user_id,
        case when m.user_id in ('${bobId}', '${carolId}') then 'going'::public.attendance_status else 'invited'::public.attendance_status end,
        case when m.user_id in ('${bobId}', '${carolId}') then now() end
      from public.crew_members m where m.crew_id = '${ids.crew}'`);
    try {
      await bob.page.goto(`${APP}/plans/${movePlan}`);
      await bob.page.getByRole("heading", { level: 1, name: "Tischtennis im Park" }).waitFor();
      await bob.page.getByRole("button", { name: "Plan bearbeiten" }).click();
      const form = dialog(bob);
      await form.getByLabel("Treffpunkt").fill("An der Platte");
      check((await form.getByTestId("plan-ask-again").count()) === 0, "Neu fragen: ohne neue Zeit kein Schalter");
      await form.getByLabel("Uhrzeit").fill("21:30");
      const askAgain = form.getByTestId("plan-ask-again");
      await askAgain.waitFor();
      check((await askAgain.getByRole("switch").getAttribute("aria-checked")) === "true", "Neu fragen: bei neuer Zeit vorausgewählt");
      check((await askAgain.innerText()).includes("1 Antwort gilt für die alte Zeit"), "Neu fragen: sagt, wie viele Antworten betroffen sind");
      await noOverflow(bob, "Neu fragen");
      await a11y(bob, "plan-neu-fragen");
      await askAgain.scrollIntoViewIfNeeded();
      await shot(bob, "21j-plan-neu-fragen");
      await form.getByRole("button", { name: "Änderungen speichern" }).click();
      await toast(bob, "Plan aktualisiert – 1 Person wird neu gefragt.");
      check(psql(`select attendance_status || '/' || previous_status from public.plan_participants where plan_id = '${movePlan}' and user_id = '${carolId}'`) === "invited/going",
        "Neu fragen: Carol ist wieder offen, vorher dabei");
      check(psql(`select attendance_status from public.plan_participants where plan_id = '${movePlan}' and user_id = '${bobId}'`) === "going",
        "Neu fragen: Bobs eigene Zusage bleibt");
      check(psql(`select count(*) from public.notifications where related_entity_id = '${movePlan}' and user_id = '${carolId}' and type = 'plan_changed'`) === "1",
        "Neu fragen: Carol bekommt genau eine Benachrichtigung");

      // P23 Etappe 2: Schon auf Home steht unter der schnellen Antwort die alte Antwort, ihre Pille gestrichelt.
      await carol.page.goto(`${APP}/home`);
      const quick = carol.page.getByRole("group", { name: "Deine Antwort zu „Tischtennis im Park“" });
      await quick.waitFor();
      const quickBox = quick.locator("xpath=..");
      const quickHint = quickBox.getByTestId("plan-quick-asked-again");
      await quickHint.waitFor();
      check((await quickHint.innerText()).trim() === "Neue Zeit – passt es dir noch? Vorher: Bin dabei", "Neu fragen: Carol sieht die alte Antwort schon auf Home");
      const previousPills = await quick.locator("button[data-previous]").allInnerTexts();
      check(previousPills.length === 1 && previousPills[0].trim() === "Bin dabei", `Neu fragen: nur die alte Antwort ist auf Home markiert (${previousPills.join(", ")})`);
      check((await quick.locator("button[data-previous]").evaluate((el) => getComputedStyle(el).borderTopStyle)) === "dashed", "Neu fragen: alte Antwort gestrichelt");
      await quickBox.scrollIntoViewIfNeeded();
      await noOverflow(carol, "Neu gefragt auf Home");
      await a11y(carol, "home-neu-gefragt");
      await shot(carol, "21k-home-neu-gefragt");

      await carol.page.goto(`${APP}/plans/${movePlan}`);
      const hint = carol.page.getByTestId("plan-asked-again");
      await hint.waitFor();
      check((await hint.innerText()).trim() === "Neue Zeit – passt es dir noch? Vorher: Bin dabei", "Neu fragen: Carol sieht ihre alte Antwort als Hinweis");
      check((await carol.page.getByRole("radio", { name: "Bin dabei" }).getAttribute("aria-checked")) === "false", "Neu fragen: Antwortkarte wieder offen");
      await noOverflow(carol, "Neu gefragt");
      await shot(carol, "21k-plan-neu-gefragt");
      await carol.page.getByRole("radio", { name: "Vielleicht" }).click();
      await toast(carol, "Antwort gespeichert.");
      await hint.waitFor({ state: "detached" });
      check(true, "Neu fragen: nach der neuen Antwort verschwindet der Hinweis");

      // P24 – Zusatz zur Antwort: Carol hängt an „Vielleicht“ einen Vorschlag mit einem Tipp, Bob sieht ihn bei
      // „Wer kommt mit?“. Neue Antwort → Zusatz weg; eigener Text über das Feld.
      await carol.page.getByTestId("answer-note-add").click();
      const noteForm = carol.page.getByTestId("answer-note-form");
      await noteForm.waitFor();
      check((await noteForm.getByRole("button", { name: "Sag bis mittags Bescheid" }).count()) === 1, "Zusatz: Vorschläge passen zu „Vielleicht“");
      await noOverflow(carol, "Zusatz-Formular");
      await a11y(carol, "plan-zusatz-formular");
      await noteForm.scrollIntoViewIfNeeded();
      await shot(carol, "21l-plan-zusatz-formular");
      await noteForm.getByRole("button", { name: "Sag bis mittags Bescheid" }).click();
      await toast(carol, "Zusatz gespeichert.");
      const myNote = carol.page.getByTestId("answer-note");
      await myNote.waitFor();
      check((await myNote.innerText()).includes("„Sag bis mittags Bescheid“"), "Zusatz: steht in Carols Antwortkarte");
      check(psql(`select note from public.plan_participants where plan_id = '${movePlan}' and user_id = '${carolId}'`) === "Sag bis mittags Bescheid",
        "Zusatz: gespeichert mit einem Tipp");
      await bob.page.goto(`${APP}/plans/${movePlan}`);
      const whoNote = bob.page.getByTestId("who-note");
      await whoNote.waitFor();
      check((await whoNote.innerText()).includes("„Sag bis mittags Bescheid“"), "Zusatz: Bob sieht ihn bei „Wer kommt mit?“");
      check((await whoNote.locator("xpath=ancestor::li[1]").getAttribute("data-status")) === "maybe", "Zusatz: steht bei Carol unter „Vielleicht“");
      await whoNote.scrollIntoViewIfNeeded();
      await noOverflow(bob, "Zusatz bei Wer");
      await a11y(bob, "plan-zusatz-wer");
      await shot(bob, "21m-plan-zusatz-wer");
      await carol.page.getByRole("radio", { name: "Bin dabei" }).click();
      await toast(carol, "Antwort gespeichert.");
      await carol.page.getByTestId("answer-note-add").waitFor();
      check(psql(`select coalesce(note, '-') from public.plan_participants where plan_id = '${movePlan}' and user_id = '${carolId}'`) === "-",
        "Zusatz: neue Antwort, Zusatz weg");
      await carol.page.getByTestId("answer-note-add").click();
      await carol.page.getByTestId("answer-note-input").fill("komme erst um 22 Uhr");
      await carol.page.getByTestId("answer-note-form").getByRole("button", { name: "Speichern" }).click();
      await toast(carol, "Zusatz gespeichert.");
      await carol.page.getByTestId("answer-note").filter({ hasText: "komme erst um 22 Uhr" }).waitFor();
      check(true, "Zusatz: eigener Text gespeichert");
      await shot(carol, "21n-plan-zusatz");
      if (ANON) {
        const res = await fetch(`${API}/rest/v1/rpc/set_plan_answer_note`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_plan_id: movePlan, p_note: "gehackt" }),
        });
        check(res.status === 401 || res.status === 403, `ohne Anmeldung kein Zusatz (${res.status})`);
      }
      await carol.page.goto(`${APP}/notifications`);
      await carol.page.getByText("Neue Zeit: Tischtennis im Park – bist du noch dabei?").first().waitFor();
      check(true, "Neu fragen: Benachrichtigung „Neue Zeit: … – bist du noch dabei?“");
      if (ANON) {
        const res = await fetch(`${API}/rest/v1/rpc/ask_plan_again`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_plan_id: movePlan }),
        });
        check(res.status === 401 || res.status === 403, `ohne Anmeldung kein Zurücksetzen (${res.status})`);
      }
    } finally {
      psql(`delete from public.notifications where related_entity_id = '${movePlan}'; delete from public.plans where id = '${movePlan}'`);
    }
  }

  // P25 – „Findet statt ab 3“: Bob organisiert (390 px), Alice und er sind dabei. Ein Tipp auf „3“ setzt die
  // Mindestzahl; Carol sieht „Noch 1 fehlt“, sagt zu – „Findet statt“, und alle ohne Absage bekommen genau einmal
  // „Es findet statt: …“. Carol (einfaches Mitglied) kann die Zahl nicht einstellen, ohne Anmeldung niemand.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const bobId = psql(`select id from auth.users where email = '${bob.email}'`);
    const aliceId = psql(`select id from auth.users where email = '${alice.email}'`);
    const quorumPlan = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status)
      values ('${ids.crew}', '${bobId}', 'Kicker in der Eckkneipe', date_trunc('day', now()) + interval '5 days 20 hours', 'confirmed')
      returning id`).split("\n")[0];
    psql(`insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
      select '${quorumPlan}', m.user_id,
        case when m.user_id in ('${bobId}', '${aliceId}') then 'going'::public.attendance_status else 'invited'::public.attendance_status end,
        case when m.user_id in ('${bobId}', '${aliceId}') then now() end
      from public.crew_members m where m.crew_id = '${ids.crew}'`);
    try {
      await bob.page.goto(`${APP}/plans/${quorumPlan}`);
      await bob.page.getByRole("heading", { level: 1, name: "Kicker in der Eckkneipe" }).waitFor();
      const card = bob.page.getByTestId("plan-quorum-card");
      await card.waitFor();
      check((await bob.page.getByTestId("plan-quorum").count()) === 0, "Mindestzahl: ohne Einstellung keine Anzeige bei „Wer kommt mit?“");
      check((await card.getByRole("radio", { name: "Keine Mindestzahl" }).getAttribute("aria-checked")) === "true", "Mindestzahl: anfangs keine");
      await card.getByRole("radio", { name: "Ab 3 Zusagen" }).click();
      await toast(bob, "Findet statt ab 3 – alle sehen, wie viele noch fehlen.");
      check(psql(`select min_going from public.plans where id = '${quorumPlan}'`) === "3", "Mindestzahl: mit einem Tipp gespeichert");
      const meter = bob.page.getByTestId("plan-quorum");
      await meter.waitFor();
      check((await bob.page.getByTestId("plan-quorum-status").innerText()).trim() === "Noch 1 fehlt", "Mindestzahl: Bob sieht „Noch 1 fehlt“");
      check((await meter.getByRole("progressbar").getAttribute("aria-valuenow")) === "2", "Mindestzahl: Balken steht auf 2 von 3");
      await noOverflow(bob, "Mindestzahl einstellen");
      await a11y(bob, "plan-mindestzahl");
      await card.scrollIntoViewIfNeeded();
      await shot(bob, "21o-plan-mindestzahl-einstellen");
      await meter.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(bob, "21p-plan-mindestzahl-fehlt");

      // P25 Etappe 2: Carol (noch ohne Antwort) sieht „Noch 1 fehlt“ am Ticket auf Home …
      await carol.page.goto(`${APP}/`);
      const homeQuorum = carol.page.locator(`a[href="/plans/${quorumPlan}"]`).first().getByTestId("ticket-quorum");
      await homeQuorum.waitFor();
      check((await homeQuorum.innerText()).trim() === "Noch 1 fehlt", "Mindestzahl: „Noch 1 fehlt“ am Ticket auf Home");
      await homeQuorum.evaluate((el) => el.closest("a")?.scrollIntoView({ block: "center" }));
      await noOverflow(carol, "Mindestzahl am Ticket");
      await a11y(carol, "home-mindestzahl");
      await shot(carol, "21p2-home-mindestzahl-ticket");
      // … und wer den Link aus dem Gruppenchat ohne Konto öffnet, liest „Noch 1 fehlt – bist du dabei?“.
      const quorumToken = (await api(bob, "POST", "rpc/plan_share_token", { p_plan_id: quorumPlan })).json;
      const outsider = await browser.newContext({ viewport: VIEWPORTS.mobile, deviceScaleFactor: 2, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
      try {
        const visitor = { page: await outsider.newPage(), viewport: "mobile" };
        await visitor.page.goto(`${APP}/s/${quorumToken}`);
        const sharedQuorum = visitor.page.getByTestId("shared-plan-quorum");
        await sharedQuorum.waitFor();
        check((await sharedQuorum.innerText()).trim() === "Noch 1 fehlt – bist du dabei?", "Mindestzahl: geteilte Karte fragt „Noch 1 fehlt – bist du dabei?“");
        check((await visitor.page.getByTestId("shared-plan-going").innerText()).includes("2"), "Mindestzahl: geteilte Karte zeigt 2 Zusagen");
        await noOverflow(visitor, "Mindestzahl auf der geteilten Karte");
        await a11y(visitor, "geteilt-mindestzahl");
        await shot(visitor, "21p3-geteilt-mindestzahl");
      } finally {
        await outsider.close();
      }

      // Carol: sieht, was fehlt, kann die Zahl aber nicht einstellen – und sagt zu.
      await carol.page.goto(`${APP}/plans/${quorumPlan}`);
      await carol.page.getByRole("heading", { level: 1, name: "Kicker in der Eckkneipe" }).waitFor();
      await carol.page.getByTestId("plan-quorum").waitFor();
      check((await carol.page.getByTestId("plan-quorum-status").innerText()).trim() === "Noch 1 fehlt", "Mindestzahl: Carol sieht „Noch 1 fehlt“");
      check((await carol.page.getByTestId("plan-quorum-card").count()) === 0, "Mindestzahl: einfache Mitglieder stellen nichts ein");
      await carol.page.getByRole("radio", { name: "Bin dabei" }).click();
      await toast(carol, "Antwort gespeichert.");
      const reached = carol.page.locator('[data-testid="plan-quorum"][data-reached="true"]');
      await reached.waitFor();
      check((await carol.page.getByTestId("plan-quorum-status").innerText()).trim() === "Findet statt", "Mindestzahl: nach Carols Zusage „Findet statt“");
      // Das Bild zeigt „Wer kommt mit?“ mit der Anzeige, nicht den Kopf der Seite (und keinen Toast darüber).
      await carol.page.getByText("Antwort gespeichert.").first().waitFor({ state: "hidden" });
      await reached.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await noOverflow(carol, "Mindestzahl erreicht");
      await a11y(carol, "plan-mindestzahl-erreicht");
      await shot(carol, "21q-plan-findet-statt");
      // In der Planliste trägt das (jetzt grüne) Ticket „Findet statt“ – Home zeigt nach der Zusage nur die nächsten Pläne.
      await carol.page.goto(`${APP}/plans`);
      const listReached = carol.page.locator(`a[href="/plans/${quorumPlan}"]`).first().locator('[data-testid="ticket-quorum"][data-reached="true"]');
      await listReached.waitFor();
      check((await listReached.innerText()).trim() === "Findet statt", "Mindestzahl: „Findet statt“ am Ticket in der Planliste");
      await a11y(carol, "plaene-mindestzahl-erreicht");
      await carol.page.goto(`${APP}/plans/${quorumPlan}`);
      await carol.page.getByRole("heading", { level: 1, name: "Kicker in der Eckkneipe" }).waitFor();
      check(psql(`select count(*) from public.notifications where type = 'plan_quorum' and related_entity_id = '${quorumPlan}'`) ===
        psql(`select count(*) from public.crew_members m left join public.user_settings s on s.user_id = m.user_id
          where m.crew_id = '${ids.crew}' and coalesce(s.notification_preferences ->> 'plan_quorum', 'true') <> 'false'`),
        "Mindestzahl: alle ohne Absage bekommen genau eine Nachricht");

      // Noch einmal ab- und zusagen: keine zweite Nachricht.
      await carol.page.getByRole("radio", { name: "Vielleicht" }).click();
      await toast(carol, "Antwort gespeichert.");
      await carol.page.locator('[data-testid="plan-quorum"][data-reached="false"]').waitFor();
      await carol.page.getByRole("radio", { name: "Bin dabei" }).click();
      await carol.page.locator('[data-testid="plan-quorum"][data-reached="true"]').waitFor();
      check(psql(`select count(*) from public.notifications where type = 'plan_quorum' and related_entity_id = '${quorumPlan}' and user_id = (select id from auth.users where email = '${carol.email}')`) === "1",
        "Mindestzahl: Carol bekommt die Nachricht genau einmal");

      await carol.page.goto(`${APP}/notifications`);
      const news = carol.page.getByRole("link", { name: /Es findet statt: Kicker in der Eckkneipe/ });
      await news.first().waitFor();
      check(true, "Mindestzahl: „Es findet statt: …“ in den Benachrichtigungen");
      await shot(carol, "21r-findet-statt-benachrichtigung");
      await news.first().click();
      await carol.page.waitForURL(`**/plans/${quorumPlan}`);
      check(true, "Mindestzahl: Nachricht führt zum Plan");

      // Bob entfernt die Mindestzahl wieder.
      await bob.page.reload();
      await bob.page.getByTestId("plan-quorum-card").getByRole("radio", { name: "Keine Mindestzahl" }).click();
      await toast(bob, "Keine Mindestzahl mehr.");
      await bob.page.getByTestId("plan-quorum").waitFor({ state: "detached" });
      check(true, "Mindestzahl: entfernt, Anzeige verschwindet");
      if (ANON) {
        const res = await fetch(`${API}/rest/v1/rpc/set_plan_min_going`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_plan_id: quorumPlan, p_min: 2 }),
        });
        check(res.status === 401 || res.status === 403, `ohne Anmeldung keine Mindestzahl (${res.status})`);
      }
    } finally {
      psql(`delete from public.notifications where related_entity_id = '${quorumPlan}'; delete from public.plans where id = '${quorumPlan}'`);
    }
  }

  // P26 – „Nur 2 Plätze“: Bob organisiert (390 px), Alice und er sind dabei. Ein Tipp auf „2“ setzt die Höchstzahl –
  // die Runde ist voll. Carol bekommt statt „Bin dabei“ „Nachrücken“, steht als Nächste auf der Liste; sagt Alice ab,
  // rückt Carol von selbst nach und bekommt genau einmal „Du bist nachgerückt: …“. Einfache Mitglieder stellen
  // nichts ein, ohne Anmeldung niemand; eine Zusage über die Grenze weist der Server ab.
  if (DB_URL) {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const bobId = psql(`select id from auth.users where email = '${bob.email}'`);
    const aliceId = psql(`select id from auth.users where email = '${alice.email}'`);
    const carolId = psql(`select id from auth.users where email = '${carol.email}'`);
    const capPlan = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status)
      values ('${ids.crew}', '${bobId}', 'Bowling auf Bahn 3', date_trunc('day', now()) + interval '6 days 19 hours', 'confirmed')
      returning id`).split("\n")[0];
    // P26 Etappe 3b: Der Gast-Browser bleibt bis zum Nachrücken offen (sein Geheimnis liegt dort im Speicher).
    let capOutsider = null;
    psql(`insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
      select '${capPlan}', m.user_id,
        case when m.user_id in ('${bobId}', '${aliceId}') then 'going'::public.attendance_status else 'invited'::public.attendance_status end,
        case when m.user_id in ('${bobId}', '${aliceId}') then now() end
      from public.crew_members m where m.crew_id = '${ids.crew}'`);
    try {
      await bob.page.goto(`${APP}/plans/${capPlan}`);
      await bob.page.getByRole("heading", { level: 1, name: "Bowling auf Bahn 3" }).waitFor();
      const card = bob.page.getByTestId("plan-capacity-card");
      await card.waitFor();
      check((await bob.page.getByTestId("plan-capacity").count()) === 0, "Höchstzahl: ohne Einstellung keine Anzeige bei „Wer kommt mit?“");
      check((await card.getByRole("radio", { name: "Keine Höchstzahl" }).getAttribute("aria-checked")) === "true", "Höchstzahl: anfangs offen");
      await card.getByRole("radio", { name: "Höchstens 2 Zusagen" }).click();
      await toast(bob, "Höchstens 2 – ist es voll, geht es auf die Nachrückliste.");
      check(psql(`select max_going from public.plans where id = '${capPlan}'`) === "2", "Höchstzahl: mit einem Tipp gespeichert");
      const meter = bob.page.locator('[data-testid="plan-capacity"][data-full="true"]');
      await meter.waitFor();
      check((await bob.page.getByTestId("plan-capacity-status").innerText()).trim() === "Voll", "Höchstzahl: Bob sieht „Voll“");
      await noOverflow(bob, "Höchstzahl einstellen");
      await a11y(bob, "plan-hoechstzahl");
      await card.scrollIntoViewIfNeeded();
      await shot(bob, "21s-plan-hoechstzahl-einstellen");

      // Carol: „Bin dabei“ ist jetzt „Nachrücken“; der Server weist eine Zusage über die Grenze ab.
      check((await api(carol, "POST", "rpc/set_attendance", { p_plan_id: capPlan, p_status: "going" })).status >= 400, "Höchstzahl: Zusage über die Grenze wird abgewiesen");
      await carol.page.goto(`${APP}/plans/${capPlan}`);
      await carol.page.getByRole("heading", { level: 1, name: "Bowling auf Bahn 3" }).waitFor();
      check((await carol.page.getByTestId("plan-capacity-card").count()) === 0, "Höchstzahl: einfache Mitglieder stellen nichts ein");
      const join = carol.page.getByTestId("plan-waitlist-join");
      await join.waitFor();
      check((await join.innerText()).trim() === "Nachrücken", "Höchstzahl: Carol sieht „Nachrücken“ statt „Bin dabei“");
      await carol.page.getByTestId("plan-waitlist-mine").waitFor();
      // P26 Etappe 3a: Auf Home steht der Plan unter „Deine Antwort fehlt“ – dort wird „Bin dabei“ ebenfalls zu
      // „Nachrücken“, ein Tipp stellt Carol in die Reihe, danach rutscht der Plan aus der Liste.
      await carol.page.goto(`${APP}/`);
      const quick = carol.page.getByRole("group", { name: "Deine Antwort zu „Bowling auf Bahn 3“" });
      await quick.waitFor();
      const quickJoin = quick.getByTestId("plan-quick-waitlist");
      check((await quickJoin.innerText()).trim() === "Nachrücken", "Höchstzahl: auf Home „Nachrücken“ statt „Bin dabei“");
      check((await quick.getByRole("button", { name: "Vielleicht" }).count()) === 1 && (await quick.getByRole("button", { name: "Kann nicht" }).count()) === 1,
        "Höchstzahl: auf Home bleiben „Vielleicht“ und „Kann nicht“");
      await quick.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await noOverflow(carol, "Nachrücken auf Home");
      await a11y(carol, "home-nachruecken");
      await shot(carol, "21s2-home-nachruecken");
      await quickJoin.click();
      await toast(carol, "Du bist als Nächstes dran.");
      await quick.waitFor({ state: "detached" });
      check(psql(`select attendance_status || '/' || (waitlisted_at is not null) from public.plan_participants where plan_id = '${capPlan}' and user_id = '${carolId}'`) === "maybe/true",
        "Höchstzahl: Tipp auf Home stellt Carol auf die Nachrückliste");
      await carol.page.goto(`${APP}/plans/${capPlan}`);
      await carol.page.getByRole("heading", { level: 1, name: "Bowling auf Bahn 3" }).waitFor();
      const mine = carol.page.getByTestId("plan-waitlist-mine");
      await mine.getByText("Du bist als Nächstes dran").waitFor();
      check(await join.isDisabled(), "Höchstzahl: auf der Liste ist „Nachrücken“ gesperrt");
      check((await carol.page.getByRole("radio", { name: "Vielleicht" }).getAttribute("aria-checked")) === "true", "Höchstzahl: auf der Liste gilt „Vielleicht“");
      const entries = carol.page.getByTestId("plan-waitlist-entry");
      await entries.first().waitFor();
      check((await entries.count()) === 1 && (await entries.first().innerText()).includes("Du"), "Höchstzahl: Carol steht als Erste auf der Nachrückliste");
      await carol.page.getByText("Du bist als Nächstes dran.").first().waitFor({ state: "hidden" });
      await mine.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await noOverflow(carol, "Nachrückliste");
      await a11y(carol, "plan-nachrueckliste");
      await shot(carol, "21t-plan-nachrueckliste");
      await carol.page.getByTestId("plan-waitlist").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(carol, "21u-plan-wer-kommt-nachrueckliste");

      // P26 Etappe 2: In der Planliste trägt das Ticket „Voll – Nachrückliste“, Carol liest dort ihren Platz statt „vielleicht“.
      await carol.page.goto(`${APP}/plans`);
      const listTicket = carol.page.locator(`a[href="/plans/${capPlan}"]`).first();
      const listFull = listTicket.locator('[data-testid="ticket-capacity"][data-full="true"]');
      await listFull.waitFor();
      check((await listFull.innerText()).trim() === "Voll – Nachrückliste", "Höchstzahl: „Voll – Nachrückliste“ am Ticket in der Planliste");
      check((await listTicket.innerText()).includes("Du rückst als Nächstes nach"), "Höchstzahl: Ticket nennt Carols Platz auf der Nachrückliste");
      await listTicket.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await noOverflow(carol, "Höchstzahl am Ticket");
      await a11y(carol, "plaene-hoechstzahl");
      await shot(carol, "21u2-plaene-ticket-voll");
      // … und wer den Link ohne Konto öffnet, sieht „Voll“; statt „Bin dabei“ stellt sich der Gast in dieselbe Reihe
      // (P26 Etappe 3b) – hinter Carol, mit Namen, ohne Konto.
      check((await api(bob, "POST", "rpc/set_plan_guests", { p_plan_id: capPlan, p_allowed: true })).status < 300, "Höchstzahl: Bob lässt Gäste zusagen");
      const capToken = (await api(bob, "POST", "rpc/plan_share_token", { p_plan_id: capPlan })).json;
      capOutsider = await browser.newContext({ viewport: VIEWPORTS.mobile, deviceScaleFactor: 2, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
      const visitor = { page: await capOutsider.newPage(), viewport: "mobile" };
      {
        await visitor.page.goto(`${APP}/s/${capToken}`);
        const sharedCap = visitor.page.locator('[data-testid="shared-plan-capacity"][data-full="true"]');
        await sharedCap.waitFor();
        check((await sharedCap.innerText()).trim() === "Voll – wer absagt, macht Platz", "Höchstzahl: geteilte Karte zeigt „Voll“");
        await visitor.page.getByTestId("rsvp-full").waitFor();
        check((await visitor.page.getByRole("radio", { name: "Bin dabei" }).count()) === 0, "Höchstzahl: Gast kann bei voller Runde nicht zusagen");
        check(!(await visitor.page.getByTestId("rsvp-waitlist").isDisabled()), "Höchstzahl: Gast bekommt „Nachrücken“");
        check(!(await visitor.page.getByRole("radio", { name: "Vielleicht" }).isDisabled()), "Höchstzahl: „Vielleicht“ bleibt für Gäste offen");
        check(!(await visitor.page.content()).includes("Carol"), "Höchstzahl: geteilte Karte verrät die Nachrückliste nicht");
        await noOverflow(visitor, "Höchstzahl auf der geteilten Karte");
        await a11y(visitor, "geteilt-hoechstzahl");
        await shot(visitor, "21u3-geteilt-voll");
        await visitor.page.getByTestId("rsvp-full").evaluate((el) => el.scrollIntoView({ block: "center" }));
        await shot(visitor, "21u4-geteilt-voll-gast");
        // P26 Etappe 3b: Dana (ohne Konto) tippt „Nachrücken“, gibt ihren Namen ein – Nr. 2 hinter Carol.
        await visitor.page.getByTestId("rsvp-waitlist").click();
        await visitor.page.getByLabel("Dein Name").fill("Dana");
        await visitor.page.getByRole("button", { name: "Antwort senden" }).click();
        const guestMine = visitor.page.getByTestId("rsvp-waitlist-mine");
        await guestMine.waitFor();
        check((await guestMine.innerText()).includes("Du bist Nr. 2 auf der Nachrückliste"), "Höchstzahl: Gast steht als Nr. 2 auf der Liste");
        check((await guestMine.innerText()).includes("keine Nachricht"), "Höchstzahl: Gast erfährt, dass ohne Konto keine Nachricht kommt");
        check(await visitor.page.getByTestId("rsvp-waitlist").isDisabled(), "Höchstzahl: „Nachrücken“ ist gewählt");
        check(psql(`select count(*) from public.plan_guests where plan_id = '${capPlan}' and display_name = 'Dana' and waitlisted_at is not null and attendance_status = 'maybe'`) === "1",
          "Höchstzahl: Dana steht mit „Vielleicht“ auf der Liste");
        await guestMine.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await noOverflow(visitor, "Gast auf der Nachrückliste");
        await a11y(visitor, "geteilt-nachrueckliste");
        await shot(visitor, "21u5-geteilt-gast-nachrueckliste");
      }
      // Die Crew sieht Dana in derselben Reihe – hinter Carol.
      await carol.page.goto(`${APP}/plans/${capPlan}`);
      await carol.page.getByRole("heading", { level: 1, name: "Bowling auf Bahn 3" }).waitFor();
      const guestEntry = carol.page.locator('[data-testid="plan-waitlist-entry"][data-kind="guest"]');
      await guestEntry.waitFor();
      check((await guestEntry.innerText()).includes("2") && (await guestEntry.innerText()).includes("Dana (Gast)"), "Höchstzahl: Crew sieht „Dana (Gast)“ als Nr. 2");
      check((await carol.page.getByTestId("who-guest").filter({ hasText: "Dana" }).count()) === 0, "Höchstzahl: Gast auf der Liste steht nicht zusätzlich bei „Vielleicht“");
      await carol.page.getByTestId("plan-waitlist").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(carol, "21u6-nachrueckliste-mit-gast");
      await carol.page.goto(`${APP}/plans/${capPlan}`);
      await carol.page.getByRole("heading", { level: 1, name: "Bowling auf Bahn 3" }).waitFor();

      // Alice sagt ab – Carol rückt nach.
      check((await api(alice, "POST", "rpc/set_attendance", { p_plan_id: capPlan, p_status: "declined" })).status < 300, "Höchstzahl: Alice sagt ab");
      check(psql(`select attendance_status from public.plan_participants where plan_id = '${capPlan}' and user_id = '${carolId}'`) === "going", "Höchstzahl: Carol ist nachgerückt");
      check(psql(`select count(*) from public.notifications where type = 'plan_waitlist_promoted' and related_entity_id = '${capPlan}' and user_id = '${carolId}'`) === "1",
        "Höchstzahl: Carol bekommt genau eine Nachricht");
      await carol.page.reload();
      await carol.page.getByRole("heading", { level: 1, name: "Bowling auf Bahn 3" }).waitFor();
      await carol.page.locator('[role="radio"][aria-checked="true"]', { hasText: "Bin dabei" }).waitFor();
      check((await carol.page.getByTestId("plan-waitlist-mine").count()) === 0, "Höchstzahl: nach dem Nachrücken kein Listen-Hinweis mehr");
      await carol.page.goto(`${APP}/notifications`);
      const news = carol.page.getByRole("link", { name: /Du bist nachgerückt: Bowling auf Bahn 3/ });
      await news.first().waitFor();
      check(true, "Höchstzahl: „Du bist nachgerückt: …“ in den Benachrichtigungen");
      await shot(carol, "21v-nachgerueckt-benachrichtigung");
      await news.first().click();
      await carol.page.waitForURL(`**/plans/${capPlan}`);
      check(true, "Höchstzahl: Nachricht führt zum Plan");

      // P26 Etappe 3b: Carol sagt doch ab – Dana (Gast) rückt nach und liest es auf der Karte.
      check((await api(carol, "POST", "rpc/set_attendance", { p_plan_id: capPlan, p_status: "declined" })).status < 300, "Höchstzahl: Carol sagt ab");
      check(psql(`select attendance_status from public.plan_guests where plan_id = '${capPlan}' and display_name = 'Dana'`) === "going", "Höchstzahl: Gast Dana ist nachgerückt");
      check(psql(`select count(*) from public.notifications where type = 'plan_attendance' and related_entity_id = '${capPlan}' and user_id = '${bobId}' and payload ->> 'guest' = 'Dana'`) === "1",
        "Höchstzahl: Bob (organisiert) erfährt, dass Dana dabei ist");
      {
        const visitor = { page: capOutsider.pages()[0], viewport: "mobile" };
        await visitor.page.reload();
        const promoted = visitor.page.getByTestId("rsvp-promoted");
        await promoted.waitFor();
        check((await promoted.innerText()).includes("Du bist nachgerückt"), "Höchstzahl: Gast liest „Du bist nachgerückt“");
        check((await visitor.page.getByTestId("rsvp-waitlist-mine").count()) === 0, "Höchstzahl: kein Listen-Hinweis mehr beim Gast");
        await visitor.page.locator('[role="radio"][aria-checked="true"]', { hasText: "Bin dabei" }).waitFor();
        await promoted.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await noOverflow(visitor, "Gast nachgerückt");
        await shot(visitor, "21v2-geteilt-gast-nachgerueckt");
      }
      await capOutsider.close();
      capOutsider = null;

      // Bob öffnet die Runde wieder.
      await bob.page.reload();
      await bob.page.getByTestId("plan-capacity-card").getByRole("radio", { name: "Keine Höchstzahl" }).click();
      await toast(bob, "Keine Höchstzahl mehr – alle auf der Liste sind jetzt dabei.");
      await bob.page.getByTestId("plan-capacity").waitFor({ state: "detached" });
      check(true, "Höchstzahl: entfernt, Anzeige verschwindet");
      if (ANON) {
        const res = await fetch(`${API}/rest/v1/rpc/set_plan_max_going`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_plan_id: capPlan, p_max: 2 }),
        });
        check(res.status === 401 || res.status === 403, `ohne Anmeldung keine Höchstzahl (${res.status})`);
      }
    } finally {
      if (capOutsider) await capOutsider.close().catch(() => {});
      psql(`delete from public.notifications where related_entity_id = '${capPlan}'; delete from public.plans where id = '${capPlan}'`);
    }
  }

  await alice.page.goto(`${APP}/crews`);
  await alice.page.getByRole("link", { name: /Weekend Crew/ }).first().waitFor();
  const crewsTitle = alice.page.getByRole("heading", { level: 1 });
  await crewsTitle.waitFor();
  check(/^\d+ Freunde? in \d+ Crews?$/i.test((await crewsTitle.innerText()).trim()), `Crews-Überschrift zählt echte Freunde und Crews („${(await crewsTitle.innerText()).trim()}“)`);
  check(/^\d+ Freunde?$/i.test((await crewsTitle.locator(".text-lime").innerText()).trim()), "Crews-Überschrift hebt die Zahl der Freunde hervor");
  // V2 Etappe 3i: Crew-Zeilen als Glas-Karten in der Farbwelt der Crew; was läuft, steht als Pille daneben.
  {
    const rows = alice.page.getByTestId("crew-row");
    const worlds = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-world")));
    check(worlds.length >= 1 && worlds.every((w) => ["violet", "pink", "lime", "amber"].includes(w ?? "")), `Crew-Zeilen tragen eine Farbwelt (${worlds.join(", ")})`);
    const first = rows.first();
    check((await first.evaluate((el) => getComputedStyle(el).backgroundImage)).includes("radial-gradient"), "Crew-Zeile leuchtet in ihrer Farbwelt");
    const nameFont = await first.locator(".font-display").first().evaluate((el) => getComputedStyle(el).fontFamily);
    check(/Unbounded/i.test(nameFont), `Crew-Name in Unbounded („${nameFont}“)`);
    const pulses = await rows.evaluateAll((els) => els.map((el) => [el.getAttribute("data-pulse"), el.querySelector("[data-testid=crew-row-status]")?.textContent?.trim() ?? ""]));
    check(
      pulses.every(([pulse, label]) => (pulse === "polls" && /Abstimmungen? läuf/.test(label)) || (pulse === "plans" && /Pläne? steh/.test(label)) || (pulse === "quiet" && label === "Gerade nichts geplant")),
      `Pille der Crew-Zeile passt zum Stand (${pulses.map((p) => p.join(": ")).join("; ")})`,
    );
    const lime = await rows.evaluateAll((els) => els.filter((el) => el.getAttribute("data-pulse") === "polls").map((el) => getComputedStyle(el.querySelector("[data-testid=crew-row-status]")).backgroundColor));
    check(lime.every((bg) => bg === "rgb(200, 255, 46)"), "laufende Abstimmung leuchtet als Lime-Pille");
    const box = await first.boundingBox();
    const vw = alice.page.viewportSize()?.width ?? 0;
    check(!!box && box.x >= 0 && box.x + box.width <= vw + 1, `Crew-Zeile passt in die Breite (${vw} px)`);
    check((await alice.page.getByTestId("crew-join").count()) === 1, "„Einladung erhalten?“ als Glas-Karte");
  }
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
    // V2 Etappe 3h: Das Profil ist eine Stammkarte im Stil 2.0 – Name in Chrom, Stadt und „Dabei seit“ als Pillen,
    // erlebte Abende als große Kachel (lime erst ab dem ersten Abend), kein Ticket-Abriss mehr.
    const pass = user.page.getByTestId("profile-pass");
    check((await pass.getByRole("heading", { level: 1 }).count()) === 1, `Profil-Name steht als Überschrift auf der Stammkarte (${user.name})`);
    check((await pass.locator("h1.chrome").count()) === 1, `Profil-Name in Chrom (${user.name})`);
    check((await pass.locator(".ticket-stub, .ticket-barcode").count()) === 0, `Stammkarte ohne Ticket-Abriss (${user.name})`);
    const evenings = pass.getByTestId("profile-evenings");
    await evenings.getByText(/^\d+$/).waitFor();
    const tile = (await evenings.innerText()).replace(/\s+/g, " ").trim();
    check(/^\d+ abende? erlebt$/i.test(tile), `Kachel zählt erlebte Abende (${user.name}: „${tile}“)`);
    check((await evenings.getAttribute("data-lit")) === (/^0 /.test(tile) ? "false" : "true"), `Kachel leuchtet lime erst ab dem ersten Abend (${user.name})`);
    if (DB_URL && user !== carol) check(!/^0 /.test(tile), `abgeschlossener Plan zählt als erlebter Abend (${user.name})`);
    check(/dabei seit \S+ \d{4}/i.test(await pass.getByTestId("profile-since").innerText()), "Stammkarte zeigt „Dabei seit“ aus dem Kontodatum als Pille");
    check((await pass.getByTestId("profile-city").count()) === 1, "Stadt steht als Pille auf der Stammkarte");
    const passBox = await pass.boundingBox();
    const vw = user.page.viewportSize()?.width ?? 0;
    check(!!passBox && passBox.x >= 0 && passBox.x + passBox.width <= vw + 1, `Stammkarte passt in die Breite (${user.name}, ${vw} px)`);
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
  ids.runoff = runoff;
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
  // V2 Etappe 3m: Abschnitte als Glas-Karten, oben die Datumskachel – ohne Datum ehrlich „fehlt noch“.
  for (const id of ["plan-form-place", "plan-form-what", "plan-form-where", "plan-form-money", "plan-form-more", "plan-form-mode"]) {
    check((await page.getByTestId(id).count()) === 1, `Plan-Formular: Abschnitt ${id}`);
  }
  check((await page.getByTestId("plan-form-what").getAttribute("data-tone")) === "lime", "Plan-Formular: „Was & wann“ mit Lime-Schein");
  check((await page.getByTestId("plan-form-when").getAttribute("data-filled")) === "false" && (await page.getByTestId("plan-form-when").innerText()).includes("Tag und Uhrzeit fehlen noch."), "Plan-Formular: ohne Datum zeigt die Kachel, dass es fehlt");
  const inTenDays = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
  await page.getByLabel("Datum").fill(inTenDays);
  const whenText = await page.getByTestId("plan-form-when").innerText();
  check((await page.getByTestId("plan-form-when").getAttribute("data-filled")) === "true" && /19:00 Uhr/.test(whenText) && /In (9|10|11) Tagen/i.test(whenText), `Plan-Formular: Kachel zeigt Tag, Uhrzeit und Abstand („${whenText.replace(/\s+/g, " ")}“)`);
  await page.getByText("Fest eingeplant", { exact: true }).click();
  check((await page.getByRole("radio", { name: /Fest eingeplant/ }).isChecked()) && (await page.getByRole("radio", { name: /^Vorschlag/ }).isChecked()) === false, "Plan-Formular: Verbindlichkeit als Auswahlkarten umschaltbar");
  await page.getByText("Vorschlag", { exact: true }).click();
  check(await page.getByRole("radio", { name: /^Vorschlag/ }).isChecked(), "Plan-Formular: zurück auf Vorschlag");
  await noOverflow(carol, "Plan erstellen");
  await shot(carol, "30-plan-erstellen");
  // Auf dem Handy (390 px): dieselben Karten ohne seitlichen Überlauf.
  await bob.page.goto(`${APP}/plans/new`);
  await bob.page.getByTestId("plan-form-what").waitFor();
  await noOverflow(bob, "Plan erstellen");
  if ((await bob.page.getByTestId("plan-form-crew").count()) === 1) {
    check((await bob.page.getByTestId("plan-form-crew").getByRole("radio", { checked: true }).count()) === 1, "Plan-Formular: genau eine Crew gewählt");
  }
  await shot(bob, "30b-plan-erstellen");
  await page.getByRole("button", { name: "Plan erstellen" }).click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}/);
  await page.getByText("Dieser Plan ist ein Vorschlag und noch nicht bestätigt.").waitFor();
  check(true, "direkt angelegter Plan startet als Vorschlag");
  check((await page.getByRole("button", { name: "Reservierung vorbereiten" }).count()) === 0, "Reservierung erst nach Bestätigung des Plans");
  check((await page.getByTestId("ticket-confirm-ring").count()) === 0, "D1: beim Laden kein Bestätigungs-Moment");
  await page.getByRole("button", { name: "Plan bestätigen" }).click();
  // D1: Wird der Plan fest, läuft ein Lime-Ring um die Karte, der Stapel fächert sich, die Plakette springt neu auf.
  await page.getByTestId("ticket-confirm-ring").waitFor({ state: "attached", timeout: 5000 });
  check((await page.locator('.ticket-feature-wrap[data-moment="confirmed"]').count()) === 1, "D1: Bestätigung als Moment – Ring und aufgefächerter Stapel");
  check((await page.getByTestId("ticket-status").first().innerText()).trim() === "Bestätigt" && (await page.locator('[data-testid="ticket-status"].badge-pop').count()) === 1, "D1: Plakette „Bestätigt“ springt neu auf");
  await toast(carol, "Plan bestätigt.");
  await page.getByTestId("ticket-confirm-ring").waitFor({ state: "detached", timeout: 5000 });
  check((await page.locator(".ticket-feature-wrap[data-moment]").count()) === 0, "D1: nach gut einer Sekunde liegt die Karte wieder still");
  await page.getByRole("button", { name: "Reservierung vorbereiten" }).waitFor();
  // D6: Bob antwortet direkt auf Home – ohne die Planseite zu öffnen.
  await bob.page.goto(`${APP}/home`);
  const quick = bob.page.getByRole("group", { name: "Deine Antwort zu „Schwarzlicht Minigolf 18“" });
  await quick.waitFor();
  // V2 Etappe 3d: Antworten als Pillen in den Farbnamen der Plan- und Abstimm-Karten.
  check((await quick.locator('.vote-pill[data-response="yes"], .vote-pill[data-response="maybe"], .vote-pill[data-response="no"]').count()) === 3, "Zusage auf Home: drei Antwort-Pillen");
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
  // P32: „Neuer Anlauf?“ – auf dem abgesagten Plan ein Tipp zur Terminsuche, mit Ort und Plan-Name im Titel.
  {
    const cancelledUrl = page.url();
    const retry = page.getByTestId("plan-retry");
    await retry.waitFor();
    check((await retry.innerText()).includes("Abgesagt heißt nicht abgeblasen") && (await retry.innerText()).includes("Schwarzlicht Minigolf 18"), "P32: „Neuer Anlauf?“ mit Ort auf dem abgesagten Plan");
    await retry.scrollIntoViewIfNeeded();
    await shot(carol, "31a-neuer-anlauf");
    const link = retry.getByRole("link", { name: "Neuen Termin finden" });
    const href = new URL((await link.getAttribute("href")) ?? "", APP);
    check(href.pathname === "/polls/new" && href.searchParams.get("kind") === "date" && Boolean(href.searchParams.get("place")) && href.searchParams.get("again") === "Schwarzlicht Minigolf 18", "P32: Link mit Crew, Termin-Abstimmung, Ort und Plan-Name");
    await link.click();
    await page.waitForURL(/\/polls\/new\?/);
    const titleField = page.getByLabel("Frage an die Crew");
    await titleField.waitFor();
    await page.waitForFunction((want) => [...document.querySelectorAll("input")].some((i) => i.value === want), "Schwarzlicht Minigolf 18 – wann klappt’s?", { timeout: 10_000 }).catch(() => {});
    check((await titleField.inputValue()) === "Schwarzlicht Minigolf 18 – wann klappt’s?", "P32: Terminsuche trägt den Namen des abgesagten Plans im Titel");
    await noOverflow(carol, "Neuer Anlauf – Terminsuche");
    await shot(carol, "31b-neuer-anlauf-terminsuche");
    // Auf dem Handy (390 px, axe läuft am Screenshot): Bob sieht die Karte ebenso.
    await bob.page.goto(cancelledUrl);
    await bob.page.getByTestId("plan-retry").waitFor();
    await noOverflow(bob, "Neuer Anlauf (390 px)");
    await bob.page.getByTestId("plan-retry").scrollIntoViewIfNeeded();
    await shot(bob, "31c-neuer-anlauf-handy");
  }
  await alice.page.goto(`${APP}/notifications`);
  await alice.page.getByText("Carol hat einen Plan abgesagt").waitFor();
  check(true, "Absage benachrichtigt die Crew");
  const cancelCard = alice.page.getByTestId("inbox-card").filter({ hasText: "Carol hat einen Plan abgesagt" }).first();
  check((await cancelCard.getAttribute("data-tone")) === "danger", "V2: Absage trägt den roten Schein");
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
  ids.datePoll = { id: datePoll, dates: [d1, d2], labels: [l1, l2] };
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
  // P38: Zwischenstand der Termin-Abstimmung – das Datum ist der Titel des Vorschlags, die meisten Zusagen zuerst.
  await page.getByRole("button", { name: "Zwischenstand teilen" }).click();
  await page.waitForFunction(() => (window.__shared ?? []).length >= 2);
  const dateStanding = (await sharedData(page))[1]?.text ?? "";
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  check(
    new RegExp(`^Wann könnt ihr\\? – ${esc(l2)}: 1 dabei · ${esc(l1)}, 20:00[^:]*: noch niemand dabei\\. `).test(dateStanding),
    `P38: Zwischenstand der Termin-Abstimmung mit Datum als Vorschlag („${dateStanding}“)`,
  );
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

await step("P5 Etappe 3 – „Wann könnt ihr?“ für einen festen Ort, mit Wetter je Termin (Alice, Bob)", async () => {
  const { page } = alice;
  const berlinDate = (offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const label = (date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`));
  const [d1, d2] = [berlinDate(3), berlinDate(4)];
  const [l1, l2] = [label(d1), label(d2)];

  // Der Weg aus Discover: Ort ansehen → „Termin finden“ bringt den Ort mit.
  await page.goto(`${APP}/polls/${ids.poll}`);
  const placeHref = await optionCard(alice, "Strike District Bowling").getByRole("link", { name: "Ort ansehen" }).getAttribute("href");
  await page.goto(`${APP}${placeHref}`);
  await page.getByRole("link", { name: "Termin finden" }).click();
  await page.waitForURL(/\/polls\/new\?kind=date&place=[0-9a-f-]{36}$/);
  const chosen = page.getByTestId("poll-form-date-place-chosen");
  await chosen.waitFor();
  check((await chosen.innerText()).includes("Strike District Bowling"), "Termin finden: der Ort steht schon fest im Formular");
  check((await page.getByRole("tab", { name: "Wann könnt ihr?" }).getAttribute("aria-selected")) === "true", "Termin finden: „Wann könnt ihr?“ ist gewählt");
  check((await page.getByLabel("Frage an die Crew").inputValue()) === "Wann könnt ihr zu Strike District Bowling?", "Termin finden: Frage nennt den Ort");
  const crewCard = page.getByTestId("poll-form-crew");
  if (await crewCard.count()) await crewCard.getByRole("radio", { name: /Weekend Crew/ }).click();
  while ((await page.getByLabel(/^Termin \d+$/).count()) > 2) {
    await page.getByRole("button", { name: `Termin ${await page.getByLabel(/^Termin \d+$/).count()} entfernen` }).click();
  }
  await page.getByLabel("Termin 1", { exact: true }).fill(d1);
  await page.getByLabel("Uhrzeit").first().fill("19:30");
  await page.getByLabel("Termin 2", { exact: true }).fill(d2);
  await page.getByLabel("Uhrzeit").nth(1).fill("");
  await page.getByRole("button", { name: "in 2 Stunden" }).click();
  await shot(alice, "36f-termin-fester-ort-erstellen");
  await page.getByRole("button", { name: "Abstimmung starten" }).click();
  await page.waitForURL(/\/polls\/[0-9a-f-]{36}$/);
  const placePoll = idFromUrl(page);

  // Bob: Ort im Kopf, Wetter bei jedem Termin, kein „Ort ansehen“ je Termin.
  await bob.page.goto(`${APP}/polls/${placePoll}`);
  const fixed = bob.page.getByTestId("poll-fixed-place");
  await fixed.getByText("Bei Strike District Bowling").waitFor();
  check((await fixed.getAttribute("href")) === placeHref, "Kopf: fester Ort als Pille, führt zum Ort");
  // Mit Uhrzeit die Stunde des Termins, ohne Uhrzeit die Zusammenfassung für den Tag.
  for (const [day, expected] of [[l1, "14 °C · Regen · 70 % Regenrisiko"], [l2, "Tagsüber · bis 14 °C · Regen · bis 70 % Regenrisiko"]]) {
    const weather = optionCard(bob, day).getByTestId("poll-option-weather");
    await weather.waitFor();
    check((await weather.innerText()).replace(/\s+/g, " ").trim() === expected, `Wetter am Ort für ${day} (${await weather.innerText()})`);
  }
  check((await bob.page.getByRole("link", { name: "Ort ansehen" }).count()) === 0, "kein „Ort ansehen“ bei jedem Termin – der Ort steht einmal im Kopf");
  await noOverflow(bob, "Termin-Abstimmung mit festem Ort");
  await shot(bob, "36g-termin-fester-ort");
  await answer(bob, l1, "Bin dabei").click();
  await optionCard(bob, l1).getByText("1 Zusage").waitFor();

  // Fehlerzustand: unbekannter Ort im Link – die Abstimmung startet erst, wenn ein anderer gewählt oder der Ort entfernt ist.
  await bob.page.goto(`${APP}/polls/new?kind=date&place=00000000-0000-4000-8000-000000000000`);
  await bob.page.getByText("Dieser Ort ist nicht mehr verfügbar.", { exact: false }).first().waitFor();
  await bob.page.getByRole("button", { name: "Ort festlegen" }).waitFor();
  check(true, "unbekannter Ort im Link: Hinweis statt stiller Termin-Abstimmung ohne Ort");

  // Ergebnis: kein „Und wo?“ (der Ort steht fest), der Plan heißt wie der Ort und hat dessen Adresse.
  await page.reload();
  await page.getByRole("button", { name: "Abstimmung beenden" }).click();
  await dialog(alice).getByRole("button", { name: "Abstimmung beenden" }).click();
  await page.getByRole("heading", { name: `Es wird ${l1}` }).waitFor();
  check((await page.getByTestId("poll-where").count()) === 0, "fester Ort: kein „Und wo?“ nach dem Termin");
  await page.getByRole("button", { name: "Plan erstellen" }).click();
  await dialog(alice).getByRole("heading", { name: "Plan festmachen" }).waitFor();
  await page.waitForFunction(() => document.querySelector('input[name="plan_title"]')?.value === "Strike District Bowling");
  await page.waitForFunction(() => document.querySelector('input[name="plan_address"]')?.value.includes("Demochaussee"));
  check(true, "Plan aus dem Termin: Titel und Adresse vom festen Ort");
  await dialog(alice).getByRole("button", { name: "Plan erstellen" }).click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}/);
  await page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  check(true, "Plan am festen Ort zum Gewinner-Termin");
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
    // W2 Etappe 2: dasselbe für die geteilte Abstimmung – inzwischen entschieden. Durften Gäste mitstimmen (W3), zeigt
    // der Link nach dem Ende das Ergebnis wie allen mit dem Link (P28) – aber ohne Weg zum Plan, Mallory hat nicht mitgestimmt.
    await page.goto(ids.pollShareUrl);
    await page.getByRole("heading", { level: 1, name: /^(Noch nicht in der Crew|Schon entschieden)$/ }).waitFor();
    check(!page.url().includes(ids.poll), "Abstimmungs-Link: Außenstehende bleiben auf der Karte");
    check(/Entschieden/.test(await page.getByTestId("shared-poll-card").innerText()), "beendete Abstimmung: als entschieden markiert");
    check((await page.getByTestId("poll-outcome-link").count()) === 0, "P28: Außenstehende ohne Gast-Stimme bekommen keinen Link zum Plan");
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
  // P10: Fotos der fremden Crew – weder Zeilen noch Dateien noch Upload.
  check((await rows("plan_photos")).length === 0, "API: keine fremden Fotos lesbar");
  if (ids.bobPhotoPath) {
    const mt = await token(mallory);
    const file = await fetch(`${API}/storage/v1/object/authenticated/plan-photos/${ids.bobPhotoPath}`, { headers: { apikey: ANON, Authorization: `Bearer ${mt}` } });
    check(file.status >= 400, `Speicher: fremdes Foto nicht abrufbar (${file.status})`);
    const sign = await fetch(`${API}/storage/v1/object/sign/plan-photos/${ids.bobPhotoPath}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${mt}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }) });
    check(sign.status >= 400, `Speicher: keine signierte Adresse für fremdes Foto (${sign.status})`);
    const over = await fetch(`${API}/storage/v1/object/plan-photos/${ids.bobPhotoPath}`, { method: "PUT", headers: { apikey: ANON, Authorization: `Bearer ${mt}`, "Content-Type": "image/webp", "x-upsert": "true" }, body: PNG });
    check(over.status >= 400, `Speicher: fremdes Foto nicht überschreibbar (${over.status})`);
    const del = await fetch(`${API}/storage/v1/object/plan-photos`, { method: "DELETE", headers: { apikey: ANON, Authorization: `Bearer ${mt}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [ids.bobPhotoPath] }) });
    const deleted = del.ok ? await del.json() : [];
    check(Array.isArray(deleted) && deleted.length === 0, "Speicher: fremdes Foto nicht löschbar");
  }
  check((await api(mallory, "POST", "rpc/reserve_plan_photo", { p_plan_id: ids.plan, p_width: 800, p_height: 600 })).status === 403, "API: kein Foto-Platz in fremdem Plan");
  // P13: Live-Standorte fremder Pläne – weder lesen noch teilen.
  check((await rows("plan_live_locations")).length === 0, "API: keine fremden Live-Standorte lesbar");
  const liveShare = await api(mallory, "POST", "rpc/share_plan_live_location", { p_plan_id: ids.plan, p_latitude: 52.5, p_longitude: 13.4 });
  check(liveShare.status === 403, `API: kein Live-Standort in fremdem Plan (${liveShare.status})`);
  const liveEta = await api(mallory, "POST", "rpc/set_plan_live_arrival", { p_plan_id: ids.plan, p_minutes: 10 });
  check(liveEta.status === 403, `API: keine Ankunft in fremdem Plan (${liveEta.status})`);

  const option = (await api(alice, "GET", `poll_options?select=id&poll_id=eq.${ids.poll}&limit=1`)).json[0].id;
  check((await api(mallory, "POST", "rpc/cast_vote", { p_option_id: option, p_response: "yes" })).status === 403, "API: fremde Abstimmung – Stimme wird abgewiesen (403)");
  check((await api(mallory, "POST", "rpc/create_crew_invitation", { p_crew_id: ids.crew })).status === 403, "API: Einladung für fremde Crew wird abgewiesen (403)");
  check((await api(mallory, "POST", "rpc/set_plan_status", { p_plan_id: ids.plan, p_status: "cancelled" })).status === 403, "API: fremder Plan lässt sich nicht absagen (403)");
  check((await api(mallory, "POST", "rpc/plan_share_token", { p_plan_id: ids.plan })).status === 403, "API: Teilen-Link für fremden Plan wird abgewiesen (403)");
  // P3: Ausgaben und Rückzahlungen fremder Pläne.
  const add = await api(mallory, "POST", "rpc/add_plan_expense", { p_plan_id: ids.plan, p_description: "Fake", p_amount_cents: 100, p_paid_by: null, p_split_with: [] });
  check(add.status === 403, `API: Außenstehende tragen keine Ausgabe in fremde Pläne ein (${add.status})`);
  // P14: Mitbring-Liste fremder Pläne.
  const itemAdd = await api(mallory, "POST", "rpc/add_plan_item", { p_plan_id: ids.plan, p_label: "Fake", p_claim: false });
  check(itemAdd.status === 403, `API: Außenstehende schreiben nichts auf fremde Mitbring-Listen (${itemAdd.status})`);
  const itemRead = await api(mallory, "GET", `plan_items?plan_id=eq.${ids.plan}&select=id`);
  check(itemRead.status === 200 && Array.isArray(itemRead.json) && itemRead.json.length === 0, "API: Außenstehende lesen keine Mitbring-Liste");
  const read = await api(mallory, "GET", `plan_expenses?plan_id=eq.${ids.plan}&select=id`);
  check(read.status === 200 && Array.isArray(read.json) && read.json.length === 0, "API: Außenstehende lesen keine Ausgaben");
  const balances = await api(mallory, "POST", "rpc/crew_open_balances", { p_crew_id: ids.crew });
  check(balances.status === 403, `API: Außenstehende lesen keine offenen Beträge der Crew (${balances.status})`);
  const pairSettle = await api(mallory, "POST", "rpc/settle_crew_balances_with", { p_crew_id: ids.crew, p_other: null, p_expected_cents: 0 });
  check(pairSettle.status === 403, `API: Außenstehende gleichen in fremden Crews nichts aus (${pairSettle.status})`);
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
  // V2 Etappe 3p: Zahlen als Glas-Kacheln in einer Karte; offene Meldungen warten – die Kachel ist gelb.
  check((await page.locator('[data-testid=admin-metrics] [data-waiting="true"]').innerText()).includes("Offene Meldungen"), "V2: offene Meldungen als gelbe Kachel hervorgehoben");
  check((await page.locator("section.plan-panel#admin-overview").count()) === 1 && (await page.locator("section.plan-panel#place-sync").count()) === 1, "V2: Übersicht und Orte-Import als Glas-Karten");
  await shot(alice, "32-admin");
  await page.getByRole("tab", { name: "Meldungen" }).click();
  await page.getByText("Öffnungszeiten am Montag stimmen nicht.").waitFor();
  const reports = page.locator("section#admin-reports");
  check((await reports.getByText("1 offen", { exact: true }).count()) === 1 && (await reports.locator('li[data-status="open"]').count()) === 1, "V2: Meldungen als Glas-Karten, Stand „1 offen“ als Pille");
  await shot(alice, "32-admin-meldungen");
  await page.getByRole("button", { name: "Erledigt" }).click();
  await toast(alice, "Meldung aktualisiert.");
  await reports.getByText("Nichts offen", { exact: true }).waitFor();
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

  {
    // P6: Karte in Discover. Der Kachelserver von OpenStreetMap wird nachgestellt; gezählt wird jede Anfrage.
    const tiles = [];
    let tilesDown = true;
    const TILES = /^https:\/\/tile\.openstreetmap\.org\//;
    await page.route(TILES, (route) => {
      tiles.push(route.request().url());
      // Ausfall als abgebrochene Verbindung (wie im Funkloch) – ein 5xx zählte als Serverfehler des Tests.
      return tilesDown ? route.abort("failed") : route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    });
    await page.getByLabel("Ort oder Aktivität suchen").fill("");
    await page.getByRole("tab", { name: "Karte" }).click();
    const map = page.getByRole("region", { name: "Karte der Orte in Leipzig" });
    // Die Suche wartet 300 ms auf weitere Eingaben – erst wenn die Ergebnisse da sind, steht jeder Ort.
    // P6 Etappe 2: Nahe Orte liegen als Bündel („12“) zusammen; Punkte und Bündel zusammen zählen jeden Ort.
    const mapped = () =>
      page.evaluate(() => {
        const region = document.querySelector('[role="region"][data-zoom]');
        const pins = region.querySelectorAll("[data-map-pin]").length;
        const bundles = [...region.querySelectorAll("[data-map-cluster]")].map((b) => Number(b.dataset.mapCluster));
        return { pins, bundles: bundles.length, places: pins + bundles.reduce((s, n) => s + n, 0) };
      });
    await page.waitForFunction(() => {
      const region = document.querySelector('[role="region"][data-zoom]');
      if (!region) return false;
      const sum = [...region.querySelectorAll("[data-map-cluster]")].reduce((s, b) => s + Number(b.dataset.mapCluster), 0);
      return region.querySelectorAll("[data-map-pin]").length + sum >= 250;
    }, null, { timeout: 15_000 }).catch(() => {});
    const overview = await mapped();
    check(overview.places >= 250, `Karte zeigt alle geladenen Orte mit Standort (${overview.places} Orte in ${overview.pins} Punkten und ${overview.bundles} Bündeln)`);
    check(overview.bundles > 0 && overview.pins + overview.bundles < overview.places / 2, `nahe Orte liegen als Bündel zusammen statt übereinander (${overview.pins + overview.bundles} Zeichen für ${overview.places} Orte)`);
    check(await page.getByText("Tippe auf einen Punkt – der Ort erscheint hier.").isVisible(), "Karte erklärt, was ein Tipp auf einen Punkt tut");
    check(tiles.length === 0, "ohne Einwilligung keine Anfrage an den Kachelserver");
    // P6 Etappe 3: Keine zwei Zeichen (Punkt oder Bündel) überdecken sich.
    const overlaps = await map.evaluate((el) => {
      const boxes = [
        ...[...el.querySelectorAll("[data-map-pin] > span")].map((s) => s.getBoundingClientRect()),
        ...[...el.querySelectorAll("[data-map-cluster]")].map((b) => b.getBoundingClientRect()),
      ].map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }));
      let n = 0;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (Math.hypot(boxes[i].x - boxes[j].x, boxes[i].y - boxes[j].y) < boxes[i].r + boxes[j].r) n++;
      return n;
    });
    check(overlaps === 0, `Karte: keine Punkte oder Bündel übereinander (${overlaps} Überlappungen)`);
    check((await page.getByRole("article").count()) === 0, "Kartenansicht ersetzt Stapel und Liste");
    await map.scrollIntoViewIfNeeded();
    await shot(alice, "33b-discover-karte");

    // Tipp auf ein Bündel holt seine Orte heran – danach liegen dort mehr einzelne Punkte.
    const fitZoom = Number(await map.getAttribute("data-zoom"));
    // Das Bündel nächst der Mitte – am Rand könnten die Zoom-Knöpfe darüber liegen.
    const middle = await map.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const all = [...el.querySelectorAll("[data-map-cluster]")].map((b) => {
        const c = b.getBoundingClientRect();
        return Math.hypot(c.left + c.width / 2 - (r.left + r.width / 2), c.top + c.height / 2 - (r.top + r.height / 2));
      });
      return all.indexOf(Math.min(...all));
    });
    const bundle = map.locator("[data-map-cluster]").nth(middle);
    check(/^\d+ Orte hier – näher heran$/.test((await bundle.getAttribute("aria-label")) ?? ""), "Bündel sagt, wie viele Orte drin sind und was ein Tipp tut");
    await bundle.click();
    const bundleZoom = Number(await map.getAttribute("data-zoom"));
    check(bundleZoom > fitZoom, `Tipp auf ein Bündel zoomt heran (${fitZoom} → ${bundleZoom})`);
    check((await page.getByRole("article").count()) === 0, "Tipp auf ein Bündel wählt keinen einzelnen Ort");
    await shot(alice, "33e-discover-buendel");

    // Zwei Finger: Spreizen zoomt heran, Zusammenführen weiter weg – um die Mitte zwischen den Fingern.
    await page.getByRole("button", { name: "Alle Orte zeigen" }).click();
    const pinchBy = (from, to) =>
      map.evaluate(
        (el, [a, b]) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const fire = (type, id, dx) =>
            el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 11, clientX: cx + dx, clientY: cy, bubbles: true, cancelable: true }));
          fire("pointerdown", 11, -a / 2);
          fire("pointerdown", 12, a / 2);
          for (let i = 1; i <= 6; i++) {
            const d = a + ((b - a) * i) / 6;
            fire("pointermove", 11, -d / 2);
            fire("pointermove", 12, d / 2);
          }
          fire("pointerup", 11, -b / 2);
          fire("pointerup", 12, b / 2);
        },
        [from, to],
      );
    // Zeiger- und Rad-Ereignisse rendert React nicht sofort (anders als Klicks) – auf die neue Zoomstufe warten.
    const zoomLeaves = (from) =>
      page
        .waitForFunction((z) => Number(document.querySelector('[role="region"][data-zoom]')?.dataset.zoom) !== z, from, { timeout: 5_000 })
        .catch(() => {});
    await pinchBy(60, 150);
    await zoomLeaves(fitZoom);
    const pinchIn = Number(await map.getAttribute("data-zoom"));
    check(pinchIn > fitZoom, `zwei Finger spreizen zoomt heran (${fitZoom} → ${pinchIn})`);
    await pinchBy(150, 60);
    await zoomLeaves(pinchIn);
    const pinchOut = Number(await map.getAttribute("data-zoom"));
    check(pinchOut < pinchIn, `zwei Finger zusammenführen zoomt weiter weg (${pinchIn} → ${pinchOut})`);

    // Strg + Mausrad (so meldet sich auch Pinch auf dem Trackpad); ohne Strg scrollt die Seite, die Karte bleibt.
    await page.getByRole("button", { name: "Alle Orte zeigen" }).click();
    const wheel = (ctrlKey) =>
      map.evaluate((el, ctrl) => {
        const r = el.getBoundingClientRect();
        return el.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, ctrlKey: ctrl, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      }, ctrlKey);
    await wheel(false);
    await page.waitForTimeout(300);
    check(Number(await map.getAttribute("data-zoom")) === fitZoom, "Mausrad ohne Strg zoomt die Karte nicht");
    const notCancelled = await wheel(true);
    await zoomLeaves(fitZoom);
    check(Number(await map.getAttribute("data-zoom")) === fitZoom + 1 && notCancelled === false, "Strg + Mausrad zoomt eine Stufe, der Browser zoomt nicht die Seite");

    // Doppeltipp auf freie Fläche (unten links ist am Rand, dort liegt kein Ort): eine Stufe näher.
    await page.getByRole("button", { name: "Alle Orte zeigen" }).click();
    const box = await map.boundingBox();
    await page.mouse.dblclick(box.x + 10, box.y + box.height - 10);
    check(Number(await map.getAttribute("data-zoom")) === fitZoom + 1, "Doppeltipp zoomt eine Stufe näher");
    await page.getByRole("button", { name: "Alle Orte zeigen" }).click();
    check(Number(await map.getAttribute("data-zoom")) === fitZoom, "„Alle Orte zeigen“ passt wieder ein");

    // Ein Ort: Punkt antippen zeigt ihn als Karte darunter, mit Link zur Seite des Ortes.
    await page.getByLabel("Ort oder Aktivität suchen").fill("pub 18");
    // „pub 18“ findet auch „pub 180“ … – entscheidend ist, dass die Karte nur noch die Treffer zeigt.
    await page
      .waitForFunction(() => {
        const pins = [...document.querySelectorAll("[data-map-pin]")];
        return pins.length > 0 && pins.every((p) => p.dataset.mapPin.startsWith("pub 18"));
      }, null, { timeout: 15_000 })
      .catch(() => {});
    const hits = await map.locator("[data-map-pin]").count();
    check(hits >= 1 && hits < 20 && (await map.locator("[data-map-pin]").evaluateAll((pins) => pins.every((p) => p.dataset.mapPin.startsWith("pub 18")))), `Suche gilt auch für die Karte (${hits} Punkte)`);
    const pin = map.locator('[data-map-pin="pub 18"]');
    await pin.click();
    check((await pin.getAttribute("aria-pressed")) === "true", "angetippter Punkt ist gewählt");
    const placeCard = page.getByTestId("place-map").getByRole("article");
    check(await placeCard.getByRole("link", { name: "pub 18", exact: true }).isVisible(), "gewählter Ort erscheint als Karte unter der Karte");

    // Ziehen verschiebt die Karte – der Punkt wandert mit; „Alle Orte zeigen“ holt ihn zurück.
    const before = await pin.boundingBox();
    const frame = await map.boundingBox();
    await page.mouse.move(frame.x + 60, frame.y + frame.height - 60);
    await page.mouse.down();
    await page.mouse.move(frame.x + 100, frame.y + frame.height - 90, { steps: 5 });
    await page.mouse.move(frame.x + 140, frame.y + frame.height - 120, { steps: 5 });
    await page.mouse.up();
    const after = await pin.boundingBox();
    check(Math.abs(after.x - before.x - 80) <= 2 && Math.abs(after.y - before.y + 60) <= 2, `Ziehen verschiebt die Karte (${Math.round(after.x - before.x)}/${Math.round(after.y - before.y)})`);
    check((await pin.getAttribute("aria-pressed")) === "true", "Ziehen wählt keinen anderen Ort");
    await page.getByRole("button", { name: "Alle Orte zeigen" }).click();
    const back = await pin.boundingBox();
    check(Math.abs(back.x - before.x) <= 1 && Math.abs(back.y - before.y) <= 1, "„Alle Orte zeigen“ passt die Karte wieder ein");

    // Stadtplan: erst nach Tipp. Der erste Abruf scheitert (Fehlerzustand), danach kommen die Kacheln.
    check(await page.getByTestId("map-tiles-offer").getByText(/Beim Laden gehen deine IP-Adresse und der Kartenausschnitt dorthin/).isVisible(), "Hinweis, was beim Laden des Stadtplans übertragen wird");
    await page.getByRole("button", { name: "Stadtplan laden" }).click();
    await page.getByText("Stadtplan gerade nicht erreichbar – die Punkte stimmen trotzdem.").waitFor();
    check(true, "Fehlerzustand: Stadtplan nicht erreichbar, Punkte bleiben");
    check(await pin.isVisible(), "Punkte bleiben ohne Stadtplan sichtbar");
    await page.getByRole("button", { name: "Stadtplan aus" }).click();
    tilesDown = false;
    const zoomBefore = Number(await map.getAttribute("data-zoom"));
    await page.getByRole("button", { name: "Näher heran" }).click();
    const zoom = Number(await map.getAttribute("data-zoom"));
    check(zoom === zoomBefore + 1, `„Näher heran“ zoomt eine Stufe (${zoomBefore} → ${zoom})`);
    const requested = tiles.length;
    await page.getByRole("button", { name: "Stadtplan laden" }).click();
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll("img[data-map-tile]")];
      return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
    });
    const loaded = tiles.slice(requested);
    check(loaded.length > 0 && loaded.length <= 30, `Stadtplan lädt nur den sichtbaren Ausschnitt (${loaded.length} Kacheln)`);
    check(loaded.every((u) => new RegExp(`^https://tile\\.openstreetmap\\.org/${zoom}/\\d+/\\d+\\.png$`).test(u)), `Kacheln in der gewählten Zoomstufe (${zoom})`);
    check(!(await page.getByText("Stadtplan gerade nicht erreichbar").isVisible()), "kein Fehlerhinweis mehr, wenn Kacheln da sind");
    check((await map.getByRole("link", { name: "© OpenStreetMap-Mitwirkende" }).getAttribute("href")) === "https://www.openstreetmap.org/copyright", "Namensnennung von OpenStreetMap auf der Karte");
    check(await page.evaluate(() => localStorage.getItem("afterhours.map.tiles")) === "1", "Einwilligung „Stadtplan“ gilt für dieses Gerät");
    await map.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await shot(alice, "33c-discover-stadtplan");
    await page.getByRole("button", { name: "Stadtplan aus" }).click();
    check(await page.evaluate(() => localStorage.getItem("afterhours.map.tiles")) === null, "„Stadtplan aus“ nimmt die Einwilligung zurück");
    check((await page.locator("img[data-map-tile]").count()) === 0, "ohne Einwilligung keine Kacheln mehr");
    await page.unroute(TILES);

    // Smartphone (390 px): Karte ohne Überlauf, ohne Anfrage an den Kachelserver.
    const bobTiles = [];
    await bob.page.route(TILES, (route) => {
      bobTiles.push(route.request().url());
      return route.abort();
    });
    await bob.page.goto(`${APP}/discover`);
    await bob.page.evaluate(() => localStorage.setItem("afterhours.discover.city", "Leipzig"));
    await bob.page.reload();
    await bob.page.waitForFunction(() => document.querySelector('input[aria-label="Stadt"]')?.value === "Leipzig", null, { timeout: 15_000 });
    await bob.page.getByRole("tab", { name: "Karte" }).click();
    await bob.page.getByRole("region", { name: "Karte der Orte in Leipzig" }).locator("[data-map-pin]").first().waitFor();
    await bob.page.getByRole("region", { name: "Karte der Orte in Leipzig" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(bob, "33d-discover-karte");
    check(bobTiles.length === 0, "Smartphone: Karte ohne Anfrage an den Kachelserver");
    await bob.page.getByRole("tab", { name: "Liste" }).click();
    check(await bob.page.evaluate(() => localStorage.getItem("afterhours.discover.view")) === "list", "Ansicht wird auf dem Gerät gemerkt");
    await bob.page.unroute(TILES);

    await page.getByRole("tab", { name: "Liste" }).click();
    await page.getByRole("article").first().waitFor();
    check(true, "zurück zur Liste");
  }

  await page.getByLabel("Ort oder Aktivität suchen").fill("pub 18");
  // P7 Etappe 2: Discover bietet Fotos an, lädt aber ohne Einwilligung nichts.
  await page.getByTestId("photo-offer").waitFor();
  check((await page.getByTestId("photo-offer").innerText()).includes("Zu 1 Ort verweist OpenStreetMap auf ein Foto bei Wikimedia Commons."), "Discover nennt, zu wie vielen Orten es ein Foto gibt");
  check((await page.locator("img[data-commons]").count()) === 0, "ohne Einwilligung kein Commons-Foto in Discover");
  await page.getByRole("link", { name: "pub 18", exact: true }).click();
  await page.getByRole("heading", { name: "Auf einen Blick" }).waitFor();
  check(await page.getByText(/OpenStreetMap-Mitwirkende, Stand/).isVisible(), "Detailseite nennt OSM als Quelle");
  check((await page.getByRole("link", { name: "Eintrag bei OpenStreetMap" }).getAttribute("href")) === "https://www.openstreetmap.org/node/100018", "Link zum OSM-Eintrag");
  check(await page.getByText("Samstag").first().isVisible() && (await page.getByText("12:00–23:00").count()) > 0, "übersetzte Öffnungszeiten als Wochentabelle");
  check(await page.getByText(/Feiertage sind nicht berücksichtigt/).isVisible(), "Hinweis auf Grenzen der OSM-Öffnungszeiten");
  await shot(alice, "34-osm-ort");

  // P7: Foto von Wikimedia Commons. pub 18 hat im OSM-Stellvertreter wikimedia_commons, cinema 11 nur wikidata.
  // Commons, Wikidata und der Bildserver werden hier im Browser nachgestellt; gezählt wird jede Anfrage.
  const wikimedia = [];
  let wikidataDown = true;
  const WIKIMEDIA = /^https:\/\/(commons\.wikimedia\.org|www\.wikidata\.org|upload\.wikimedia\.org)\//;
  const cors = { "Access-Control-Allow-Origin": "*" };
  await page.route(WIKIMEDIA, async (route) => {
    const url = new URL(route.request().url());
    wikimedia.push(url);
    if (url.host === "upload.wikimedia.org") return route.fulfill({ status: 200, contentType: "image/png", body: PNG, headers: cors });
    if (url.host === "www.wikidata.org") {
      // Etappe 2: Discover fragt alle Einträge gesammelt (wbgetentities).
      if (url.searchParams.get("action") === "wbgetentities") {
        const entities = Object.fromEntries((url.searchParams.get("ids") ?? "").split("|").map((id) => [id, id === "Q4711" ? { claims: { P18: [{ rank: "normal", mainsnak: { datavalue: { value: "Cinema 11 Leipzig.jpg" } } }] } } : { claims: {} }]));
        return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ entities }) });
      }
      if (wikidataDown) {
        wikidataDown = false;
        return route.fulfill({ status: 429, contentType: "application/json", body: "{}", headers: cors });
      }
      return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ claims: { P18: [{ rank: "normal", mainsnak: { datavalue: { value: "Cinema 11 Leipzig.jpg" } } }] } }) });
    }
    // Eine oder mehrere Dateien je Anfrage (Discover sammelt bis zu 50 Titel, mit | getrennt).
    const width = url.searchParams.get("iiurlwidth") ?? "960";
    const pages = (url.searchParams.get("titles") ?? "").split("|").map((title) => {
      const file = encodeURIComponent(title.slice(5).replace(/ /g, "_"));
      return { title, imageinfo: [{
        thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/${width}px-${file}`, thumbwidth: Number(width), thumbheight: Math.round(Number(width) * 2 / 3), mime: "image/jpeg",
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
        extmetadata: {
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Lea">Lea <b>Fotografin</b></a>' },
          LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
          AttributionRequired: { value: "true" },
        },
      }] };
    });
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ query: { pages } }) });
  });
  if (DB_URL) {
    const refs = execFileSync("psql", [DB_URL, "-tAc",
      `select string_agg(name || '=' || coalesce(commons_file, '-') || '/' || coalesce(wikidata_id, '-'), ';' order by name) from public.activities where provider_id = 'osm' and city = 'Leipzig' and (commons_file is not null or wikidata_id is not null)`,
    ], { encoding: "utf8" }).trim();
    check(refs === "cinema 11=-/Q4711;pub 18=File:Pub 18 Leipzig.jpg/-;pub 26=File:Pub 26.jpg/-", `Foto-Verweise aus OSM übernommen, ungültige verworfen (${refs})`);
  }
  const showPhoto = page.getByRole("button", { name: "Foto anzeigen" });
  check(await showPhoto.isVisible(), "Ort mit Commons-Verweis bietet „Foto anzeigen“ an");
  check(await page.getByText("Das Foto kommt von Wikimedia Commons. Beim Laden wird deine IP-Adresse dorthin übertragen.").isVisible(), "Hinweis, was beim Laden des Fotos passiert");
  check(wikimedia.length === 0, "ohne Tipp geht keine Anfrage an Wikimedia");
  await showPhoto.click();
  const pubPhoto = page.getByRole("img", { name: "Foto von pub 18" });
  await pubPhoto.waitFor();
  await page.waitForFunction(() => document.querySelector('img[alt="Foto von pub 18"]')?.complete);
  check((await pubPhoto.getAttribute("referrerpolicy")) === "no-referrer", "Foto wird ohne Referrer geladen");
  const credit = page.getByTestId("photo-credit");
  check((await credit.innerText()).replace(/\s+/g, " ").trim() === "Foto: Lea Fotografin · CC BY-SA 4.0 · Wikimedia Commons", `Urheber:in und Lizenz stehen am Foto (${await credit.innerText()})`);
  check((await credit.getByRole("link", { name: "CC BY-SA 4.0" }).getAttribute("href")) === "https://creativecommons.org/licenses/by-sa/4.0", "Lizenz ist verlinkt");
  check((await credit.getByRole("link", { name: "Wikimedia Commons" }).getAttribute("href")) === "https://commons.wikimedia.org/wiki/File:Pub_18_Leipzig.jpg", "Commons-Seite der Datei ist verlinkt");
  check((await credit.locator("b").count()) === 0, "Urheberangabe aus Commons wird als Text dargestellt, nicht als HTML");
  check(wikimedia.every((u) => u.host !== "www.wikidata.org") && wikimedia.some((u) => u.host === "commons.wikimedia.org"), "mit Commons-Datei kein Umweg über Wikidata");
  await shot(alice, "34b-osm-foto");
  await page.getByRole("switch", { name: /Fotos von Orten immer laden/ }).click();
  check(await page.evaluate(() => localStorage.getItem("afterhours.photos.auto")) === "1", "„Fotos immer laden“ gilt für dieses Gerät");

  await page.goto(`${APP}/discover`);
  // Das Feld wird erst gefüllt, wenn das Profil geladen ist.
  await page.waitForFunction(() => document.querySelector('input[aria-label="Stadt"]')?.value, null, { timeout: 15_000 }).catch(() => {});
  check((await page.getByLabel("Stadt", { exact: true }).inputValue()) === "Leipzig", "Discover merkt sich die zuletzt gewählte Stadt");
  {
    // P7 Etappe 2: Mit „immer laden“ zeigen auch die Karten in Discover das Foto, mit Urheber:in und Lizenz.
    await page.getByLabel("Ort oder Aktivität suchen").fill("pub 18");
    const pubCard = page.getByRole("article").filter({ has: page.getByRole("link", { name: "pub 18", exact: true }) });
    const cardPhoto = pubCard.locator("img[data-commons]");
    await cardPhoto.waitFor();
    const src = await cardPhoto.getAttribute("src");
    check(src.startsWith("https://upload.wikimedia.org/") && src.includes("/640px-"), `Discover-Karte zeigt das Commons-Foto in Kartengröße (${src})`);
    check((await cardPhoto.getAttribute("referrerpolicy")) === "no-referrer", "Kartenfoto ohne Referrer");
    const cardCredit = pubCard.getByTestId("card-photo-credit");
    check((await cardCredit.innerText()).trim() === "Foto: Lea Fotografin · CC BY-SA 4.0", `Urheber:in und Lizenz stehen auf der Karte (${await cardCredit.innerText()})`);
    check((await cardCredit.getAttribute("href")) === "https://commons.wikimedia.org/wiki/File:Pub_18_Leipzig.jpg", "Bildangabe führt zur Datei bei Commons");
    check(!(await page.getByTestId("photo-offer").isVisible()), "mit Einwilligung kein Foto-Angebot mehr");
    await page.waitForFunction(() => [...document.querySelectorAll("img[data-commons]")].every((img) => img.complete));
    await shot(alice, "35-discover-fotos");

    await page.getByLabel("Ort oder Aktivität suchen").fill("cinema 11");
    const cinemaCard = page.getByRole("article").filter({ has: page.getByRole("link", { name: "cinema 11", exact: true }) });
    await cinemaCard.locator("img[data-commons]").waitFor();
    const discoverWikidata = wikimedia.filter((u) => u.host === "www.wikidata.org");
    check(discoverWikidata.length > 0 && discoverWikidata.every((u) => u.searchParams.get("action") === "wbgetentities"), "Discover fragt Wikidata gesammelt, nicht je Ort");
    check(discoverWikidata.some((u) => (u.searchParams.get("ids") ?? "").split("|").includes("Q4711")), "Karte ohne Commons-Datei bekommt das Bild des Wikidata-Eintrags");
    check(wikimedia.filter((u) => u.host === "commons.wikimedia.org" && u.searchParams.get("iiurlwidth") === "640").length <= 4, "Fotos für Discover kommen mit wenigen Sammelabfragen");
  }
  await page.getByRole("link", { name: "cinema 11", exact: true }).click();
  await page.getByText("Laut OpenStreetMap (Originalangabe):").waitFor();
  check(await page.getByText("Mo-Fr 18:00+").isVisible(), "nicht übersetzbare Öffnungszeiten erscheinen im Original");
  // P7: Mit „immer laden“ kommt das Foto ohne Tipp – hier über Wikidata (P18). Der erste Abruf scheitert.
  await page.getByText("Foto gerade nicht abrufbar").waitFor();
  check(true, "Fehlerzustand: Foto gerade nicht abrufbar");
  await page.getByRole("button", { name: "Nochmal" }).click();
  await page.getByRole("img", { name: "Foto von cinema 11" }).waitFor();
  check(wikimedia.some((u) => u.host === "www.wikidata.org" && u.searchParams.get("entity") === "Q4711" && u.searchParams.get("property") === "P18"), "ohne Commons-Datei kommt das Foto über das Bild des Wikidata-Eintrags");
  check(await page.getByTestId("photo-credit").getByRole("link", { name: "Wikimedia Commons" }).isVisible(), "auch dann mit Quelle und Lizenz");
  await page.getByRole("switch", { name: /Fotos von Orten immer laden/ }).click();
  await page.reload();
  await page.getByRole("button", { name: "Foto anzeigen" }).waitFor();
  check(true, "„Fotos immer laden“ lässt sich wieder ausschalten");
  await page.unroute(WIKIMEDIA);
  {
    // Smartphone (390 px): Foto-Angebot ohne Überlauf; Bob hat nichts eingeschaltet, also keine Anfrage.
    const bobWikimedia = [];
    await bob.page.route(WIKIMEDIA, (route) => {
      bobWikimedia.push(route.request().url());
      return route.abort();
    });
    await bob.page.goto(page.url());
    await bob.page.getByRole("button", { name: "Foto anzeigen" }).waitFor();
    await shot(bob, "34c-osm-foto-angebot");
    // Discover auf 390 px: Angebot „Fotos zeigen“ ohne Überlauf, weiter ohne Anfrage.
    await bob.page.evaluate(() => localStorage.setItem("afterhours.discover.city", "Leipzig"));
    await bob.page.goto(`${APP}/discover`);
    await bob.page.waitForFunction(() => document.querySelector('input[aria-label="Stadt"]')?.value === "Leipzig", null, { timeout: 15_000 });
    await bob.page.getByLabel("Ort oder Aktivität suchen").fill("pub 18");
    await bob.page.getByTestId("photo-offer").waitFor();
    await shot(bob, "35b-discover-foto-angebot");
    check(bobWikimedia.length === 0, "Smartphone: ohne Tipp keine Anfrage an Wikimedia");
    await bob.page.unroute(WIKIMEDIA);
  }

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
  check(await page.getByText("Live nur während eines Plans").isVisible(), "P13: Einstellungen sagen ehrlich, dass Live-Standort nur rund um einen Plan geht");
  // V2 Etappe 3k: Bereiche als Glas-Karten mit Farbschein, Stand als Pille, Sprung-Pillen oben.
  const tones = await page.locator("main section.plan-panel").evaluateAll((els) => els.map((el) => `${el.id}:${el.dataset.tone}`));
  check(tones.join(",") === "profile:violet,birthday:pink,absences:violet,language:lime,preferences:pink,location:violet,notifications:pink,calendar:lime,account:violet", `Einstellungen: neun Glas-Karten mit Farbschein (${tones.join(", ")})`);
  check((await page.getByTestId("location-status").innerText()).trim() === "Aus", "Standort-Pille sagt „Aus“");
  check((await page.getByTestId("calendar-status").innerText()).trim() === "Kein Abo", "Kalender-Pille: „Kein Abo“");
  const jump = page.getByRole("navigation", { name: "Bereiche der Einstellungen" });
  check((await jump.getByRole("link").count()) === 9, "neun Sprung-Pillen");
  await jump.getByRole("link", { name: "Kalender-Abo" }).click();
  await page.waitForURL(/#calendar$/);
  check(true, "Sprung-Pille führt zum Kalender-Abo");
  check(await page.getByTestId("account-danger").isVisible(), "Konto löschen steht in der Gefahrenzone");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Einstellungen ohne seitliches Scrollen");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(bob, "27-einstellungen");
  const statusBefore = (await page.getByTestId("notifications-status").innerText()).trim();
  await page.getByRole("switch", { name: "Neue Abstimmungen" }).click();
  await toast(bob, "Benachrichtigungen gespeichert.");
  const statusAfter = (await page.getByTestId("notifications-status").innerText()).trim();
  check(statusBefore !== statusAfter && /^(\d+ von \d+ an|Alle (an|aus))$/.test(statusAfter), `Benachrichtigungs-Pille zählt mit (${statusBefore} → ${statusAfter})`);
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

await step("P11 – Englische Oberfläche: Sprache wählen, Texte, Formate, zurück auf Deutsch (Bob)", async () => {
  const { page } = bob;
  // P11 Etappe 2f: Der Import speichert Merkmale statt nur des deutschen Satzes; auf Deutsch bleibt der Satz gleich.
  const placeRow = ANON ? (await api(bob, "GET", "activities?select=id,features&provider_id=eq.osm&name=eq.restaurant%200")).json?.[0] : null;
  if (placeRow) {
    check(placeRow.features?.cuisine?.join(",") === "italian,pizza" && placeRow.features?.outdoor_seating === true, `Merkmale aus OSM gespeichert (${JSON.stringify(placeRow.features)})`);
    await page.goto(`${APP}/activities/${placeRow.id}`);
    await page.getByText("Küche: Italienisch, Pizza. Außenplätze.", { exact: true }).waitFor();
    check(true, "Ortsbeschreibung auf Deutsch wie bisher");
  }
  await page.goto(`${APP}/settings#language`);
  const card = page.locator("section#language");
  await card.getByRole("heading", { name: "Sprache" }).waitFor();
  check((await card.getByRole("button", { name: "Deutsch" }).getAttribute("aria-pressed")) === "true", "Deutsch ist bei deutschem Browser gewählt");
  check((await page.evaluate(() => document.documentElement.lang)) === "de", "<html lang> ist de");
  await Promise.all([page.waitForEvent("load"), card.getByRole("button", { name: "English" }).click()]);
  await page.getByRole("heading", { name: "Settings", level: 1 }).waitFor();
  check(true, "nach dem Wechsel: Einstellungen auf Englisch");
  check((await page.evaluate(() => document.documentElement.lang)) === "en", "<html lang> ist en");
  check((await page.evaluate(() => localStorage.getItem("afterhours.locale"))) === "en", "Wahl gilt für dieses Gerät (localStorage)");
  const en = page.locator("section#language");
  check((await en.getByRole("button", { name: "English" }).getAttribute("aria-pressed")) === "true", "English ist jetzt gewählt");
  check(await en.getByText("Not everything is translated", { exact: false }).isVisible(), "ehrlicher Hinweis, was noch deutsch ist");
  // P11 Etappe 2a: Die Wahl steht auch im Profil (für Kalender-Abo, Push und neue Geräte).
  if (ANON) {
    const saved = await api(bob, "GET", "user_settings?select=locale");
    check(saved.json?.[0]?.locale === "en", `Sprache im Profil: en (${JSON.stringify(saved.json)})`);
    check([401, 403].includes((await api(null, "POST", "rpc/set_my_locale", { p_locale: "de" })).status), "API: ohne Konto keine Sprache setzen (401/403)");
    const direct = await api(bob, "PATCH", "user_settings?user_id=not.is.null", { locale: "de" });
    check(direct.status >= 400, `API: Sprache nicht direkt änderbar (${direct.status})`);
    check((await api(bob, "POST", "rpc/set_my_locale", { p_locale: "fr" })).json?.message === "invalid_locale", "API: unbekannte Sprache abgewiesen");
    // P11 Etappe 2d: Auth-E-Mails kommen in der Sprache des Kontos (set_my_locale schreibt sie in die Metadaten).
    const mailsBefore = await mailCount(bob.email);
    const recover = await fetch(`${API}/auth/v1/recover`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: bob.email }) });
    check(recover.ok, `Passwort-Mail für Bob angefordert (${recover.status})`);
    const resetMail = await lastMail(bob.email, mailsBefore);
    if (resetMail) {
      check(resetMail.Subject === "Set a new password for AFTERHOURS", `Passwort-Mail: Betreff auf Englisch (${resetMail.Subject})`);
      const html = String(resetMail.HTML ?? "");
      check(/<html lang="en">/.test(html) && /Use the button to set a new password/.test(html) && !/Neues Passwort|\{\{/.test(html), "Passwort-Mail: Text auf Englisch, keine Vorlagen-Reste");
    }
    // Neues Gerät ohne eigene Wahl (deutscher Browser) übernimmt die Sprache des Kontos.
    const state = await bob.context.storageState();
    for (const origin of state.origins) origin.localStorage = origin.localStorage.filter((entry) => entry.name !== "afterhours.locale");
    const device = await browser.newContext({ viewport: VIEWPORTS.mobile, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block", storageState: state });
    try {
      const fresh = await device.newPage();
      fresh.on("pageerror", (e) => problems.push(`[Bob, neues Gerät] pageerror: ${e}`));
      await fresh.goto(`${APP}/settings#language`);
      await fresh.getByRole("heading", { name: "Settings", level: 1 }).waitFor({ timeout: 20_000 });
      check((await fresh.evaluate(() => localStorage.getItem("afterhours.locale"))) === "en", "neues Gerät übernimmt Englisch aus dem Profil");
      check((await fresh.evaluate(() => document.documentElement.lang)) === "en", "neues Gerät: <html lang> ist en");
    } finally {
      await device.close();
    }
  }
  check(await page.getByRole("heading", { name: "Location sharing" }).isVisible(), "andere Bereiche ebenfalls englisch");
  await a11y(bob, "Settings (English)");
  await noOverflow(bob, "Settings (English)");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(bob, "27b-einstellungen-englisch");
  // Home und Navigation auf Englisch; Datum ohne „Uhr“.
  await page.goto(`${APP}/plans`);
  await page.getByRole("navigation", { name: "Main navigation" }).first().waitFor();
  await page.locator("main h1").first().waitFor();
  const body = await page.locator("main").innerText();
  check(!/\bUhr\b/.test(body), "Pläne auf Englisch ohne „Uhr“");
  check(!/\b(Abstimmung|Bin dabei|Vielleicht)\b/.test(body), "Pläne ohne deutsche Antwort-Texte");
  await shot(bob, "27c-plaene-englisch");
  // Ein-Satz-Abstimmung versteht Englisch.
  await page.goto(`${APP}/home`);
  await page.getByRole("button", { name: "What's on?" }).click();
  const sheet = page.getByRole("dialog", { name: "One sentence is enough." });
  await sheet.getByLabel("What, when, where – like in the chat").fill("bowling or cinema, fri or sat, 8 pm");
  const chips = sheet.getByRole("list", { name: "This becomes" });
  for (const chip of ["Bowling", "Cinema", "20:00"]) await chips.getByText(chip, { exact: true }).waitFor();
  check((await chips.getByRole("listitem").count()) === 5, "Ein-Satz-Abstimmung zerlegt den englischen Satz: 2 Aktivitäten, 2 Tage, 1 Uhrzeit");
  await sheet.getByText("What's on at the weekend?").waitFor();
  await shot(bob, "27d-ein-satz-englisch");
  await page.keyboard.press("Escape");
  // P11 Etappe 2f: Ortsbeschreibung aus OSM auf Englisch, ohne deutschen Satz.
  if (placeRow) {
    await page.goto(`${APP}/activities/${placeRow.id}`);
    await page.getByText("Cuisine: Italian, Pizza. Outdoor seating.", { exact: true }).waitFor();
    const placeText = await page.locator("main").innerText();
    check(!/Küche|Außenplätze|Italienisch/.test(placeText), "Ortsbeschreibung auf Englisch, kein deutscher Satz");
    await noOverflow(bob, "Place (English)");
    await shot(bob, "27f-ort-englisch");
  }
  // P11 Etappe 2e: „Stichwahl: …“ erscheint auf Englisch als „Runoff: …“.
  if (ids.runoff) {
    await page.goto(`${APP}/polls/${ids.runoff}`);
    await page.getByRole("heading", { name: "Runoff: Pizza oder Sushi?" }).waitFor();
    check(true, "Stichwahl heißt auf Englisch „Runoff: …“");
  }
  // P11 Etappe 2b: Auf Englisch geteilt → Link mit ?lang=en, Vorschau im Gruppenchat auf Englisch.
  const planShareToken = page.waitForResponse((r) => r.url().includes("/rpc/plan_share_token") && r.ok(), { timeout: 10_000 }).catch(() => undefined);
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.getByRole("button", { name: "Share plan" }).waitFor();
  await planShareToken;
  await stubShare(page);
  await page.getByRole("button", { name: "Share plan" }).click();
  const sharedEn = (await sharedData(page))[0];
  check(/\/s\/[0-9a-f]{32}\?lang=en$/.test(sharedEn?.url ?? ""), `englisch geteilt: Link mit ?lang=en (${sharedEn?.url})`);
  check(/Are you in\?$/.test(sharedEn?.text ?? ""), "englisch geteilt: Text auf Englisch");
  if (ANON && sharedEn?.url) {
    const head = (await (await handleShare(new Request(sharedEn.url), { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: ANON }, fetch)).text()).split("</head>")[0];
    check(head.includes('<meta property="og:locale" content="en_GB" />'), "Vorschau: og:locale en_GB");
    const description = /<meta property="og:description" content="([^"]*)" \/>/.exec(head)?.[1] ?? "";
    check(/Are you in\?|Over – that was/.test(description) && !/Bist du dabei|Vorbei|\bUhr\b/.test(description), `Vorschau im Messenger auf Englisch (${description})`);
  }
  // P11 Etappe 2c: Termine von „Wann könnt ihr?“ auf Englisch („Sunday 8 November“ statt „Sonntag, 8. November“).
  if (ids.datePoll) {
    const enLabel = (date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`)).replace(",", "");
    const [e1, e2] = ids.datePoll.dates.map(enLabel);
    await page.goto(`${APP}/polls/${ids.datePoll.id}`);
    await page.getByRole("heading", { name: e1, exact: true }).first().waitFor();
    check(await page.getByRole("heading", { name: e2, exact: true }).first().isVisible(), `Termine auf Englisch (${e1}, ${e2})`);
    const pollText = await page.locator("main").innerText();
    check(!ids.datePoll.labels.some((label) => pollText.includes(label)), "keine deutschen Termin-Titel mehr auf der Abstimmung");
    await noOverflow(bob, "Date poll (English)");
    await shot(bob, "27e-termine-englisch");
  }
  // Zurück auf Deutsch.
  await page.goto(`${APP}/settings#language`);
  await Promise.all([page.waitForEvent("load"), page.locator("section#language").getByRole("button", { name: "Deutsch" }).click()]);
  await page.getByRole("heading", { name: "Einstellungen", level: 1 }).waitFor();
  check((await page.evaluate(() => document.documentElement.lang)) === "de", "zurück auf Deutsch");
  if (ANON) check((await api(bob, "GET", "user_settings?select=locale")).json?.[0]?.locale === "de", "Sprache im Profil wieder de");
});

// P11: Startseite folgt der Browser-Sprache; der Sprachlink wechselt ohne Konto.
await step("P11 – Startseite mit englischem Browser und Sprachlink (Gast)", async () => {
  const context = await browser.newContext({ viewport: VIEWPORTS.mobile, locale: "en-GB", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`[Gast-en] pageerror: ${e}`));
  try {
    await page.goto(`${APP}/`);
    await page.getByRole("link", { name: "Start a crew" }).first().waitFor();
    check(true, "englischer Browser: Startseite auf Englisch");
    check((await page.evaluate(() => document.documentElement.lang)) === "en", "<html lang> ist en");
    const demo = await page.locator("figure").first().innerText();
    check(/Bowling/.test(demo) && /Cinema/.test(demo), "Satz-Probe zerlegt den englischen Beispielsatz");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "02b-startseite-englisch.png"), fullPage: false });
    // F7: Datenschutz-Texte liegen nicht im Start-Bundle – sie kommen beim Wechsel auf die Seite, auf Englisch.
    await page.getByRole("link", { name: "Privacy", exact: true }).first().click();
    await page.getByRole("heading", { level: 1, name: /Privacy and your data/i }).waitFor();
    check((await page.getByText("No tracking").count()) >= 1, "F7: Datenschutz-Seite lädt ihre Texte nach – auf Englisch");
    await page.goBack();
    await page.getByRole("link", { name: "Start a crew" }).first().waitFor();
    await Promise.all([page.waitForEvent("load"), page.getByTestId("language-link").click()]);
    await page.getByRole("link", { name: "Crew gründen" }).first().waitFor();
    check((await page.evaluate(() => document.documentElement.lang)) === "de", "Sprachlink wechselt auf Deutsch");
  } finally {
    await context.close();
  }
});

// P11 Etappe 2d: Wer sich mit englischem Browser registriert, bekommt die Bestätigung auf Englisch.
await step("P11 Etappe 2d – Bestätigungs-E-Mail auf Englisch (Registrierung mit englischem Browser)", async () => {
  const context = await browser.newContext({ viewport: VIEWPORTS.mobile, locale: "en-GB", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`[Erin-en] pageerror: ${e}`));
  const email = `erin.${RUN}@example.com`;
  try {
    await page.goto(`${APP}/register`);
    await page.getByLabel("Display name").fill("Erin");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("I'm at least 16 years old.").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/(check-email|onboarding)/);
    const mail = await lastMail(email);
    if (!mail) {
      console.log("   (kein Postfach erreichbar – Sprache der Bestätigungs-E-Mail nicht geprüft)");
      return;
    }
    check(mail.Subject === "Confirm your email address for AFTERHOURS", `Bestätigung: Betreff auf Englisch (${mail.Subject})`);
    const html = String(mail.HTML ?? "");
    check(/<html lang="en">/.test(html) && /Almost there/.test(html) && /Confirm email address/.test(html) && !/Fast geschafft|\{\{/.test(html), "Bestätigung: Text auf Englisch, keine Vorlagen-Reste");
    check(/\/auth\/v1\/verify|\/auth\/confirm/.test(html), "Bestätigung enthält den Link");
    // Gegenprobe: Alice hat sich mit deutschem Browser registriert – ihre Bestätigung ist deutsch.
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${alice.email}`)}`)).json();
    const subjects = (list.messages ?? []).map((m) => m.Subject);
    check(subjects.includes("Bestätige deine E-Mail-Adresse für AFTERHOURS"), `Alices Bestätigung bleibt deutsch (${subjects.join(" | ")})`);
  } finally {
    await context.close();
  }
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
  check((await card.getByTestId("calendar-status").innerText()).trim() === "Abo läuft", "Kalender-Pille: „Abo läuft“ in Lime");
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
    // P11 Etappe 2a: Der Kalender kommt in der Sprache aus Bobs Profil (Deutsch).
    check((await api(null, "POST", "rpc/calendar_feed_events", { p_token: link.match(/[0-9a-f]{64}/)[0] })).json?.locale === "de", "Kalender: Sprache aus dem Profil (de)");
    check(ics.includes("PRODID:-//AFTERHOURS//Kalender-Abo//DE"), "Kalender: deutscher Kalender");
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
  const resetMail = await lastMail(alice.email, before);
  if (resetMail) check(resetMail.Subject === "Neues Passwort für AFTERHOURS festlegen" && /<html lang="de">/.test(String(resetMail.HTML ?? "")), `Passwort-Mail ohne Englisch im Konto: deutsch (${resetMail.Subject})`);
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
  await stepArt(page, 1, "Start Crew");
  await shot(dana, "37-start-crew");

  await page.getByLabel("Name der Crew").fill("Freitagsrunde");
  await page.getByRole("radio", { name: "🎳" }).click();
  // V2 Etappe 3m: Vorschau der Crew wächst beim Tippen mit; eine neue Crew hat noch keine Farbwelt.
  const crewPreview = page.getByTestId("crew-form-preview");
  check((await crewPreview.innerText()).includes("Freitagsrunde") && (await crewPreview.innerText()).includes("🎳"), "Crew gründen: Vorschau zeigt Name und Symbol");
  check((await crewPreview.getAttribute("data-world")) === null, "Crew gründen: Vorschau verspricht keine Farbe, bevor es die Crew gibt");
  await noOverflow(dana, "Crew gründen");
  await page.getByRole("button", { name: "Crew gründen" }).click();
  await page.getByRole("heading", { level: 1, name: "Hol deine Leute dazu" }).waitFor();
  check(/\/start\?crew=[0-9a-f-]{36}$/.test(page.url()), "Schritt 1: Crew gegründet, der Stand steht in der Adresse");
  const crewId = new URL(page.url()).searchParams.get("crew");
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Hol deine Leute dazu" }).waitFor();
  check(true, "Neuladen bleibt in Schritt 2");
  await stepArt(page, 2, "Start Einladen");

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
  // D3 Etappe 2b: Ohne Plan zeigt Home am Abend, was gerade offen hat. Dana hat noch keinen Plan; auf einer
  // eigenen Seite steht die Uhr im Browser auf 19:30 Uhr Berliner Zeit (nächstgelegener Tag) – die echte Seite läuft weiter.
  {
    const realNow = Date.now();
    const berlinParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(realNow);
    const berlinHour = Number(berlinParts.find((part) => part.type === "hour").value);
    const berlinMinute = Number(berlinParts.find((part) => part.type === "minute").value);
    let shiftHours = 19.5 - (berlinHour + berlinMinute / 60);
    if (shiftHours > 12) shiftHours -= 24;
    if (shiftHours < -12) shiftHours += 24;
    // Die Uhr gilt für den ganzen Browser-Kontext – deshalb ein eigener Kontext mit Danas Anmeldung.
    const eveningContext = await browser.newContext({ viewport: VIEWPORTS.mobile, deviceScaleFactor: 2, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block", storageState: await context.storageState() });
    const evening = await eveningContext.newPage();
    evening.setDefaultTimeout(15_000);
    evening.on("pageerror", (e) => problems.push(`[Dana, Abend] pageerror: ${e}`));
    await evening.clock.setFixedTime(new Date(realNow + shiftHours * 3600_000));
    const eveningUser = { ...dana, page: evening };
    await evening.goto(`${APP}/home`);
    const ideas = evening.getByTestId("tonight-ideas");
    await ideas.waitFor();
    check((await ideas.getByRole("heading", { level: 2 }).innerText()).trim().toLowerCase() === "heute abend", "D3 2b: ohne Plan steht am Abend „Heute Abend“ auf Home");
    const section = ideas.getByTestId("open-now");
    await section.waitFor();
    await evening.waitForFunction(() => !document.querySelector('[data-testid="tonight-ideas"] [data-testid="open-now"][aria-busy]'), null, { timeout: 30_000 });
    check((await section.getByRole("heading", { level: 3 }).count()) === 1, "D3 2b: Überschrift der Orte unter „Heute Abend“ ist h3");
    const text = (await section.innerText()).replace(/\s+/g, " ");
    const rows = section.getByTestId("open-now-place");
    const n = await rows.count();
    check(n <= 3, `D3 2b: höchstens drei Orte (${n})`);
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const rowText = (await row.innerText()).replace(/\s+/g, " ");
      if ((await row.getAttribute("data-open")) === "true") check(/Geöffnet bis \d\d:\d\d Uhr/.test(rowText), `D3 2b: offener Ort nennt, bis wann („${rowText}“)`);
      else check(/Öffnungszeiten/.test(rowText) && !/Geschlossen/.test(rowText), `D3 2b: Ort ohne bekannte Öffnungszeiten ist so beschriftet („${rowText}“)`);
      const href = await row.getByRole("link", { name: /^Plan hier/ }).getAttribute("href");
      check(/^\/plans\/new\?activity=[^&]+&soon=1$/.test(href ?? ""), `D3 2b: „Plan hier“ mit Ort und „gleich“, Crew im Formular (${href})`);
    }
    if (n > 0) check(text.includes("Öffnungszeiten laut OpenStreetMap"), "D3 2b: Quelle der Öffnungszeiten steht dabei");
    else check(/Wähl in Discover deine Stadt|hat laut OpenStreetMap gerade nichts Passendes offen|noch keine Orte geladen/.test(text), `D3 2b: ohne Orte ein ehrlicher Hinweis („${text}“)`);
    check(!/Geschlossen/.test(text), "D3 2b: keine geschlossenen Orte");
    await shot(eveningUser, "40b-home-heute-abend-ohne-plan");
    // Fehlerzustand: lassen sich die Orte nicht laden, steht das da – mit „Erneut versuchen“.
    await evening.route("**/rest/v1/rpc/search_activities**", (route) => route.abort("failed"));
    await evening.reload();
    await ideas.getByText("Orte gerade nicht abrufbar.").waitFor({ timeout: 30_000 });
    check(true, "D3 2b: Fehlerzustand mit ehrlichem Hinweis");
    await evening.unrouteAll();
    // „Heute ausblenden“ gilt für den Tag auf diesem Gerät – auch nach dem Neuladen.
    await ideas.getByRole("button", { name: "Heute ausblenden" }).click();
    await ideas.waitFor({ state: "detached" });
    await evening.reload();
    await evening.getByRole("heading", { level: 1 }).waitFor();
    await evening.waitForTimeout(500);
    check((await evening.getByTestId("tonight-ideas").count()) === 0, "D3 2b: „Heute ausblenden“ hält bis morgen");
    await evening.evaluate(() => localStorage.removeItem("afterhours.tonight.hidden"));
    // Um 14 Uhr ist es noch zu früh.
    await evening.clock.setFixedTime(new Date(realNow + (shiftHours - 5.5) * 3600_000));
    await evening.reload();
    await evening.getByRole("heading", { level: 1 }).waitFor();
    await evening.waitForTimeout(500);
    check((await evening.getByTestId("tonight-ideas").count()) === 0, "D3 2b: am Nachmittag (14 Uhr) noch kein „Heute Abend“");
    await eveningContext.close();
  }
  // D3 Etappe 1: Live-Countdown auf dem großen Ticket – Danas erster Plan beginnt in gut zwei Stunden.
  if (ANON) {
    const startsAt = new Date(Date.now() + 134 * 60_000 + 20_000);
    // D3 Etappe 2a: mit Ort aus Discover (Wetter) und Treffpunkt – beides steht dann unter dem Ticket.
    const bowlingId = (await api(dana, "GET", `activities?select=id&name=eq.${encodeURIComponent("Strike District Bowling")}&limit=1`)).json?.[0]?.id ?? null;
    check(Boolean(bowlingId), "D3: Dana findet die Bowlingbahn aus Discover");
    const created = await api(dana, "POST", "rpc/create_plan", {
      p_crew_id: crewId, p_title: "Kicker im Hof", p_starts_at: startsAt.toISOString(), p_activity_id: bowlingId, p_address: null, p_meeting_point: "Am Eingang",
      p_notes: null, p_cost_per_person_cents: null, p_total_cost_cents: null, p_ends_at: null, p_confirmed: true,
    });
    check(created.status < 300, `Dana legt einen Plan in gut zwei Stunden an (${created.status})`);
    await page.goto(`${APP}/home`);
    const live = page.locator(".ticket-feature").getByTestId("ticket-live");
    await live.waitFor();
    const liveText = (await live.textContent()).trim();
    check(/^Noch 2:1[45] h$/.test(liveText), `D3: das große Ticket auf Home zählt live herunter („${liveText}“)`);
    // D3 Etappe 2a: „Heute Abend“-Leiste unter dem Ticket – Wetter zur Planzeit am Ort und Treffpunkt.
    const strip = page.getByTestId("tonight-strip");
    await strip.waitFor();
    const stripTitle = (await strip.getByRole("heading", { level: 2 }).innerText()).trim().toLowerCase();
    check(["heute nacht", "heute abend", "heute", "morgen"].includes(stripTitle), `D3: Leiste heißt nach der Tageszeit des Plans („${stripTitle}“)`);
    check((await strip.getByTestId("tonight-meeting").innerText()).trim() === "Am Eingang", "D3: Treffpunkt steht unter dem Ticket");
    const tonightWeather = strip.getByTestId("tonight-weather");
    await tonightWeather.waitFor();
    const weatherText = (await tonightWeather.textContent()).replace(/\s+/g, " ").trim();
    check(weatherText === "14 °C Regen", `D3: Wetter zur Planzeit am Ort (${weatherText})`);
    check(await strip.getByText("70 % Regen · Wind 12 km/h").isVisible(), "D3: Regenrisiko und Wind in der Leiste");
    check((await strip.getByRole("link", { name: /^Open-Meteo, Stand \d{2}:\d{2} Uhr$/ }).count()) === 1, "D3: Quelle der Vorhersage mit Stand");
    check((await strip.getByText(/Plan B/).count()) === 0, "D3: drinnen kein Draußen-Hinweis");
    // Fehlerzustand: ohne Wetter-Function steht das ehrlich da, „Erneut versuchen“ lädt nach.
    await page.route("**/functions/v1/weather", (route) => route.abort());
    await page.reload();
    await strip.getByTestId("tonight-weather-error").waitFor();
    check((await strip.getByTestId("tonight-weather").count()) === 0, "D3: ohne Vorhersage keine erfundenen Werte");
    await page.unroute("**/functions/v1/weather");
    await strip.getByRole("button", { name: "Erneut versuchen" }).click();
    await strip.getByTestId("tonight-weather").waitFor();
    check(true, "D3: „Erneut versuchen“ lädt das Wetter in der Leiste");
    // P14 Etappe 2: „Mitbringen“ in der Leiste – was Dana mitbringt, was noch fehlt, mit einem Tipp übernehmen.
    const kicker = created.json;
    check((await strip.getByTestId("tonight-bring").count()) === 0, "P14: ohne Mitbring-Liste keine Kachel in der Leiste");
    for (const [label, claim] of [["Ball", true], ["Getränke", false], ["Chips", false], ["Becher", false], ["Musikbox", false]]) {
      const added = await api(dana, "POST", "rpc/add_plan_item", { p_plan_id: kicker, p_label: label, p_claim: claim });
      check(added.status < 300, `P14: „${label}“ steht auf Danas Liste (${added.status})`);
    }
    await page.reload();
    const bring = strip.getByTestId("tonight-bring");
    await bring.waitFor();
    check((await bring.getByTestId("tonight-bring-mine").innerText()).trim() === "Du bringst: Ball", "P14: Leiste zeigt, was Dana mitbringt");
    check((await bring.getByRole("button", { name: /bringe ich mit$/ }).count()) === 3, "P14: höchstens drei offene Sachen zum Antippen");
    check((await bring.getByRole("link", { name: "+1 weitere" }).getAttribute("href")) === `/plans/${kicker}#mitbringen`, "P14: der Rest als Link zur Liste auf der Planseite");
    await bring.getByRole("button", { name: "Getränke bringe ich mit" }).click();
    await toast(dana, "Danke – du bringst Getränke mit.");
    await bring.getByText("Du bringst: Ball, Getränke").waitFor();
    check((await bring.getByRole("button", { name: /bringe ich mit$/ }).count()) === 3, "P14: die nächste offene Sache rückt nach");
    check((await bring.getByRole("link", { name: /weitere$/ }).count()) === 0, "P14: alles Offene passt jetzt in die Leiste");
    // Fehlerzustand: ohne Liste ein ehrlicher Hinweis, „Erneut versuchen“ lädt nach.
    await page.route("**/rest/v1/plan_items*", (route) => route.abort());
    await page.reload();
    const bringError = strip.getByTestId("tonight-bring-error");
    await bringError.waitFor({ timeout: 30_000 });
    check((await strip.getByTestId("tonight-bring").count()) === 0, "P14: ohne Liste keine erfundenen Einträge");
    await page.unroute("**/rest/v1/plan_items*");
    await bringError.locator("..").getByRole("button", { name: "Erneut versuchen" }).click();
    await bring.getByText("Du bringst: Ball, Getränke").waitFor();
    check(true, "P14: „Erneut versuchen“ lädt die Mitbring-Liste in der Leiste");
    // P24 Etappe 3: Zusatz zur Antwort in der Leiste („Dazu geschrieben“) und unter dem großen Ticket.
    check((await strip.getByTestId("tonight-notes").count()) === 0, "P24: ohne Zusatz keine Kachel in der Leiste");
    check((await api(dana, "POST", "rpc/set_attendance", { p_plan_id: kicker, p_status: "going" })).status < 300, "P24: Dana ist dabei");
    const noted = await api(dana, "POST", "rpc/set_plan_answer_note", { p_plan_id: kicker, p_note: "Komme mit dem Rad" });
    check(noted.status < 300 && noted.json === "Komme mit dem Rad", `P24: Dana schreibt einen Zusatz (${noted.status})`);
    await page.reload();
    const tonightNotes = strip.getByTestId("tonight-notes");
    await tonightNotes.waitFor();
    check((await tonightNotes.locator("li").allInnerTexts()).map((x) => x.trim()).join("|") === "Du: „Komme mit dem Rad“", "P24: Leiste zeigt den eigenen Zusatz");
    check((await page.locator(".ticket-feature-wrap").first().getByTestId("ticket-note").innerText()).trim() === "Dein Zusatz: „Komme mit dem Rad“", "P24: Zusatz unter dem großen Ticket");
    await tonightNotes.scrollIntoViewIfNeeded();
    await noOverflow(dana, "Home – Zusatz in der Leiste");
    await a11y(dana, "home-heute-abend-zusatz");
    await shot(dana, "41a-home-zusatz");
    // Ihre eigene Abstimmung wartet noch auf ihre Antwort – auf Home direkt darunter.
    // (Freitagabend nach 20 Uhr kann ihre Frist schon vorbei sein – dann gibt es nichts mehr zu beantworten.)
    const danaPoll = (await api(dana, "GET", "polls?select=ends_at,status")).json?.[0];
    if (danaPoll?.status !== "closed" && new Date(danaPoll?.ends_at) > new Date()) {
      check((await page.getByTestId("poll-quick-vote").count()) === 1, "D3: Danas eigene Abstimmung lässt sich auf Home beantworten");
    }
    const strayText = await page.locator(".ticket-feature-wrap").first().evaluate((el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent));
    check(strayText.length === 0, `kein loser Text über dem großen Ticket (vorher stand dort eine „0“): ${JSON.stringify(strayText)}`);
    await noOverflow(dana, "Home – Live-Countdown und Abstimmen");
    await shot(dana, "41-home-buehne");
    // P14 Etappe 2: Vorlagen je Anlass auf der Planseite – Anlass wählen, Sachen antippen.
    await page.goto(`${APP}/plans/${kicker}#mitbringen`);
    const bringPanel = page.locator("section#mitbringen");
    const templates = bringPanel.getByTestId("bring-templates");
    await templates.waitFor();
    const picnic = templates.getByRole("button", { name: "Picknick" });
    check((await picnic.getAttribute("aria-pressed")) === "false", "P14: „Kicker im Hof“ wählt keine Vorlage vor");
    await picnic.click();
    const suggestions = templates.getByRole("list", { name: "Vorschläge für Picknick" });
    await suggestions.waitFor();
    check((await suggestions.getByRole("button", { name: "„Getränke“ auf die Liste" }).count()) === 0, "P14: was schon auf der Liste steht, wird nicht vorgeschlagen");
    await suggestions.getByRole("button", { name: "„Decke“ auf die Liste" }).click();
    await toast(dana, "„Decke“ steht auf der Liste.");
    const blanket = bringPanel.getByTestId("plan-item").filter({ hasText: "Decke" });
    await blanket.waitFor();
    check((await blanket.getAttribute("data-state")) === "open", "P14: Vorschlag landet als offene Sache auf der Liste");
    await suggestions.getByRole("button", { name: "„Decke“ auf die Liste" }).waitFor({ state: "detached" });
    check(true, "P14: übernommener Vorschlag verschwindet aus den Chips");
    await noOverflow(dana, "Planseite – Vorlagen der Mitbring-Liste");
    await templates.scrollIntoViewIfNeeded();
    await shot(dana, "41b-mitbringen-vorlagen");
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

await step("S3 – Teilen-Ziel: Satz aus WhatsApp landet in der Ein-Satz-Abstimmung (Bob, 390 px)", async () => {
  const page = bob.page;
  const pollCount = async () => ((await api(bob, "GET", "polls?select=id")).json ?? []).length;
  const pollsBefore = await pollCount();
  // Das Manifest meldet AFTERHOURS als Ziel im Teilen-Menü an.
  const manifest = await (await page.request.get(`${APP}/manifest.webmanifest`)).json();
  check(manifest.share_target?.action === "/share-target" && manifest.share_target?.method === "GET" && manifest.share_target?.params?.text === "text", "Manifest: share_target → /share-target (GET, text/title/url)");
  // So ruft Android den Link auf, wenn jemand eine weitergeleitete Chat-Nachricht teilt.
  const shared = "[19.10.26, 21:04] Carol: minigolf oder billard, sa 19 uhr https://chat.example/x";
  await page.goto(`${APP}/share-target?title=&text=${encodeURIComponent(shared)}&url=`);
  await page.waitForURL(`${APP}/home`);
  const sheet = page.getByRole("dialog", { name: "Ein Satz reicht." });
  const input = sheet.getByLabel("Was, wann, wo – wie im Chat");
  await input.waitFor();
  check((await input.inputValue()) === "minigolf oder billard, sa 19 uhr", `Satz ohne Name, Chat-Zeit und Link übernommen („${await input.inputValue()}“)`);
  await sheet.getByTestId("quickpoll-shared").filter({ hasText: "Aus dem Chat übernommen" }).waitFor();
  const chips = sheet.getByRole("list", { name: "Daraus wird" });
  for (const chip of ["Minigolf", "Billard", "19:00"]) await chips.getByText(chip, { exact: true }).waitFor();
  check(!(await chips.getByText(/carol|http/i).count()), "kein Name und kein Link als Vorschlag");
  check(!page.url().includes("text="), "Text steht nicht mehr in der Adresse");
  await shot(bob, "51-teilen-ziel");
  // Eigene Änderung: Hinweis verschwindet.
  await input.fill("minigolf oder billard, sa 20 uhr");
  await sheet.getByTestId("quickpoll-shared").waitFor({ state: "detached" });
  // Nichts gestartet, nichts gespeichert: Schließen, Neuladen – das Sheet bleibt zu.
  await sheet.getByRole("button", { name: "Schließen" }).click();
  await input.waitFor({ state: "detached" });
  await page.reload();
  await page.getByRole("button", { name: "Was geht?" }).waitFor();
  await page.waitForTimeout(500);
  check((await page.getByRole("dialog", { name: "Ein Satz reicht." }).count()) === 0, "nach dem Neuladen geht das Sheet nicht wieder auf");
  check((await pollCount()) === pollsBefore, "Teilen allein startet keine Abstimmung");
  // Leerer Text (nur ein Link): Sheet offen, ehrlicher Hinweis.
  await page.goto(`${APP}/share-target?text=${encodeURIComponent("https://chat.example/nur-ein-link")}`);
  await page.waitForURL(`${APP}/home`);
  await sheet.getByTestId("quickpoll-shared").filter({ hasText: "nichts, was ich übernehmen kann" }).waitFor();
  check((await input.inputValue()) === "", "nur ein Link: Feld bleibt leer");
  check(await sheet.getByRole("button", { name: /Los – in die Gruppe/ }).isDisabled(), "ohne Satz lässt sich nichts starten");
  await sheet.getByRole("button", { name: "Schließen" }).click();
  // Ohne Anmeldung: erst Anmeldung, das Ziel wird gemerkt.
  const anon = await browser.newContext({ viewport: VIEWPORTS.mobile, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
  try {
    const p = await anon.newPage();
    await p.goto(`${APP}/share-target?text=${encodeURIComponent("kino fr")}`);
    await p.waitForURL(/\/login/);
    const next = await p.evaluate(() => localStorage.getItem("afterhours.next"));
    check(Boolean(next?.includes("/share-target?text=")), "ohne Konto: Anmeldung, Teilen-Ziel als nächstes Ziel gemerkt");
  } finally {
    await anon.close();
  }
});

await step("P34 – „Bin bei allem dabei“: ein Tipp, dabei bei allen offenen Vorschlägen (Carol auf Home, Alice und Bob auf der Abstimmung)", async () => {
  const title = `Mir egal ${RUN}`;
  const created = await api(bob, "POST", "rpc/create_poll", {
    p_crew_id: ids.crew, p_title: title, p_ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    p_options: [{ title: "Bowling" }, { title: "Kino" }, { title: "Pizza" }],
    p_description: null, p_meeting_point: null, p_budget_cents: null, p_min_participants: null,
  });
  if (created.status >= 300) throw new Error(`Abstimmung anlegen fehlgeschlagen (${created.status} ${created.json?.message})`);
  const pollId = created.json;
  // Eigene Antworten je Vorschlag, direkt aus der Datenbank: { Bowling: "no", Kino: "yes", … }
  const mine = (user) =>
    Object.fromEntries(
      execFileSync("psql", [DB_URL, "-Atqc", `select o.title || '=' || v.response from public.poll_votes v join public.poll_options o on o.id = v.poll_option_id
        join auth.users u on u.id = v.user_id where v.poll_id = '${pollId}' and u.email = '${user.email}'`]).toString().trim().split("\n").filter(Boolean).map((line) => line.split("=")),
    );
  try {
    // Home: Carol sagt bei Bowling ab, dann „Bei den übrigen 2 dabei“ – ihr „nein“ bleibt.
    await carol.page.goto(`${APP}/home`);
    const quick = carol.page.getByRole("region", { name: `Gleich hier abstimmen: ${title}` });
    await quick.getByTestId("poll-quick-option").waitFor();
    check((await quick.getByTestId("poll-quick-all").innerText()).trim() === "Bin bei allen 3 dabei", "P34: Home bietet „Bin bei allen 3 dabei“ an");
    await quick.getByRole("group", { name: "Schnell antworten für Bowling" }).getByRole("button", { name: "Bin nicht dabei", exact: true }).click();
    const rest = quick.getByRole("button", { name: "Bei den übrigen 2 dabei" });
    await rest.waitFor();
    await noOverflow(carol, "Home – bei allem dabei");
    await a11y(carol, "home-bei-allem-dabei");
    await shot(carol, "72a-home-bei-allem-dabei");
    const saved = carol.page.waitForResponse((r) => r.url().includes("/rpc/cast_vote_all") && r.request().method() === "POST");
    await rest.click();
    check((await saved).ok(), "P34: „Bei den übrigen 2 dabei“ gespeichert");
    await carol.page.getByTestId("poll-quick-done").waitFor();
    const c = mine(carol);
    check(c.Bowling === "no" && c.Kino === "yes" && c.Pizza === "yes", `P34: Carols „nein“ bei Bowling bleibt, Kino und Pizza „dabei“ (${JSON.stringify(c)})`);

    // Abstimmung: Bob (390 px) sieht den Knopf unter dem Stapel, Alice (Desktop) tippt ihn.
    await bob.page.goto(`${APP}/polls/${pollId}`);
    const bobAll = bob.page.getByTestId("vote-all");
    await bobAll.getByRole("button", { name: "Bin bei allen 3 dabei" }).waitFor();
    check(await bobAll.getByText(/^Mir egal, ich komm mit/).isVisible(), "P34: Hinweis, dass eigene Antworten bleiben");
    await noOverflow(bob, "Abstimmung – bei allem dabei");
    await a11y(bob, "abstimmung-bei-allem-dabei");
    await shot(bob, "72b-abstimmung-bei-allem-dabei");
    await bob.page.getByTestId("swipe-deck").getByRole("button", { name: /^Bin dabei: Bowling/ }).click();
    await bobAll.getByRole("button", { name: "Bei den übrigen 2 dabei" }).waitFor();
    check(true, "P34: nach der ersten Antwort heißt der Knopf „Bei den übrigen 2 dabei“");
    await bob.page.getByTestId("swipe-deck").getByRole("button", { name: /^Eher nicht: Kino/ }).click();
    await bob.page.getByTestId("swipe-deck").getByText("noch 1 Vorschlag").waitFor();
    check((await bob.page.getByTestId("vote-all").count()) === 0, "P34: bei nur einem offenen Vorschlag kein Extra-Knopf");

    await alice.page.goto(`${APP}/polls/${pollId}`);
    await alice.page.getByTestId("vote-all").getByRole("button", { name: "Bin bei allen 3 dabei" }).click();
    await toast(alice, "Bei 3 Vorschlägen dabei");
    await alice.page.getByTestId("swipe-deck").getByText(/Alles gewischt/).waitFor();
    const a = mine(alice);
    check(a.Bowling === "yes" && a.Kino === "yes" && a.Pizza === "yes", `P34: Alice ist bei allen drei dabei (${JSON.stringify(a)})`);
    await alice.page.locator('.vote-card[data-answer="yes"]').filter({ hasText: "Pizza" }).waitFor();
    check(true, "P34: die Vorschläge tragen Alices Antwort als Farbe");
    await shot(alice, "72c-abstimmung-alles-dabei");
  } finally {
    // Aufräumen: der Rest der Journey kennt diese Abstimmung nicht.
    execFileSync("psql", [DB_URL, "-qc", `delete from public.polls where id = '${pollId}'`]);
  }
});

await step("P34 Etappe 2 – „Bin bei allem dabei“ für Gäste auf dem Abstimm-Link (Gast, 390 px)", async () => {
  const created = await api(bob, "POST", "rpc/create_poll", {
    p_crew_id: ids.crew, p_title: `Egal für Gäste ${RUN}`, p_ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    p_options: [{ title: "Bowling" }, { title: "Kino" }, { title: "Pizza" }],
    p_description: null, p_meeting_point: null, p_budget_cents: null, p_min_participants: null,
  });
  if (created.status >= 300) throw new Error(`Abstimmung anlegen fehlgeschlagen (${created.status} ${created.json?.message})`);
  const pollId = created.json;
  const guest = await newUser("Gast", "mobile");
  const guestVotes = () =>
    Object.fromEntries(
      execFileSync("psql", [DB_URL, "-Atqc", `select o.title || '=' || v.response from public.poll_guest_votes v join public.poll_options o on o.id = v.poll_option_id
        where v.poll_id = '${pollId}'`]).toString().trim().split("\n").filter(Boolean).map((line) => line.split("=")),
    );
  try {
    check((await api(bob, "POST", "rpc/set_poll_guests", { p_poll_id: pollId, p_allowed: true })).status < 300, "Bob lässt Gäste mitstimmen");
    const pollToken = (await api(bob, "POST", "rpc/poll_share_token", { p_poll_id: pollId })).json;
    await guest.page.goto(`${APP}/v/${pollToken}`);
    await guest.page.getByRole("heading", { level: 1, name: "Stimm mit ab" }).waitFor();
    const all = guest.page.getByTestId("vote-all");
    await all.getByRole("button", { name: "Bin bei allen 3 dabei" }).waitFor();
    check(true, "P34 Etappe 2: Gast sieht „Bin bei allen 3 dabei“");
    // Erst „nein“ bei Bowling, dann Name und abstimmen – der Knopf zählt nur noch die übrigen.
    await answer(guest, "Bowling", "Bin nicht dabei").click();
    await all.getByRole("button", { name: "Bei den übrigen 2 dabei" }).waitFor();
    await noOverflow(guest, "Gast-Stimmzettel – bei allem dabei");
    await a11y(guest, "gast-bei-allem-dabei");
    await shot(guest, "72d-gast-bei-allem-dabei");
    await guest.page.getByLabel("Dein Name").fill("Mila");
    await guest.page.getByRole("button", { name: "Abstimmen" }).click();
    await guest.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Mila" }).waitFor();
    check(JSON.stringify(guestVotes()) === JSON.stringify({ Bowling: "no" }), `P34 Etappe 2: erst nur „nein“ bei Bowling gespeichert (${JSON.stringify(guestVotes())})`);
    // Jetzt mit Namen auf dem Gerät: ein Tipp speichert sofort.
    const saved = guest.page.waitForResponse((r) => r.url().includes("/rpc/guest_vote_shared_poll") && r.request().method() === "POST");
    await all.getByRole("button", { name: "Bei den übrigen 2 dabei" }).click();
    check((await saved).ok(), "P34 Etappe 2: „Bei den übrigen 2 dabei“ mit einem Tipp gespeichert");
    await guest.page.getByTestId("vote-all").waitFor({ state: "detached" });
    const v = guestVotes();
    check(v.Bowling === "no" && v.Kino === "yes" && v.Pizza === "yes", `P34 Etappe 2: Bowling bleibt „nein“, Kino und Pizza „dabei“ (${JSON.stringify(v)})`);
    await guest.page.locator('.vote-card[data-answer="yes"]').filter({ hasText: "Pizza" }).waitFor();
    check(true, "P34 Etappe 2: die Vorschläge tragen die Antwort als Farbe");
  } finally {
    users.splice(users.indexOf(guest), 1);
    await guest.context.close();
    execFileSync("psql", [DB_URL, "-qc", `delete from public.polls where id = '${pollId}'`]);
  }
});

await step("P39 – „Noch einen Tag?“: Frist verlängern, alle Stimmen bleiben, Nachzügler bekommen Bescheid (Bob 390 px, Carol)", async () => {
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const title = `Verlängern ${RUN}`;
  const created = await api(bob, "POST", "rpc/create_poll", {
    p_crew_id: ids.crew, p_title: title, p_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_options: [{ title: "Bowling" }, { title: "Kino" }],
    p_description: null, p_meeting_point: null, p_budget_cents: null, p_min_participants: null,
  });
  if (created.status >= 300) throw new Error(`Abstimmung anlegen fehlgeschlagen (${created.status} ${created.json?.message})`);
  const pollId = created.json;
  const endsAt = () => new Date(psql(`select to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.polls where id = '${pollId}'`)).getTime();
  try {
    await api(alice, "POST", "rpc/cast_vote", { p_option_id: psql(`select id from public.poll_options where poll_id = '${pollId}' and title = 'Bowling'`), p_response: "yes" });
    // Carol ist einfaches Mitglied: kein Verlängern bei Bobs Abstimmung.
    await carol.page.goto(`${APP}/polls/${pollId}`);
    await carol.page.getByRole("heading", { name: title }).waitFor();
    check((await carol.page.getByTestId("poll-extend").count()) === 0, "P39: einfache Mitglieder sehen „Frist verlängern“ nicht");

    // Bob (390 px) hat sie gestartet: drei Tipps ab der aktuellen Frist.
    const { page } = bob;
    await page.goto(`${APP}/polls/${pollId}`);
    const box = page.getByTestId("poll-extend");
    await box.scrollIntoViewIfNeeded();
    for (const label of ["+2 Std.", "+1 Tag", "+3 Tage"]) check(await box.getByRole("button", { name: new RegExp(`^\\${label} – bis `) }).isEnabled(), `P39: „${label}“ wählbar`);
    check(await box.getByText("Alle Stimmen bleiben. Wer noch nicht abgestimmt hat, bekommt Bescheid.").isVisible(), "P39: Hinweis, dass Stimmen bleiben");
    await noOverflow(bob, "Abstimmung – Frist verlängern");
    await a11y(bob, "abstimmung-frist-verlaengern");
    await shot(bob, "75-abstimmung-frist-verlaengern");

    // Fehlerzustand: ohne Verbindung bleibt die Frist, die Meldung sagt es.
    const before = endsAt();
    await page.route("**/rest/v1/rpc/extend_poll", (route) => route.abort());
    await box.getByRole("button", { name: /^\+1 Tag – bis / }).click();
    await page.getByText(/Keine Verbindung/).first().waitFor();
    check(endsAt() === before, "P39: Fehler beim Verlängern – Frist unverändert");
    await page.unroute("**/rest/v1/rpc/extend_poll");

    const saved = page.waitForResponse((r) => r.url().includes("/rpc/extend_poll") && r.request().method() === "POST");
    await box.getByRole("button", { name: /^\+1 Tag – bis / }).click();
    check((await saved).ok(), "P39: „+1 Tag“ gespeichert");
    await toast(bob, "Verlängert bis ");
    const after = endsAt();
    check(after - Math.floor(before / 60_000) * 60_000 === 86_400_000, `P39: Frist genau einen Tag später (${new Date(before).toISOString()} → ${new Date(after).toISOString()})`);
    check(psql(`select count(*) from public.poll_votes where poll_id = '${pollId}'`) === "1", "P39: Alices Stimme bleibt");
    const notified = (name) => psql(`select count(*) from public.notifications n join auth.users u on u.id = n.user_id
      where n.type = 'poll_reminder' and n.related_entity_id = '${pollId}' and (n.payload ->> 'extended')::boolean and u.email = '${name.email}'`);
    check(notified(carol) === "1", "P39: Carol hat noch nicht abgestimmt – sie bekommt Bescheid");
    check(notified(alice) === "0" && notified(bob) === "0", "P39: wer abgestimmt oder verlängert hat, bekommt nichts");

    await carol.page.goto(`${APP}/notifications`);
    // Ungelesene tragen vorne „Ungelesen:“ für Screenreader – deshalb ohne Anker am Anfang.
    await carol.page.getByText(/Verlängert bis .* – deine Stimme fehlt noch$/).first().waitFor();
    check(true, "P39: Carol sieht „Verlängert bis … – deine Stimme fehlt noch“");

    // Etappe 2: Frist bis zu einem selbst gewählten Zeitpunkt (Feld in Berliner Zeit).
    const berlinLocal = (ms) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    };
    const current = endsAt();
    const untilButton = box.getByRole("button", { name: "Bis …" });
    check((await untilButton.getAttribute("aria-expanded")) === "false", "P39 Etappe 2: „Bis …“ zu");
    await untilButton.click();
    const field = box.getByLabel("Neue Frist");
    await field.waitFor();
    check((await untilButton.getAttribute("aria-expanded")) === "true", "P39 Etappe 2: „Bis …“ offen");
    check((await field.inputValue()) === berlinLocal(current + 86_400_000), `P39 Etappe 2: Vorschlag einen Tag nach der Frist (${await field.inputValue()})`);
    check(await box.getByText(/^Spätestens .*\.$/).isVisible(), "P39 Etappe 2: Grenze steht unter dem Feld");
    await noOverflow(bob, "Abstimmung – Frist bis …");
    await a11y(bob, "abstimmung-frist-eigene-zeit");
    await shot(bob, "75-abstimmung-frist-eigene-zeit");

    // Leerzustand und Fehlerzustand: ohne Wert bzw. vor der bisherigen Frist geht nichts an den Server.
    let calls = 0;
    const count = (r) => { if (r.url().includes("/rpc/extend_poll")) calls += 1; };
    page.on("request", count);
    await field.fill("");
    await box.getByRole("button", { name: "Verlängern", exact: true }).click();
    await box.getByText("Bitte Tag und Uhrzeit wählen.").waitFor();
    await field.fill(berlinLocal(current - 3_600_000));
    await box.getByRole("button", { name: "Verlängern", exact: true }).click();
    await box.getByText("Die neue Frist muss nach der bisherigen liegen.").waitFor();
    await field.fill(berlinLocal(Date.now() + 15 * 86_400_000));
    await box.getByRole("button", { name: "Verlängern", exact: true }).click();
    await box.getByText("Höchstens 14 Tage im Voraus.").waitFor();
    page.off("request", count);
    check(calls === 0 && endsAt() === current, "P39 Etappe 2: ungültige Zeitpunkte werden im Browser abgefangen, Frist unverändert");

    const wanted = Math.floor(current / 60_000) * 60_000 + 5 * 3_600_000;
    await field.fill(berlinLocal(wanted));
    const custom = page.waitForResponse((r) => r.url().includes("/rpc/extend_poll") && r.request().method() === "POST");
    await box.getByRole("button", { name: "Verlängern", exact: true }).click();
    check((await custom).ok(), "P39 Etappe 2: eigener Zeitpunkt gespeichert");
    await toast(bob, "Verlängert bis ");
    check(endsAt() === wanted, `P39 Etappe 2: Frist genau zum gewählten Zeitpunkt (${new Date(endsAt()).toISOString()})`);
    await field.waitFor({ state: "detached" });
    check(true, "P39 Etappe 2: Feld schließt sich nach dem Speichern");
    check(notified(carol) === "2", "P39 Etappe 2: Carol bekommt zur neuen Frist erneut Bescheid");
  } finally {
    execFileSync("psql", [DB_URL, "-qc", `delete from public.polls where id = '${pollId}'`]);
  }
});

await step("P40 – „Und Sonntag?“: Termin nachreichen, wer abgestimmt hat, bekommt Bescheid (Bob 390 px, Carol)", async () => {
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const dayIn = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 86_400_000));
  const label = (date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`));
  const [d1, d2, d3] = [dayIn(3), dayIn(4), dayIn(5)];
  const title = `Termin nachreichen ${RUN}`;
  const created = await api(bob, "POST", "rpc/create_date_poll", {
    p_crew_id: ids.crew, p_title: title, p_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_slots: [{ date: d1, time: "20:00" }, { date: d2, time: "20:00" }],
  });
  if (created.status >= 300) throw new Error(`Termin-Abstimmung anlegen fehlgeschlagen (${created.status} ${created.json?.message})`);
  const pollId = created.json;
  const options = () => psql(`select count(*) from public.poll_options where poll_id = '${pollId}'`);
  try {
    await api(carol, "POST", "rpc/cast_vote", { p_option_id: psql(`select id from public.poll_options where poll_id = '${pollId}' and proposed_date = '${d1}'`), p_response: "no" });

    const { page } = bob;
    await page.goto(`${APP}/polls/${pollId}`);
    await page.getByRole("heading", { name: title }).waitFor();
    const open = page.getByTestId("poll-add-slot");
    await open.scrollIntoViewIfNeeded();
    await open.click();
    const form = page.getByTestId("poll-add-slot-form");
    await form.waitFor();
    check(await form.getByText("Du bist dort gleich dabei. Wer schon abgestimmt hat, bekommt Bescheid.").isVisible(), "P40: Hinweis, was beim Vorschlagen passiert");
    await noOverflow(bob, "Abstimmung – Termin nachreichen");
    await a11y(bob, "abstimmung-termin-nachreichen");
    await shot(bob, "76-abstimmung-termin-nachreichen");

    // Fehlerzustände: doppelter Termin (vor dem Server), keine Verbindung (nichts angelegt).
    await form.getByLabel("Tag", { exact: true }).fill(d1);
    await form.getByLabel("Uhrzeit", { exact: false }).fill("20:00");
    await form.getByRole("button", { name: "Vorschlagen" }).click();
    await form.getByText("Diesen Termin gibt es schon.").waitFor();
    check(options() === "2", "P40: doppelter Termin – nichts angelegt");
    await form.getByLabel("Tag", { exact: true }).fill(d3);
    await form.getByLabel("Uhrzeit", { exact: false }).fill("19:30");
    await page.route("**/rest/v1/rpc/add_poll_slot", (route) => route.abort());
    await form.getByRole("button", { name: "Vorschlagen" }).click();
    await page.getByText(/Keine Verbindung/).first().waitFor();
    check(options() === "2", "P40: Fehler beim Vorschlagen – nichts angelegt");
    await page.unroute("**/rest/v1/rpc/add_poll_slot");

    const saved = page.waitForResponse((r) => r.url().includes("/rpc/add_poll_slot") && r.request().method() === "POST");
    await form.getByRole("button", { name: "Vorschlagen" }).click();
    check((await saved).ok(), "P40: Termin gespeichert");
    await toast(bob, "steht jetzt mit zur Wahl.");
    check(options() === "3", "P40: dritter Termin angelegt");
    check(psql(`select o.title || ' ' || to_char(o.proposed_time, 'HH24:MI') || ' ' || v.response from public.poll_options o
                join public.poll_votes v on v.poll_option_id = o.id and v.user_id = (select id from auth.users where email = '${bob.email}')
                where o.poll_id = '${pollId}' and o.proposed_date = '${d3}'`) === `${label(d3)} 19:30 yes`, "P40: Titel vom Server, Uhrzeit, Bob ist dort dabei");
    await optionCard(bob, label(d3)).first().waitFor();
    check(await page.getByTestId("poll-add-slot").isVisible(), "P40: danach wieder der Knopf statt des Formulars");

    const notified = (user) => psql(`select count(*) from public.notifications n join auth.users u on u.id = n.user_id
      where n.type = 'poll_reminder' and n.related_entity_id = '${pollId}' and (n.payload ->> 'added')::boolean and u.email = '${user.email}'`);
    check(notified(carol) === "1", "P40: Carol hat schon abgestimmt – sie bekommt Bescheid");
    check(notified(alice) === "0" && notified(bob) === "0", "P40: wer noch nicht abgestimmt hat oder vorschlägt, bekommt nichts");
    await carol.page.goto(`${APP}/notifications`);
    await carol.page.getByText(new RegExp(`schlägt noch ${label(d3)}, 19:30 Uhr vor – kannst du\\?$`)).first().waitFor();
    check(true, "P40: Carol sieht „… schlägt noch …, 19:30 Uhr vor – kannst du?“");
  } finally {
    execFileSync("psql", [DB_URL, "-qc", `delete from public.polls where id = '${pollId}'`]);
  }
});

await step("P40 Etappe 2 – „Und das Kino?“: Ort nachreichen – eigener Vorschlag und aus Discover (Bob 390 px, Carol)", async () => {
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const dayIn = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 86_400_000));
  const d1 = dayIn(3);
  const title = `Ort nachreichen ${RUN}`;
  const created = await api(bob, "POST", "rpc/create_poll", {
    p_crew_id: ids.crew, p_title: title, p_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_options: [{ title: "Billard", proposed_date: d1, proposed_time: "20:00" }, { title: "Kino", proposed_date: d1, proposed_time: "20:00" }],
  });
  if (created.status >= 300) throw new Error(`Orts-Abstimmung anlegen fehlgeschlagen (${created.status} ${created.json?.message})`);
  const pollId = created.json;
  const options = () => psql(`select count(*) from public.poll_options where poll_id = '${pollId}'`);
  try {
    await api(carol, "POST", "rpc/cast_vote", { p_option_id: psql(`select id from public.poll_options where poll_id = '${pollId}' and title = 'Billard'`), p_response: "no" });

    const { page } = bob;
    await page.goto(`${APP}/polls/${pollId}`);
    await page.getByRole("heading", { name: title }).waitFor();
    check((await page.getByTestId("poll-add-slot").count()) === 0, "P40/2: bei Orts-Abstimmungen kein „Anderen Termin vorschlagen“");
    const open = page.getByTestId("poll-add-place");
    await open.scrollIntoViewIfNeeded();
    await open.click();
    const form = page.getByTestId("poll-add-place-form");
    await form.waitFor();
    check(await form.getByText("Du bist dort gleich dabei. Wer schon abgestimmt hat, bekommt Bescheid.").isVisible(), "P40/2: Hinweis, was beim Vorschlagen passiert");
    check(await form.getByText(/^Gilt wie die anderen Vorschläge für .+, 20:00 Uhr\.$/).isVisible(), "P40/2: gemeinsamer Termin wird genannt");
    await noOverflow(bob, "Abstimmung – Ort nachreichen");
    await a11y(bob, "abstimmung-ort-nachreichen");
    await shot(bob, "77-abstimmung-ort-nachreichen");

    // Fehlerzustände: leer, doppelt (vor dem Server), keine Verbindung (nichts angelegt).
    await form.getByRole("button", { name: "Vorschlagen" }).click();
    await form.getByText("Such einen Ort aus oder schreib deinen Vorschlag hin.").waitFor();
    await form.getByLabel("Eigener Vorschlag").fill("  kino ");
    await form.getByRole("button", { name: "Vorschlagen" }).click();
    await form.getByText("Diesen Vorschlag gibt es schon.").waitFor();
    check(options() === "2", "P40/2: leer und doppelt – nichts angelegt");
    await form.getByLabel("Eigener Vorschlag").fill("Picknick im Park");
    await page.route("**/rest/v1/rpc/add_poll_place", (route) => route.abort());
    await form.getByRole("button", { name: "Vorschlagen" }).click();
    await page.getByText(/Keine Verbindung/).first().waitFor();
    check(options() === "2", "P40/2: Fehler beim Vorschlagen – nichts angelegt");
    await page.unroute("**/rest/v1/rpc/add_poll_place");

    const saved = page.waitForResponse((r) => r.url().includes("/rpc/add_poll_place") && r.request().method() === "POST");
    await form.getByRole("button", { name: "Vorschlagen" }).click();
    check((await saved).ok(), "P40/2: eigener Vorschlag gespeichert");
    await toast(bob, "Picknick im Park steht jetzt mit zur Wahl.");
    check(options() === "3", "P40/2: dritter Vorschlag angelegt");
    check(psql(`select o.proposed_date || ' ' || to_char(o.proposed_time, 'HH24:MI') || ' ' || v.response from public.poll_options o
                join public.poll_votes v on v.poll_option_id = o.id and v.user_id = (select id from auth.users where email = '${bob.email}')
                where o.poll_id = '${pollId}' and o.title = 'Picknick im Park'`) === `${d1} 20:00 yes`, "P40/2: gemeinsamer Termin übernommen, Bob ist dort dabei");
    await optionCard(bob, "Picknick im Park").first().waitFor();

    // Ort aus Discover: gleiche Suche wie beim Anlegen, ein Tipp wählt ihn.
    await page.getByTestId("poll-add-place").click();
    await form.getByRole("button", { name: "Ort suchen" }).click();
    const picker = dialog(bob);
    await picker.getByLabel("Stadt", { exact: true }).fill("Leipzig");
    await picker.getByLabel("Stadt", { exact: true }).press("Enter");
    await picker.getByLabel("Orte durchsuchen").fill("bowling_alley 4");
    await picker.getByRole("button", { name: /bowling_alley 4\b/ }).first().click();
    await picker.waitFor({ state: "hidden" });
    const picked = form.getByTestId("poll-add-place-picked");
    await picked.waitFor();
    const placeName = (await picked.locator("span.truncate.font-semibold").first().textContent()).trim();
    await shot(bob, "77b-abstimmung-ort-aus-discover");
    const savedPlace = page.waitForResponse((r) => r.url().includes("/rpc/add_poll_place") && r.request().method() === "POST");
    await form.getByRole("button", { name: "Vorschlagen" }).click();
    check((await savedPlace).ok(), "P40/2: Ort aus Discover gespeichert");
    check(options() === "4", "P40/2: vierter Vorschlag angelegt");
    check(psql(`select count(*) from public.poll_options o join public.activities a on a.id = o.activity_id
                where o.poll_id = '${pollId}' and o.title = a.name and a.name = '${placeName.replaceAll("'", "''")}'`) === "1", "P40/2: Ort mit Verweis auf Discover, Titel ist sein Name");
    await optionCard(bob, placeName).first().waitFor();

    const notified = (user) => psql(`select count(*) from public.notifications n join auth.users u on u.id = n.user_id
      where n.type = 'poll_reminder' and n.related_entity_id = '${pollId}' and n.payload ? 'place' and u.email = '${user.email}'`);
    check(notified(carol) === "2", "P40/2: Carol hat schon abgestimmt – sie bekommt zu beiden Orten Bescheid");
    check(notified(alice) === "0" && notified(bob) === "0", "P40/2: wer noch nicht abgestimmt hat oder vorschlägt, bekommt nichts");
    await carol.page.goto(`${APP}/notifications`);
    await carol.page.getByText(/schlägt noch Picknick im Park vor – bist du dabei\?$/).first().waitFor();
    check(true, "P40/2: Carol sieht „… schlägt noch Picknick im Park vor – bist du dabei?“");
  } finally {
    execFileSync("psql", [DB_URL, "-qc", `delete from public.polls where id = '${pollId}'`]);
  }
});

await step("P42 – „Vertippt?“: nachgereichten Vorschlag zurückziehen, solange niemand sonst geantwortet hat (Bob 390 px, Carol)", async () => {
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const title = `Vorschlag zurückziehen ${RUN}`;
  const created = await api(bob, "POST", "rpc/create_poll", {
    p_crew_id: ids.crew, p_title: title, p_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_options: [{ title: "Billard" }, { title: "Kino" }],
  });
  if (created.status >= 300) throw new Error(`Orts-Abstimmung anlegen fehlgeschlagen (${created.status} ${created.json?.message})`);
  const pollId = created.json;
  const options = () => psql(`select count(*) from public.poll_options where poll_id = '${pollId}'`);
  const notified = () => psql(`select count(*) from public.notifications n join auth.users u on u.id = n.user_id
    where n.type = 'poll_reminder' and n.related_entity_id = '${pollId}' and n.payload ? 'place' and u.email = '${carol.email}'`);
  try {
    await api(carol, "POST", "rpc/cast_vote", { p_option_id: psql(`select id from public.poll_options where poll_id = '${pollId}' and title = 'Billard'`), p_response: "yes" });
    const typo = await api(bob, "POST", "rpc/add_poll_place", { p_poll_id: pollId, p_title: "Picknik im Prak" });
    if (typo.status >= 300) throw new Error(`Ort nachreichen fehlgeschlagen (${typo.status} ${typo.json?.message})`);
    check(notified() === "1", "P42: Carol hat Bescheid bekommen");

    const { page } = bob;
    await page.goto(`${APP}/polls/${pollId}`);
    await page.getByRole("heading", { name: title }).waitFor();
    const typoCard = optionCard(bob, "Picknik im Prak").first();
    await typoCard.waitFor();
    check((await optionCard(bob, "Billard").getByTestId("poll-option-withdraw").count()) === 0
      && (await optionCard(bob, "Kino").getByTestId("poll-option-withdraw").count()) === 0, "P42: Vorschläge vom Start lassen sich nicht zurückziehen");
    const withdraw = typoCard.getByTestId("poll-option-withdraw");
    await withdraw.scrollIntoViewIfNeeded();
    await withdraw.click();
    const confirm = typoCard.getByTestId("poll-option-withdraw-confirm");
    await confirm.waitFor();
    check(await confirm.getByText("Noch hat niemand sonst dazu geantwortet. Der Hinweis an die Crew verschwindet mit.").isVisible(), "P42: Nachfrage erklärt, was passiert");
    await noOverflow(bob, "Abstimmung – Vorschlag zurückziehen");
    await a11y(bob, "abstimmung-vorschlag-zurueckziehen");
    await shot(bob, "78-abstimmung-vorschlag-zurueckziehen");
    await confirm.getByRole("button", { name: "Behalten" }).click();
    await withdraw.waitFor();
    check(options() === "3", "P42: „Behalten“ ändert nichts");

    // Fehlerzustand: keine Verbindung – der Vorschlag bleibt.
    await withdraw.click();
    await page.route("**/rest/v1/rpc/remove_poll_option", (route) => route.abort());
    await confirm.getByRole("button", { name: "Ja, zurückziehen" }).click();
    await page.getByText(/Keine Verbindung/).first().waitFor();
    check(options() === "3", "P42: Fehler beim Zurückziehen – nichts gelöscht");
    await page.unroute("**/rest/v1/rpc/remove_poll_option");

    await withdraw.click();
    const removed = page.waitForResponse((r) => r.url().includes("/rpc/remove_poll_option") && r.request().method() === "POST");
    await confirm.getByRole("button", { name: "Ja, zurückziehen" }).click();
    check((await removed).ok(), "P42: zurückgezogen");
    await toast(bob, "Picknik im Prak ist wieder raus.");
    await typoCard.waitFor({ state: "detached" });
    check(options() === "2", "P42: Vorschlag ist weg");
    check(notified() === "0", "P42: der Hinweis an Carol ist mit zurückgenommen");

    // Hat jemand anderes geantwortet, bleibt der Vorschlag – kein Knopf.
    const fixedUp = await api(bob, "POST", "rpc/add_poll_place", { p_poll_id: pollId, p_title: "Picknick im Park" });
    await api(carol, "POST", "rpc/cast_vote", { p_option_id: fixedUp.json, p_response: "maybe" });
    await page.reload();
    await optionCard(bob, "Picknick im Park").first().waitFor();
    check((await optionCard(bob, "Picknick im Park").getByTestId("poll-option-withdraw").count()) === 0, "P42: Carol hat geantwortet – kein „Zurückziehen“");
  } finally {
    execFileSync("psql", [DB_URL, "-qc", `delete from public.polls where id = '${pollId}'`]);
  }
});

await step("P33 – Steht schon fest? „kino 20.11. 20 uhr“ gleich als Plan (Bob, 390 px)", async () => {
  const page = bob.page;
  const count = async (table) => ((await api(bob, "GET", `${table}?select=id`)).json ?? []).length;
  const pollsBefore = await count("polls");
  const plansBefore = await count("plans");
  // Ein fester Tag in zehn Tagen (nie „heute, schon vorbei“), so wie man ihn in den Chat schreibt: „20.11.“ (de-DE setzt den Punkt am Ende)
  const day = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }).format(new Date(Date.now() + 10 * 86_400_000));
  await page.goto(`${APP}/home`);
  await page.getByRole("button", { name: "Was geht?" }).click();
  const sheet = page.getByRole("dialog", { name: "Ein Satz reicht." });
  const input = sheet.getByLabel("Was, wann, wo – wie im Chat");
  await input.waitFor();
  const card = sheet.getByTestId("quickpoll-plan");
  // Zwei Sachen oder keine Uhrzeit: es bleibt bei der Abstimmung.
  await input.fill(`kino oder bowling ${day} 20 uhr`);
  await sheet.getByText("2 Vorschläge", { exact: false }).waitFor();
  check((await card.count()) === 0 && (await sheet.getByRole("button", { name: /Los – in die Gruppe/ }).isEnabled()), "P33: zwei Sachen → Abstimmung, keine Plan-Karte");
  await input.fill(`kino ${day}`);
  await sheet.getByText("1 Vorschlag", { exact: false }).waitFor();
  check((await card.count()) === 0, "P33: ohne Uhrzeit → Abstimmung, keine Plan-Karte");
  // Eine Sache, ein Tag, eine Uhrzeit: „Steht schon fest?“
  await input.fill(`kino ${day} 20 uhr`);
  await card.waitFor();
  const cardText = await card.innerText();
  check(/steht schon fest\?/i.test(cardText) && cardText.includes(" · 20:00 Uhr") && cardText.includes("Freunde ohne App sagen über den Link zu"), `P33: Plan-Karte mit Sache und Uhrzeit („${cardText.replace(/\s+/g, " ")}“)`);
  check((await sheet.getByText("Kino", { exact: true }).count()) === 2 && (await sheet.getByText(/^Was geht/).count()) === 0, "P33: Vorschau heißt wie der Plan („Kino“), nicht „Was geht Freitag?“");
  check((await sheet.getByRole("button", { name: /Los – in die Gruppe/ }).count()) === 0, "P33: Hauptknopf legt den Plan an, kein „Los – in die Gruppe“");
  check(await sheet.getByRole("button", { name: "Lieber abstimmen" }).isEnabled(), "P33: „Lieber abstimmen“ bleibt möglich");
  await shot(bob, "51b-gleich-als-plan");
  await stubShare(page);
  await sheet.getByRole("button", { name: "Plan steht – in die Gruppe" }).click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}/, { timeout: 20000 });
  const planId = idFromUrl(page);
  await page.getByRole("heading", { level: 1 }).filter({ hasText: "Kino" }).waitFor();
  const row = (await api(bob, "GET", `plans?id=eq.${planId}&select=title,status,starts_at,guests_allowed,poll_id`)).json?.[0];
  const berlin = row && new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(row.starts_at));
  check(row?.title === "Kino" && row.status === "proposed" && row.poll_id === null, `P33: Plan „Kino“ als Vorschlag ohne Abstimmung (${JSON.stringify(row)})`);
  check(berlin === `${day}, 20:00`, `P33: Beginn am ${day} um 20:00 Berliner Zeit (${berlin})`);
  check(row?.guests_allowed === true, "P33: Freunde ohne App dürfen über den Link zusagen (W10)");
  const shared = await sharedData(page);
  check(shared.length === 1 && shared[0].title === "Kino" && /\/s\/[A-Za-z0-9_-]{16,}/.test(shared[0].url ?? ""), `P33: Teilen-Menü mit dem Plan-Link /s/… (${JSON.stringify(shared)})`);
  check((await count("polls")) === pollsBefore && (await count("plans")) === plansBefore + 1, "P33: genau ein Plan, keine Abstimmung");
  await unstubShare(page);
  await shot(bob, "51c-gleich-als-plan-planseite");
  // Aufräumen: der Rest der Journey kennt diesen Plan nicht.
  execFileSync("psql", [DB_URL, "-qc", `delete from public.plans where id = '${planId}'`]);
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

await step("P4 – Push-Mitteilungen: Gerät anmelden, verschlüsselter Push, Texte der Mitteilung (Carol, Bob)", async () => {
  // Headless-Chromium hat keinen Push-Dienst: Das Abo beim Dienst stellt die Journey nach (Schlüssel wie im
  // Browser, Adresse beim Stellvertreter tests/e2e/push-stub.mjs). Alles andere ist echt: Speichern, Warteschlange,
  // Edge Function mit Verschlüsselung und VAPID, Service Worker mit den Texten der App.
  const stubHost = process.env.E2E_PUSH_STUB_HOST ?? "";
  const stubUrl = process.env.E2E_PUSH_STUB_URL ?? "http://127.0.0.1:8091";
  const device = crypto.createECDH("prime256v1");
  device.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const deviceName = `carol-${RUN}`;
  const endpoint = `https://${stubHost || "fcm.googleapis.com"}/push/${deviceName}`;
  const app = await newUser("Carol", "mobile", { serviceWorkers: "allow" });
  const { page, context } = app;
  await context.grantPermissions(["notifications"], { origin: APP });
  await page.addInitScript(({ endpoint, p256dh, auth }) => {
    const toBuffer = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4)), (c) => c.charCodeAt(0)).buffer;
    const toText = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const KEY = "afterhours.e2e.push";
    const make = (serverKey) => ({
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: toBuffer(serverKey) },
      getKey: (name) => (name === "p256dh" ? toBuffer(p256dh) : name === "auth" ? toBuffer(auth) : null),
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
      unsubscribe: async () => {
        localStorage.removeItem(KEY);
        return true;
      },
    });
    PushManager.prototype.subscribe = async function (options) {
      const key = options.applicationServerKey;
      const serverKey = toText(key instanceof ArrayBuffer ? key : key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength));
      localStorage.setItem(KEY, serverKey);
      return make(serverKey);
    };
    PushManager.prototype.getSubscription = async function () {
      const serverKey = localStorage.getItem(KEY);
      return serverKey ? make(serverKey) : null;
    };
    PushManager.prototype.permissionState = async () => "granted";
    // Headless-Chromium meldet Mitteilungen je nach Variante als „denied“, auch nach grantPermissions.
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
    Notification.requestPermission = async () => "granted";
  }, { endpoint, p256dh: device.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") });

  await login(app);
  await page.waitForURL(/\/home/);
  await page.goto(`${APP}/settings#notifications`);
  const panel = page.getByTestId("push-panel");
  await page.locator('[data-testid="push-panel"]:not([data-state="loading"])').waitFor({ timeout: 20_000 });
  const initial = await panel.getAttribute("data-state");
  if (initial === "not-configured") {
    check(await panel.getByText("noch nicht eingerichtet").isVisible(), "ohne VAPID-Schlüssel sagt die App ehrlich, dass Push fehlt");
    console.log("   (Push nicht eingerichtet – Versand wird übersprungen)");
    return;
  }
  check(initial === "off", `Push ist auf dem Gerät erst aus (${initial})`);
  check((await page.getByTestId("push-status").innerText()).trim() === "Aus", "Push-Pille sagt „Aus“");
  const kicked = page.waitForRequest((r) => r.url().includes("/functions/v1/push") && (r.postData() ?? "").includes("send"), { timeout: 15_000 });
  await panel.getByRole("switch", { name: /Mitteilungen auf diesem Gerät/ }).click();
  await toast(app, "Push-Mitteilungen sind an.");
  await page.locator('[data-testid="push-panel"][data-state="on"]').waitFor();
  check((await page.getByTestId("push-status").innerText()).trim() === "An", "Push-Pille sagt „An“");
  await kicked;
  check(true, "nach der eigenen Aktion stößt die App den Versand an");
  await panel.scrollIntoViewIfNeeded();
  await shot(app, "60-push-an");
  const saved = (await api(app, "GET", "push_subscriptions?select=endpoint,label")).json ?? [];
  check(saved.length === 1 && saved[0].endpoint === endpoint && /^Chrome auf /.test(saved[0].label ?? ""), `Gerät gespeichert mit Namen (${saved[0]?.label})`);
  const keys = await api(app, "GET", "push_subscriptions?select=p256dh,auth");
  check(keys.status >= 400, `API: Geräteschlüssel sind nicht lesbar (${keys.status})`);
  const foreign = (await api(bob, "GET", "push_subscriptions?select=endpoint")).json ?? [];
  check(Array.isArray(foreign) && foreign.length === 0, "API: Bob sieht Carols Gerät nicht");
  const claim = await api(bob, "POST", "rpc/claim_push_batch", { p_limit: 10 });
  check(claim.status >= 400, `API: Angemeldete holen keine Pushs ab (${claim.status})`);

  // P4 Etappe 3: je Gerät wählen, was ankommt – „Nur das Wichtigste“, einzelne Gruppe, „Alles“.
  const pick = page.getByTestId("push-pick");
  await pick.waitFor();
  check((await page.getByTestId("push-pick-status").innerText()).trim() === "Alles", "neues Gerät bekommt erst einmal alles");
  const pickSaved = () => page.waitForResponse((r) => r.url().includes("/rpc/set_push_muted_types") && r.request().method() === "POST");
  let saving = pickSaved();
  await pick.getByRole("button", { name: "Nur das Wichtigste" }).click();
  check((await saving).ok(), "„Nur das Wichtigste“ gespeichert");
  await toast(app, "Für dieses Gerät gespeichert.");
  check((await pick.locator('button[data-group="answers"]').getAttribute("aria-pressed")) === "false", "„Neue Antworten“ ist auf dem Gerät stumm");
  check((await pick.locator('button[data-group="plans"]').getAttribute("aria-pressed")) === "true", "Pläne kommen weiter aufs Gerät");
  check((await pick.getByRole("button", { name: "Nur das Wichtigste" }).getAttribute("aria-pressed")) === "true", "„Nur das Wichtigste“ ist gedrückt");
  check(/^\d+ von \d+$/.test((await page.getByTestId("push-pick-status").innerText()).trim()), "Pille zählt, was hier ankommt");
  saving = pickSaved();
  await pick.locator('button[data-group="polls"]').click();
  check((await saving).ok(), "„Abstimmungen“ auf dem Gerät stummgeschaltet");
  check((await pick.locator('button[data-group="polls"]').getAttribute("aria-pressed")) === "false", "Gruppe zeigt „aus“");
  const mutedNow = (await api(app, "GET", "push_subscriptions?select=muted_types")).json?.[0]?.muted_types ?? [];
  check(mutedNow.includes("poll_created") && mutedNow.includes("poll_vote") && !mutedNow.includes("plan_created"), `API: Auswahl gespeichert (${mutedNow.join(", ")})`);
  const foreignPick = await api(bob, "POST", "rpc/set_push_muted_types", { p_endpoint: endpoint, p_muted_types: [] });
  check(foreignPick.status >= 400, `API: Bob kann Carols Auswahl nicht ändern (${foreignPick.status})`);
  await pick.scrollIntoViewIfNeeded();
  await shot(app, "61-push-auswahl");
  if (stubHost && DB_URL) {
    const psqlPick = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const muted = await api(bob, "POST", "rpc/create_poll", {
      p_crew_id: ids.crew, p_title: `Stumm-Probe ${RUN}`, p_ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      p_options: [{ title: "Bowling" }, { title: "Kino" }],
      p_description: null, p_meeting_point: null, p_budget_cents: null, p_min_participants: null,
    });
    if (muted.status >= 300) throw new Error(`Abstimmung anlegen fehlgeschlagen (${muted.status} ${muted.json?.message})`);
    try {
      check(psqlPick(`select count(*) from app_private.push_outbox o join public.notifications n on n.id = o.notification_id where n.related_entity_id = '${muted.json}'`) === "0",
        "stummgeschaltete Abstimmung kommt nicht in die Warteschlange des Geräts");
      const inApp = (await api(app, "GET", `notifications?select=id&related_entity_id=eq.${muted.json}`)).json ?? [];
      check(inApp.length === 1, "in der App bekommt Carol die Abstimmung trotzdem");
    } finally {
      psqlPick(`delete from public.polls where id = '${muted.json}'`);
    }
  }
  saving = pickSaved();
  await pick.getByRole("button", { name: "Alles", exact: true }).click();
  check((await saving).ok(), "„Alles“ gespeichert");
  check(((await api(app, "GET", "push_subscriptions?select=muted_types")).json?.[0]?.muted_types ?? ["?"]).length === 0, "„Alles“: nichts mehr stumm");
  check((await page.getByTestId("push-pick-status").innerText()).trim() === "Alles", "Pille sagt wieder „Alles“");

  if (!stubHost || !DB_URL) {
    console.log("   (Push-Stellvertreter oder E2E_DB_URL fehlt – Versand wird übersprungen)");
  } else {
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    // Nach eigenen Aktionen stößt Carols App den Versand gesammelt nach 1,5 s an. Erst danach die Abstimmung
    // anlegen – sonst verschickt dieser Anstoß sie schon, bevor die Warteschlange geprüft ist.
    await page.waitForTimeout(2500);
    const title = `Push-Probe ${RUN}`;
    const created = await api(bob, "POST", "rpc/create_poll", {
      p_crew_id: ids.crew, p_title: title, p_ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      p_options: [{ title: "Bowling" }, { title: "Kino" }],
      p_description: null, p_meeting_point: null, p_budget_cents: null, p_min_participants: null,
    });
    if (created.status >= 300) throw new Error(`Abstimmung anlegen fehlgeschlagen (${created.status} ${created.json?.message})`);
    const pollId = created.json;
    try {
      check(psql(`select count(*) from app_private.push_outbox o join public.notifications n on n.id = o.notification_id where n.related_entity_id = '${pollId}'`) === "1",
        "die neue Abstimmung liegt für Carols Gerät in der Warteschlange");
      // Wie die App nach einer eigenen Aktion: Bob stößt den Versand an (Rate Limit aus den Schritten davor zurückgesetzt).
      psql(`delete from public.rate_limit_hits where action = 'push_kick'`);
      const response = await fetch(`${API}/functions/v1/push`, {
        method: "POST",
        headers: { apikey: ANON, Authorization: `Bearer ${await token(bob)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const sent = await response.json().catch(() => ({}));
      check(response.status === 200 && sent.configured === true, `Function verschickt (${response.status} ${JSON.stringify(sent)})`);
      let entries = [];
      for (let i = 0; i < 20 && entries.length === 0; i++) {
        entries = await (await fetch(`${stubUrl}/push-log/${deviceName}`)).json();
        if (entries.length === 0) await page.waitForTimeout(500);
      }
      check(entries.length === 1, `genau ein Push beim Push-Dienst (${entries.length})`);
      const entry = entries[0];
      check(entry?.headers["content-encoding"] === "aes128gcm" && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/.test(entry?.headers.authorization ?? "") && entry?.headers.ttl === "43200",
        "Push ist verschlüsselt (aes128gcm), mit VAPID signiert, 12 Stunden haltbar");
      const body = Buffer.from(entry?.body ?? "", "base64");
      check(!body.toString("latin1").includes(title), "der Push-Dienst sieht den Titel nicht im Klartext");
      const plain = decryptWebPush(body, device, authSecret);
      const message = JSON.parse(plain);
      check(message.type === "poll_created" && message.actor === "Bob" && message.payload?.title === title && message.entity_id === pollId,
        `das Gerät entschlüsselt Art, Name und Titel (${message.type}, ${message.actor})`);
      check(!plain.includes("@example.com"), "keine E-Mail-Adressen im Push");
      check(psql(`select count(*) from app_private.push_outbox o join public.notifications n on n.id = o.notification_id where n.related_entity_id = '${pollId}'`) === "0",
        "nach dem Versand ist die Warteschlange leer");

      // Texte des Service Workers: dasselbe Skript, das sw.js per importScripts lädt (gebaut aus src/push/render.ts).
      await page.addScriptTag({ url: "/push-texts.js" });
      const rendered = await page.evaluate((m) => window.AfterhoursPush.render(m), message);
      check(rendered.title === "Bob hat eine Abstimmung gestartet" && rendered.body === title && rendered.url === `/polls/${pollId}` && rendered.tag === message.id,
        `push-texts.js macht daraus die Mitteilung mit dem Text der App (${rendered.title} – ${rendered.body})`);

      // Die Anzeige selbst (showNotification im Service Worker) prüft die Journey nicht: Headless-Chromium beendet
      // beim Zustellen eines Pushs per DevTools-Protokoll den Tab („Target crashed“). Die Texte kommen aus
      // demselben push-texts.js wie oben; Anzeige und Antippen stehen im README unter „Nicht geprüft“.
    } finally {
      psql(`delete from public.polls where id = '${pollId}'`);
    }
  }

  // Ausschalten: Gerät abgemeldet, beim Push-Dienst gekündigt.
  await panel.getByRole("switch", { name: /Mitteilungen auf diesem Gerät/ }).click();
  await toast(app, "Push-Mitteilungen auf diesem Gerät sind aus.");
  await page.locator('[data-testid="push-panel"][data-state="off"]').waitFor();
  check(((await api(app, "GET", "push_subscriptions?select=endpoint")).json ?? []).length === 0, "ausgeschaltet: Gerät ist abgemeldet");
  check((await page.evaluate(() => localStorage.getItem("afterhours.e2e.push"))) === null, "und das Abo beim Push-Dienst gekündigt");
  await context.close();
});

await step("P18 – „Schon verplant“: eigene Pläne beim Abstimmen über Termine, auf der Abstimmung und auf Home (Bob, Carol)", async () => {
  if (!DB_URL || !ANON) {
    console.log("   (E2E_DB_URL/SUPABASE_ANON_KEY nicht gesetzt – übersprungen)");
    return;
  }
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const uidOf = (user) => psql(`select id from auth.users where email = '${user.email}'`);
  const [bobId, carolId] = [uidOf(bob), uidOf(carol)];
  const berlinDate = (offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const label = (date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`));
  const [d1, d2, d3] = [berlinDate(20), berlinDate(21), berlinDate(22)];
  const [l1, l2, l3] = [label(d1), label(d2), label(d3)];
  // Pläne der Crew um die drei Termine: Bob ist beim Kino dabei, beim Brunch „vielleicht“, zum Flohmarkt
  // (Carol) nur eingeladen, bei der Hütte dabei – die ist aber abgesagt.
  const plans = {
    kino: { id: crypto.randomUUID(), title: `Kino ${RUN}`, at: `${d1} 19:30`, status: "confirmed", by: bobId, answers: { [bobId]: "going" } },
    brunch: { id: crypto.randomUUID(), title: `Brunch ${RUN}`, at: `${d2} 11:00`, status: "proposed", by: carolId, answers: { [bobId]: "maybe", [carolId]: "declined" } },
    markt: { id: crypto.randomUUID(), title: `Flohmarkt ${RUN}`, at: `${d2} 20:00`, status: "confirmed", by: carolId, answers: { [carolId]: "going", [bobId]: "invited" } },
    huette: { id: crypto.randomUUID(), title: `Hütte ${RUN}`, at: `${d3} 18:00`, status: "cancelled", by: carolId, answers: { [carolId]: "going", [bobId]: "going" } },
  };
  let pollId = null;
  try {
    for (const p of Object.values(plans)) {
      psql(`insert into public.plans (id, crew_id, created_by, title, starts_at, status)
            values ('${p.id}', '${ids.crew}', '${p.by}', '${p.title}', '${p.at}'::timestamp at time zone 'Europe/Berlin', '${p.status}');
            insert into public.plan_participants (plan_id, user_id, attendance_status)
            select '${p.id}', a.key::uuid, a.value::public.attendance_status from jsonb_each_text('${JSON.stringify(p.answers)}'::jsonb) a
            on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status;`);
    }
    const created = await api(bob, "POST", "rpc/create_date_poll", {
      p_crew_id: ids.crew,
      p_title: `Wann geht's? ${RUN}`,
      p_ends_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      p_slots: [{ date: d1, time: "20:00" }, { date: d2, time: "20:00" }, { date: d3 }],
    });
    check(created.status < 300 && typeof created.json === "string", `Bob startet „Wann könnt ihr?“ mit drei Terminen (${created.status})`);
    pollId = created.json;

    const { page } = bob;
    await page.goto(`${APP}/polls/${pollId}`);
    const busy = (user, option) => optionCard(user, option).getByTestId("poll-option-busy");
    await busy(bob, l1).waitFor();
    const kino = busy(bob, l1);
    check((await kino.innerText()).trim() === `Schon verplant: Kino ${RUN}, 19:30 Uhr` && (await kino.getAttribute("data-kind")) === "overlap",
      `P18: 20:00 überschneidet sich mit Bobs Kino um 19:30 („${(await kino.innerText()).trim()}“)`);
    const brunch = busy(bob, l2);
    check((await brunch.innerText()).trim() === `Am selben Tag: Brunch ${RUN}, 11:00 Uhr` && (await brunch.getAttribute("data-kind")) === "day",
      `P18: „vielleicht“ zählt, nur eingeladen (Flohmarkt 20:00) nicht – daher nur „am selben Tag“ („${(await brunch.innerText()).trim()}“)`);
    check((await busy(bob, l3).count()) === 0, "P18: abgesagte Pläne zählen nicht, Termin ohne Uhrzeit bleibt ohne Hinweis");
    const deck = page.getByTestId("swipe-deck");
    check(await deck.getByText(`Schon verplant: Kino ${RUN}, 19:30 Uhr`).isVisible(), "P18: auch die oberste Karte im Stapel sagt es");
    check((await deck.getByRole("link", { name: /Kino/ }).count()) === 0, "P18: im Stapel kein Link (Karten dahinter sind für Screenreader ausgeblendet)");
    await noOverflow(bob, "Abstimmung mit „Schon verplant“");
    await a11y(bob, "abstimmung-schon-verplant");
    await shot(bob, "62-schon-verplant");
    await kino.getByRole("link", { name: `Schon verplant: Kino ${RUN}, 19:30 Uhr` }).click();
    await page.waitForURL(new RegExp(`/plans/${plans.kino.id}$`));
    await page.getByRole("heading", { level: 1, name: `Kino ${RUN}` }).waitFor();
    check(true, "P18: ein Tipp auf den Hinweis führt zum Plan");

    // Jede Person sieht nur ihre eigenen Pläne: Carol ist beim Flohmarkt dabei, beim Kino nur eingeladen.
    await carol.page.goto(`${APP}/polls/${pollId}`);
    await busy(carol, l2).waitFor();
    check((await busy(carol, l2).innerText()).trim() === `Schon verplant: Flohmarkt ${RUN}, 20:00 Uhr`, "P18: Carol sieht ihren Flohmarkt um 20:00");
    check((await busy(carol, l1).count()) === 0, "P18: Bobs Kino taucht bei Carol nicht auf");

    // Etappe 2: Auch beim Abstimmen direkt auf Home („Deine Antwort fehlt“) steht der Hinweis unter dem Vorschlag.
    await carol.page.goto(`${APP}/home`);
    const quick = carol.page.getByRole("region", { name: `Gleich hier abstimmen: Wann geht's? ${RUN}` });
    await quick.getByTestId("poll-quick-option").waitFor();
    check((await quick.getByTestId("poll-quick-option").innerText()).trim().toLowerCase() === l1.toLowerCase() && (await quick.getByTestId("poll-option-busy").count()) === 0,
      "P18 Etappe 2: Home – erster Termin ohne Hinweis (Carol ist beim Kino nur eingeladen)");
    await quick.getByRole("button", { name: "Überspringen" }).click();
    await quick.getByTestId("poll-option-busy").waitFor();
    check((await quick.getByTestId("poll-option-busy").innerText()).trim() === `Schon verplant: Flohmarkt ${RUN}, 20:00 Uhr`, "P18 Etappe 2: Home – nächster Termin sagt „Schon verplant: Flohmarkt“");
    await noOverflow(carol, "Home mit „Schon verplant“");
    await a11y(carol, "home-schon-verplant");

    // Ist die Abstimmung vorbei, verschwinden die Hinweise.
    check((await api(bob, "POST", "rpc/close_poll", { p_poll_id: pollId })).status < 300, "P18: Bob beendet die Abstimmung");
    await page.goto(`${APP}/polls/${pollId}`);
    await page.getByText("Beendet", { exact: true }).first().waitFor();
    check((await page.getByTestId("poll-option-busy").count()) === 0, "P18: beendete Abstimmung ohne Hinweise");
  } finally {
    if (pollId) psql(`delete from public.polls where id = '${pollId}'`);
    psql(`delete from public.plans where id in (${Object.values(plans).map((p) => `'${p.id}'`).join(", ")})`);
  }
});

await step("P20 – Geburtstage in der Crew: eintragen, „Bald Geburtstag“, Feier planen, entfernen (Bob, Carol)", async () => {
  if (!DB_URL || !ANON) {
    console.log("   (E2E_DB_URL/SUPABASE_ANON_KEY nicht gesetzt – übersprungen)");
    return;
  }
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const bobName = psql(`select p.display_name from public.profiles p join auth.users u on u.id = p.id where u.email = '${bob.email}'`);
  const berlinDate = (offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const birthday = berlinDate(5);
  const [, month, day] = birthday.split("-").map(Number);
  const longDate = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${birthday}T12:00:00Z`));
  const dayMonth = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${birthday}T12:00:00Z`));

  // Bob trägt Tag und Monat ein (ohne Jahr).
  const { page } = bob;
  await page.goto(`${APP}/settings#birthday`);
  const card = page.locator("section#birthday");
  await card.getByLabel("Tag").waitFor();
  check((await card.getByTestId("birthday-status").count()) === 0, "P20: ohne Eintrag kein Geburtstag in den Einstellungen");
  await card.getByRole("button", { name: "Geburtstag speichern" }).click();
  await card.getByText("Wähl Tag und Monat aus.").waitFor();
  check(true, "P20: ohne Tag und Monat wird nichts gespeichert");
  await card.getByLabel("Monat").selectOption(String(month));
  await card.getByLabel("Tag").selectOption(String(day));
  await card.getByRole("button", { name: "Geburtstag speichern" }).click();
  await toast(bob, "Geburtstag gespeichert.");
  await card.getByTestId("birthday-status").waitFor();
  check((await card.getByTestId("birthday-status").innerText()).trim() === dayMonth, `P20: Stand als Pille „${dayMonth}“`);
  check(psql(`select b.month || '-' || b.day from public.birthdays b join auth.users u on u.id = b.user_id where u.email = '${bob.email}'`) === `${month}-${day}`,
    "P20: gespeichert sind nur Tag und Monat");
  await noOverflow(bob, "Einstellungen mit Geburtstag");
  await a11y(bob, "einstellungen-geburtstag");
  await shot(bob, "63-geburtstag-einstellungen");

  // Carol sieht auf der Crew-Seite „Bald Geburtstag“ – und den Hinweis, ihren eigenen einzutragen.
  await carol.page.goto(`${APP}/crews/${ids.crew}`);
  const panel = carol.page.getByTestId("crew-birthdays");
  await panel.getByTestId("crew-birthday").first().waitFor();
  const row = panel.getByTestId("crew-birthday").filter({ hasText: bobName });
  check((await row.count()) === 1 && (await row.innerText()).includes("in 5 Tagen") && (await row.innerText()).includes(longDate),
    `P20: Carol sieht Bobs Geburtstag „${longDate}“ in 5 Tagen`);
  check(await panel.getByTestId("crew-birthday-add").isVisible(), "P20: Carol ohne Eintrag sieht „Geburtstag eintragen“");
  await noOverflow(carol, "Crew-Seite mit Geburtstag");
  await a11y(carol, "crew-geburtstage");
  await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(carol, "64-crew-geburtstage");

  // Bob selbst sieht „Dein Geburtstag“ ohne „Feier planen“ und ohne Hinweis.
  await page.goto(`${APP}/crews/${ids.crew}`);
  const own = page.getByTestId("crew-birthdays");
  await own.getByTestId("crew-birthday").first().waitFor();
  check((await own.getByText("Dein Geburtstag").count()) === 1 && (await own.getByRole("link", { name: /Feier/ }).count()) === 0 && (await own.getByTestId("crew-birthday-add").count()) === 0,
    "P20: Bob sieht „Dein Geburtstag“, ohne „Feier planen“ und ohne Hinweis");

  // Etappe 2: Auf Home sieht Carol „Bald Geburtstag“ (nächste 7 Tage) mit Crew und „Feier planen“ – Bob nicht.
  const crewName = psql(`select name from public.crews where id = '${ids.crew}'`);
  await carol.page.goto(`${APP}/`);
  const homeCard = carol.page.getByTestId("home-birthdays");
  await homeCard.getByTestId("crew-birthday").first().waitFor();
  const homeRow = homeCard.getByTestId("crew-birthday").filter({ hasText: bobName });
  const homeText = (await homeRow.count()) === 1 ? await homeRow.innerText() : "";
  check(homeText.includes("in 5 Tagen") && homeText.includes(longDate) && homeText.includes(crewName),
    `P20 Etappe 2: Carol sieht auf Home Bobs Geburtstag „${longDate}“ mit „${crewName}“ in 5 Tagen`);
  check(await homeRow.getByRole("link", { name: `Feier für ${bobName} planen` }).isVisible(), "P20 Etappe 2: „Feier planen“ auch auf Home");
  await noOverflow(carol, "Home mit Geburtstag");
  await a11y(carol, "home-geburtstage");
  await homeCard.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(carol, "66-geburtstag-home");
  await page.goto(`${APP}/`);
  await page.waitForLoadState("networkidle");
  check((await page.getByTestId("home-birthdays").count()) === 0, "P20 Etappe 2: Bob sieht seinen eigenen Geburtstag nicht auf Home");

  // Etappe 2: Erinnerung eine Woche vorher – an die Crew, nicht an Bob, genau einmal; führt zu „Bald Geburtstag“.
  const reminders = (email) => psql(`select count(*) from public.notifications n join auth.users u on u.id = n.user_id
    where u.email = '${email}' and n.type = 'birthday_reminder'`);
  await carol.page.goto(`${APP}/notifications`);
  const note = carol.page.getByRole("link", { name: new RegExp(`${bobName} hat am ${longDate} Geburtstag`) });
  await note.waitFor();
  check((await note.innerText()).includes(`Feier planen mit „${crewName}“?`), "P20 Etappe 2: Carol bekommt „… hat am … Geburtstag – Feier planen?“");
  await noOverflow(carol, "Geburtstags-Erinnerung");
  await shot(carol, "67-geburtstag-erinnerung");
  check(reminders(carol.email) === "1", "P20 Etappe 2: genau eine Erinnerung für Carol");
  check(reminders(bob.email) === "0", "P20 Etappe 2: das Geburtstagskind bekommt keine Erinnerung");
  await carol.page.reload();
  await note.waitFor();
  check(reminders(carol.email) === "1" && (await note.count()) === 1, "P20 Etappe 2: Neuladen erinnert nicht noch einmal");
  await note.click();
  await carol.page.waitForURL(`**/crews/${ids.crew}#geburtstage`);
  await carol.page.getByTestId("crew-birthdays").getByTestId("crew-birthday").first().waitFor();
  check(true, "P20 Etappe 2: Erinnerung führt zur Karte „Bald Geburtstag“");
  if (ANON) {
    const res = await fetch(`${API}/rest/v1/rpc/send_birthday_reminders`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: "{}",
    });
    check(res.status === 401 || res.status === 403, `P20 Etappe 2: ohne Anmeldung kein Anstoßen (${res.status})`);
  }
  await carol.page.goto(`${APP}/crews/${ids.crew}`);
  await carol.page.getByTestId("crew-birthday").first().waitFor();

  // „Feier planen“ → Termin-Abstimmung rund um den Geburtstag, Frage vorbelegt.
  await row.getByRole("link", { name: `Feier für ${bobName} planen` }).click();
  await carol.page.waitForURL(/\/polls\/new\?/);
  await carol.page.getByTestId("date-birthday-hint").waitFor();
  check((await carol.page.getByLabel("Frage an die Crew").inputValue()) === `Geburtstag von ${bobName} – wann feiern wir?`, "P20: Frage „Geburtstag von … – wann feiern wir?“ vorbelegt");
  const slotCount = await carol.page.getByTestId("poll-form-slot").count();
  check(slotCount >= 2 && slotCount <= 4, `P20: ${slotCount} Termine rund um den Geburtstag vorgeschlagen`);
  await noOverflow(carol, "Feier planen");
  await shot(carol, "65-geburtstag-feier-planen");

  // Ungültiges Datum im Link: normale Termin-Abstimmung.
  await carol.page.goto(`${APP}/polls/new?crew=${ids.crew}&kind=date&birthday=2020-01-01&for=Bob`);
  await carol.page.getByTestId("poll-form-dates").waitFor();
  check((await carol.page.getByTestId("date-birthday-hint").count()) === 0 && (await carol.page.getByLabel("Frage an die Crew").inputValue()) === "Wann könnt ihr?",
    "P20: vergangenes Datum im Link wird ignoriert");

  // Bob entfernt seinen Geburtstag wieder.
  await page.goto(`${APP}/settings#birthday`);
  await card.getByRole("button", { name: "Entfernen" }).click();
  await toast(bob, "Geburtstag entfernt.");
  check(psql(`select count(*) from public.birthdays b join auth.users u on u.id = b.user_id where u.email = '${bob.email}'`) === "0", "P20: entfernt ist entfernt");
  await carol.page.goto(`${APP}/crews/${ids.crew}`);
  await carol.page.getByTestId("crew-birthday-add").waitFor();
  check((await carol.page.getByTestId("crew-birthday").count()) === 0, "P20: danach sieht Carol nur noch den Hinweis");
  await carol.page.goto(`${APP}/`);
  await carol.page.waitForLoadState("networkidle");
  check((await carol.page.getByTestId("home-birthdays").count()) === 0, "P20 Etappe 2: danach auch auf Home nichts mehr");
});

await step("P21 – „Bin weg“: Zeitraum eintragen, „Nicht da“ bei „Wann könnt ihr?“, entfernen (Bob, Carol)", async () => {
  if (!DB_URL || !ANON) {
    console.log("   (E2E_DB_URL/SUPABASE_ANON_KEY nicht gesetzt – übersprungen)");
    return;
  }
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const bobName = psql(`select p.display_name from public.profiles p join auth.users u on u.id = p.id where u.email = '${bob.email}'`);
  const berlinDate = (offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const label = (date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`));
  const [d1, d2, d3] = [berlinDate(40), berlinDate(41), berlinDate(42)];
  const [l1, l2, l3] = [label(d1), label(d2), label(d3)];

  // Bob trägt ein, dass er an den ersten beiden Terminen weg ist.
  const { page } = bob;
  await page.goto(`${APP}/settings#absences`);
  const card = page.locator("section#absences");
  await card.getByText("Gerade nichts eingetragen.").waitFor();
  check((await card.getByTestId("absences-status").count()) === 0, "P21: ohne Eintrag keine Pille");
  await card.getByRole("button", { name: "Eintragen" }).click();
  await card.getByText("Wähl Beginn und Ende aus.").waitFor();
  check(true, "P21: ohne Tage wird nichts eingetragen");
  await card.getByLabel("Von").fill(d1);
  await card.getByLabel("Bis").fill(d2);
  await card.getByRole("button", { name: "Eintragen" }).click();
  await toast(bob, "Eingetragen.");
  await card.getByTestId("absence").first().waitFor();
  check((await card.getByTestId("absence").count()) === 1 && (await card.getByTestId("absence").innerText()).includes("2 Tage"), "P21: Zeitraum mit „2 Tage“ in der Liste");
  check((await card.getByTestId("absences-status").innerText()).trim() === "1 Zeitraum", "P21: Stand als Pille „1 Zeitraum“");
  check(psql(`select a.starts_on || '/' || a.ends_on from public.absences a join auth.users u on u.id = a.user_id where u.email = '${bob.email}'`) === `${d1}/${d2}`,
    "P21: gespeichert sind nur Beginn und Ende");
  await noOverflow(bob, "Einstellungen mit „Bin weg“");
  await a11y(bob, "einstellungen-bin-weg");
  await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(bob, "68-bin-weg-einstellungen");

  let pollId = null;
  try {
    const created = await api(bob, "POST", "rpc/create_date_poll", {
      p_crew_id: ids.crew,
      p_title: `Wann passt's? ${RUN}`,
      p_ends_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      p_slots: [{ date: d1, time: "20:00" }, { date: d2 }, { date: d3, time: "19:00" }],
    });
    check(created.status < 300 && typeof created.json === "string", `P21: Bob startet „Wann könnt ihr?“ mit drei Terminen (${created.status})`);
    pollId = created.json;

    // Carol sieht unter den ersten beiden Terminen „Nicht da: Bob“, unter dem dritten nichts.
    const away = (user, option) => optionCard(user, option).getByTestId("poll-option-away");
    await carol.page.goto(`${APP}/polls/${pollId}`);
    await away(carol, l1).waitFor();
    check((await away(carol, l1).innerText()).trim() === `Nicht da: ${bobName}`, `P21: Carol sieht „Nicht da: ${bobName}“ am ${l1}`);
    check((await away(carol, l2).innerText()).trim() === `Nicht da: ${bobName}`, "P21: auch am Termin ohne Uhrzeit");
    check((await away(carol, l3).count()) === 0, "P21: am dritten Termin ist niemand weg");
    check(await carol.page.getByTestId("swipe-deck").getByText(`Nicht da: ${bobName}`).first().isVisible(), "P21: auch die oberste Karte im Stapel sagt es");
    await noOverflow(carol, "Abstimmung mit „Nicht da“");
    await a11y(carol, "abstimmung-nicht-da");
    await optionCard(carol, l1).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(carol, "69-bin-weg-abstimmung");

    // Bob sieht sich selbst als „du“.
    await page.goto(`${APP}/polls/${pollId}`);
    await away(bob, l1).waitFor();
    check((await away(bob, l1).innerText()).trim() === "Nicht da: du", "P21: Bob sieht „Nicht da: du“");

    // Ohne Anmeldung keine Abwesenheiten.
    const res = await fetch(`${API}/rest/v1/rpc/crew_absences`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_crew_id: ids.crew }),
    });
    check(res.status === 401 || res.status === 403, `P21: ohne Anmeldung keine Abwesenheiten (${res.status})`);

    // Bob entfernt den Zeitraum – danach steht bei Carol nichts mehr.
    await page.goto(`${APP}/settings#absences`);
    await card.getByRole("button", { name: /entfernen$/ }).click();
    await toast(bob, "Entfernt.");
    await card.getByText("Gerade nichts eingetragen.").waitFor();
    check(psql(`select count(*) from public.absences a join auth.users u on u.id = a.user_id where u.email = '${bob.email}'`) === "0", "P21: entfernt ist entfernt");
    await carol.page.goto(`${APP}/polls/${pollId}`);
    await optionCard(carol, l1).waitFor();
    await carol.page.waitForLoadState("networkidle");
    check((await carol.page.getByTestId("poll-option-away").count()) === 0, "P21: danach sieht Carol keinen Hinweis mehr");
  } finally {
    if (pollId) psql(`delete from public.polls where id = '${pollId}'`);
    psql(`delete from public.absences a using auth.users u where u.id = a.user_id and u.email = '${bob.email}'`);
  }
});

await step("P21 Etappe 2 – „Gerade weg“ auf der Crew-Seite, beim Anlegen von „Wann könnt ihr?“ und auf Home (Bob, Carol)", async () => {
  if (!DB_URL || !ANON) {
    console.log("   (E2E_DB_URL/SUPABASE_ANON_KEY nicht gesetzt – übersprungen)");
    return;
  }
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const bobName = psql(`select p.display_name from public.profiles p join auth.users u on u.id = p.id where u.email = '${bob.email}'`);
  const berlinDate = (offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const short = (date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
  const [d0, d1, d2, d5] = [berlinDate(0), berlinDate(1), berlinDate(2), berlinDate(5)];
  const title = `Wer kann? ${RUN}`;
  let pollId = null;
  try {
    // Bob ist ab heute drei Tage weg (eingetragen wie über „Bin weg“, hier direkt in der Datenbank).
    psql(`insert into public.absences (user_id, starts_on, ends_on) select id, '${d0}', '${d2}' from auth.users where email = '${bob.email}'`);

    // Crew-Seite: Carol sieht „Gerade weg“ mit Bob und „bis …“, dazu den Weg zum eigenen Eintrag.
    const { page } = carol;
    await page.goto(`${APP}/crews/${ids.crew}`);
    const card = page.getByTestId("crew-away");
    await card.waitFor();
    check((await card.getByRole("heading").first().textContent())?.trim() === "Gerade weg", "P21 Etappe 2: Karte „Gerade weg“ auf der Crew-Seite");
    const row = card.getByTestId("crew-away-row");
    check((await row.count()) === 1 && (await row.innerText()).includes(bobName), `P21 Etappe 2: ${bobName} steht drin`);
    const until = (await row.innerText()).replace(/\s+/g, " ");
    check(/\bbis \S/.test(until) && until.includes(short(d2)), `P21 Etappe 2: Pille „bis …“ mit dem letzten Tag ${short(d2)} (${until})`);
    check(await card.getByTestId("crew-away-add").isVisible(), "P21 Etappe 2: Carol (nicht weg) sieht „Selbst bald weg? Eintragen“");
    await noOverflow(carol, "Crew-Seite mit „Gerade weg“");
    await a11y(carol, "crew-gerade-weg");
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(carol, "70-gerade-weg-crew");

    // Bob selbst: „Du“, ohne den Weg zum Eintragen.
    await bob.page.goto(`${APP}/crews/${ids.crew}`);
    await bob.page.getByTestId("crew-away").waitFor();
    check((await bob.page.getByTestId("crew-away-row").innerText()).includes("Du"), "P21 Etappe 2: Bob sieht sich als „Du“");
    check((await bob.page.getByTestId("crew-away-add").count()) === 0, "P21 Etappe 2: kein „Eintragen“ für Bob");

    // Anlegen von „Wann könnt ihr?“: Termin morgen → „Nicht da: Bob“ direkt unter dem Termin; in 5 Tagen nichts.
    await page.goto(`${APP}/polls/new?kind=date&crew=${ids.crew}`);
    const slots = page.getByTestId("poll-form-slot");
    await slots.first().waitFor();
    await slots.nth(0).getByLabel("Termin 1", { exact: true }).fill(d1);
    await slots.nth(1).getByLabel("Termin 2", { exact: true }).fill(d5);
    await slots.nth(0).getByTestId("poll-option-away").waitFor();
    check((await slots.nth(0).getByTestId("poll-option-away").innerText()).trim() === `Nicht da: ${bobName}`, `P21 Etappe 2: beim Anlegen „Nicht da: ${bobName}“ unter Termin 1`);
    check((await slots.nth(1).getByTestId("poll-option-away").count()) === 0, "P21 Etappe 2: unter dem Termin in 5 Tagen nichts");
    await noOverflow(carol, "„Wann könnt ihr?“ anlegen mit „Nicht da“");
    await a11y(carol, "termin-anlegen-nicht-da");
    await slots.nth(0).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(carol, "71-nicht-da-anlegen");

    // Home: Bob fragt nach zwei Terminen, an denen er weg ist – Carol sieht es beim Abstimmen auf Home.
    const created = await api(bob, "POST", "rpc/create_date_poll", {
      p_crew_id: ids.crew,
      p_title: title,
      p_ends_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      p_slots: [{ date: d1, time: "20:00" }, { date: d2, time: "19:00" }],
    });
    check(created.status < 300 && typeof created.json === "string", `P21 Etappe 2: Bob startet „Wann könnt ihr?“ (${created.status})`);
    pollId = created.json;
    await page.goto(`${APP}/`);
    const mine = page.locator(`section[aria-label="Gleich hier abstimmen: ${title}"]`);
    await mine.waitFor();
    await mine.getByTestId("poll-option-away").waitFor();
    check((await mine.getByTestId("poll-option-away").innerText()).trim() === `Nicht da: ${bobName}`, `P21 Etappe 2: auf Home „Nicht da: ${bobName}“ beim Abstimmen`);
    await noOverflow(carol, "Home mit „Nicht da“");
    await mine.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(carol, "72-nicht-da-home");

    // Vorbei: ohne Eintrag keine Karte mehr auf der Crew-Seite.
    psql(`delete from public.absences a using auth.users u where u.id = a.user_id and u.email = '${bob.email}'`);
    await page.goto(`${APP}/crews/${ids.crew}`);
    await page.waitForLoadState("networkidle");
    check((await page.getByTestId("crew-away").count()) === 0, "P21 Etappe 2: ohne Abwesende keine Karte");
  } finally {
    if (pollId) psql(`delete from public.polls where id = '${pollId}'`);
    psql(`delete from public.absences a using auth.users u where u.id = a.user_id and u.email = '${bob.email}'`);
  }
});

await step("P22 – „Wollen wir mal hin“: Orte für die Crew merken, Liste, Abstimmung daraus, entfernen (Bob, Carol)", async () => {
  if (!DB_URL || !ANON) {
    console.log("   (E2E_DB_URL/SUPABASE_ANON_KEY nicht gesetzt – übersprungen)");
    return;
  }
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const carolName = psql(`select p.display_name from public.profiles p join auth.users u on u.id = p.id where u.email = '${carol.email}'`);
  const crewName = psql(`select name from public.crews where id = '${ids.crew}'`);
  const placeId = (name) => psql(`select id from public.activities where name = '${name}' and is_active order by created_at limit 1`);
  const bowling = placeId("Strike District Bowling");
  const cinema = placeId("Lichtspielhaus Nord");
  const bobCrews = Number(psql(`select count(*) from public.crew_members m join auth.users u on u.id = m.user_id where u.email = '${bob.email}'`));
  psql(`delete from public.crew_wishes where crew_id = '${ids.crew}'`);
  const { page } = bob;
  let visitPlan = null;
  try {
    // Leer: Hinweis mit Weg nach Discover (Bob, 390 px).
    await page.goto(`${APP}/crews/${ids.crew}`);
    const panel = page.getByTestId("crew-wishlist");
    await panel.getByTestId("crew-wishlist-empty").waitFor();
    check((await panel.getByRole("heading").first().textContent())?.trim() === "Wollen wir mal hin", "P22: Karte „Wollen wir mal hin“ auf der Crew-Seite");
    check(await panel.getByRole("link", { name: "Orte entdecken" }).isVisible(), "P22: leere Liste führt nach Discover");
    await noOverflow(bob, "Crew-Seite mit leerer Merkliste");
    await a11y(bob, "crew-merkliste-leer");
    await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(bob, "73-merkliste-leer");

    // Ortsseite: „Für die Crew merken“ – danach führt der Knopf zur Liste.
    await page.goto(`${APP}/activities/${bowling}`);
    const add = page.getByTestId("wish-add");
    await add.waitFor();
    check((await add.innerText()).trim() === "Für die Crew merken", "P22: Knopf „Für die Crew merken“ auf der Ortsseite");
    await add.click();
    if (bobCrews > 1) await page.getByRole("button", { name: `Für „${crewName}“ merken` }).click();
    await toast(bob, `Gemerkt für „${crewName}“`);
    check(psql(`select count(*) from public.crew_wishes where crew_id = '${ids.crew}' and activity_id = '${bowling}'`) === "1", "P22: Ort steht auf der Liste der Crew");
    if (bobCrews === 1) {
      await page.getByTestId("wish-saved").waitFor();
      check((await page.getByTestId("wish-saved").innerText()).trim() === "Auf eurer Merkliste", "P22: danach „Auf eurer Merkliste“");
      await noOverflow(bob, "Ortsseite gemerkt");
      await a11y(bob, "ort-gemerkt");
      await page.getByTestId("wish-saved").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(bob, "74-ort-gemerkt");
    } else {
      await page.keyboard.press("Escape");
    }

    // Carol merkt das Kino (über die API); doppelt merken ändert nichts. Ohne Anmeldung: nichts.
    const carolAdd = await api(carol, "POST", "rpc/add_crew_wish", { p_crew_id: ids.crew, p_activity_id: cinema });
    check(carolAdd.status < 300, `P22: Carol merkt „Lichtspielhaus Nord“ (${carolAdd.status})`);
    await api(carol, "POST", "rpc/add_crew_wish", { p_crew_id: ids.crew, p_activity_id: cinema });
    check(psql(`select count(*) from public.crew_wishes where crew_id = '${ids.crew}'`) === "2", "P22: doppelt gemerkt steht einmal da");
    const anon = await api(null, "POST", "rpc/crew_wishes", { p_crew_id: ids.crew });
    check(anon.status === 401 || anon.status === 403, `P22: ohne Anmeldung keine Merkliste (${anon.status})`);

    // Crew-Seite: neueste zuerst, wer gemerkt hat, Entfernen nur beim eigenen Eintrag (Bob ist Mitglied).
    await page.goto(`${APP}/crews/${ids.crew}#merkliste`);
    const rows = panel.getByTestId("crew-wish");
    await rows.nth(1).waitFor();
    const first = await rows.nth(0).innerText();
    const second = await rows.nth(1).innerText();
    check(first.includes("Lichtspielhaus Nord") && second.includes("Strike District Bowling"), "P22: neueste zuerst");
    check(first.includes(`gemerkt von ${carolName}`) && second.includes("von dir gemerkt"), "P22: wer gemerkt hat");
    check((await rows.nth(0).getByTestId("crew-wish-remove").count()) === 0 && (await rows.nth(1).getByTestId("crew-wish-remove").count()) === 1,
      "P22: Bob darf nur seinen eigenen Eintrag entfernen");
    check((await panel.getByTestId("crew-wishlist-count").innerText()).trim() === "2 Orte", "P22: Stand „2 Orte“");
    check((await panel.getByText("Demo").count()) >= 1, "P22: Demo-Orte sind als Demo gekennzeichnet");
    await noOverflow(bob, "Crew-Seite mit Merkliste");
    await a11y(bob, "crew-merkliste");
    await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(bob, "75-merkliste-crew");

    // „Abstimmung daraus“: beide Orte im Formular, Crew vorausgewählt.
    await panel.getByTestId("crew-wishlist-poll").click();
    await page.waitForURL(new RegExp(`/polls/new\\?crew=${ids.crew}`));
    const options = page.getByTestId("poll-form-option");
    await options.nth(1).waitFor();
    const optionText = (await options.allInnerTexts()).join(" | ");
    check((await options.count()) === 2 && optionText.includes("Lichtspielhaus Nord") && optionText.includes("Strike District Bowling"),
      `P22: Abstimmung mit beiden gemerkten Orten (${optionText.replace(/\s+/g, " ")})`);
    await noOverflow(bob, "Abstimmung aus der Merkliste");
    await shot(bob, "76-merkliste-abstimmung");

    // Etappe 2 – „Von eurer Liste“ im Formular: Beide Orte sind schon gewählt, also keine Pillen. Nimmt Bob das Kino
    // heraus, steht es als Pille da; ein Tipp nimmt es mit Kategorie wieder dazu, danach ist die Pille weg.
    check((await page.getByTestId("poll-form-wishes").count()) === 0, "P22: alles von der Liste gewählt – keine Pillen „Von eurer Liste“");
    await page.getByRole("button", { name: "Lichtspielhaus Nord entfernen" }).click();
    const wishBox = page.getByTestId("poll-form-wishes");
    await wishBox.waitFor();
    check((await wishBox.innerText()).includes("Von eurer Liste"), "P22: „Von eurer Liste“ erscheint, sobald ein gemerkter Ort fehlt");
    const pills = wishBox.getByTestId("poll-form-wish");
    check((await pills.count()) === 1 && (await pills.first().innerText()).includes("Lichtspielhaus Nord"), "P22: nur der fehlende Ort als Pille");
    await noOverflow(bob, "Abstimmung mit „Von eurer Liste“");
    await a11y(bob, "abstimmung-von-eurer-liste");
    await wishBox.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(bob, "77-abstimmung-von-eurer-liste");
    await page.getByRole("button", { name: "„Lichtspielhaus Nord“ als Vorschlag dazunehmen" }).click();
    await options.nth(1).waitFor();
    check((await options.count()) === 2 && (await page.getByTestId("poll-form-wishes").count()) === 0, "P22: ein Tipp nimmt den Ort wieder dazu, Pille weg");
    check((await options.nth(1).getAttribute("data-world")) !== null, "P22: Ort von der Liste in der Farbwelt seiner Kategorie");

    // „Waren wir schon“: Die Crew war gestern im Kino (abgeschlossener Plan, hier direkt in der Datenbank) – das ist
    // der letzte Abend dort. Ob sie im Bowling schon war, hängt an früheren Schritten; erwartet wird, was die
    // Datenbank sagt.
    const [visitId, visitAt] = psql(`insert into public.plans (crew_id, created_by, title, starts_at, status, activity_id)
      select '${ids.crew}', u.id, 'Kino-Abend', now() - interval '1 day', 'completed', '${cinema}'
      from auth.users u where u.email = '${carol.email}' returning id || '|' || to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`).split("\n")[0].split("|");
    visitPlan = visitId;
    const berlinYear = (d) => new Intl.DateTimeFormat("en", { timeZone: "Europe/Berlin", year: "numeric" }).format(d);
    const shortDate = (iso) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short",
      ...(berlinYear(new Date(iso)) === berlinYear(new Date()) ? {} : { year: "numeric" }) }).format(new Date(iso));
    const bowlingVisited = psql(`select count(*) from public.plans where crew_id = '${ids.crew}' and activity_id = '${bowling}' and status = 'completed'`) !== "0";
    await page.goto(`${APP}/crews/${ids.crew}#merkliste`);
    const cinemaVisited = rows.nth(0).getByTestId("crew-wish-visited");
    await cinemaVisited.waitFor();
    const cinemaText = (await cinemaVisited.innerText()).trim();
    check(cinemaText === `Waren wir schon · ${shortDate(visitAt)}`, `P22: „Waren wir schon“ am Kino mit dem letzten Abend (${cinemaText})`);
    check((await cinemaVisited.getAttribute("href"))?.endsWith(`/plans/${visitPlan}`), "P22: Hinweis führt zum letzten Abend");
    check((await rows.nth(1).getByTestId("crew-wish-visited").count()) === (bowlingVisited ? 1 : 0),
      `P22: am Bowling nur mit abgeschlossenem Abend der Crew (${bowlingVisited ? "war schon da" : "noch nicht"})`);
    await noOverflow(bob, "Merkliste mit „Waren wir schon“");
    await a11y(bob, "crew-merkliste-waren-wir-schon");
    await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(bob, "78-merkliste-waren-wir-schon");

    // Im Formular rücken besuchte Orte ans Ende und tragen „schon da gewesen“.
    await page.goto(`${APP}/polls/new?crew=${ids.crew}`);
    await page.evaluate(() => sessionStorage.removeItem("afterhours.poll-draft"));
    await page.reload();
    const wishPills = page.getByTestId("poll-form-wish");
    await wishPills.nth(1).waitFor();
    const pillTexts = (await wishPills.allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
    const expected = bowlingVisited
      ? [["Lichtspielhaus Nord", true], ["Strike District Bowling", true]]
      : [["Strike District Bowling", false], ["Lichtspielhaus Nord", true]];
    check(pillTexts.length === 2 && pillTexts.every((x) => x.includes("· Demo"))
      && expected.every(([name, been], i) => pillTexts[i].includes(name) && pillTexts[i].endsWith("· schon da gewesen") === been),
      `P22: Neues zuerst, besuchte Orte mit „schon da gewesen“, Demo gekennzeichnet (${pillTexts.join(" | ")})`);

    // Fremden Eintrag entfernen geht nicht (API), den eigenen schon (Oberfläche).
    const foreign = await api(bob, "POST", "rpc/remove_crew_wish", { p_crew_id: ids.crew, p_activity_id: cinema });
    check(foreign.status === 403, `P22: Bob kann Carols Eintrag nicht entfernen (${foreign.status})`);
    await page.goto(`${APP}/crews/${ids.crew}#merkliste`);
    await rows.nth(1).waitFor();
    await rows.nth(1).getByTestId("crew-wish-remove").click();
    await toast(bob, "„Strike District Bowling“ ist von der Liste.");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="crew-wish"]').length === 1);
    check(psql(`select count(*) from public.crew_wishes where crew_id = '${ids.crew}'`) === "1", "P22: eigener Eintrag entfernt, Carols bleibt");
  } finally {
    psql(`delete from public.crew_wishes where crew_id = '${ids.crew}'`);
    if (visitPlan) psql(`delete from public.plans where id = '${visitPlan}'`);
    await page.evaluate(() => sessionStorage.removeItem("afterhours.poll-draft")).catch(() => {});
  }
});

// P28: Gäste, die über den Link mitgestimmt haben, sehen nach dem Ende, was draus wurde – Gewinner, Plan, Link zum Plan.
await step("P28 – „Was draus wurde“: Ergebnis und Plan auf dem Abstimm-Link für Gäste (Bob, Gast Mira, 390 px)", async () => {
  const pollTitle = "Minigolf oder Billard?";
  const poll = await api(bob, "POST", "rpc/create_poll", {
    p_crew_id: ids.crew,
    p_title: pollTitle,
    p_ends_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
    p_options: [{ title: "Minigolf am Hafen" }, { title: "Billard Eck" }],
  });
  check(poll.status === 200, `P28: Bob startet eine Abstimmung (${poll.status})`);
  await api(bob, "POST", "rpc/set_poll_guests", { p_poll_id: poll.json, p_allowed: true });
  const pollToken = (await api(bob, "POST", "rpc/poll_share_token", { p_poll_id: poll.json })).json;
  const options = (await api(bob, "GET", `poll_options?poll_id=eq.${poll.json}&select=id,position&order=position`)).json ?? [];
  let planId = null;
  const mira = await newUser("Mira", "mobile");
  try {
    // Mira stimmt ohne Konto ab – solange es läuft, kein Ergebnis.
    await mira.page.goto(`${APP}/v/${pollToken}`);
    await mira.page.getByRole("heading", { level: 1, name: "Stimm mit ab" }).waitFor();
    await answer(mira, "Minigolf am Hafen", "Bin dabei").click();
    await mira.page.getByLabel("Dein Name").fill("Mira");
    await mira.page.getByRole("button", { name: "Abstimmen" }).click();
    await mira.page.getByRole("heading", { level: 1, name: "Deine Stimme ist drin, Mira" }).waitFor();
    check((await mira.page.getByTestId("poll-outcome").count()) === 0, "P28: solange die Abstimmung läuft, kein Ergebnis");

    // Bob beendet: Gewinner steht fest, noch kein Plan.
    await api(bob, "POST", "rpc/cast_vote", { p_option_id: options[0].id, p_response: "yes" });
    check((await api(bob, "POST", "rpc/close_poll", { p_poll_id: poll.json })).status < 300, "P28: Bob beendet die Abstimmung");
    await mira.page.reload();
    await mira.page.getByRole("heading", { level: 1, name: "Schon entschieden" }).waitFor();
    const outcome = mira.page.getByRole("region", { name: "Minigolf am Hafen" });
    await outcome.waitFor();
    check((await outcome.innerText()).includes("Noch kein Plan"), "P28: Gewinner ohne Plan – ehrlich „Noch kein Plan“");
    check((await mira.page.getByTestId("shared-poll-card").innerText()).includes("Vor Ablauf der Frist entschieden"), "vorzeitig beendet: keine „Frist war“ mit einer Zeit in der Zukunft");
    check((await mira.page.locator('[data-testid="ballot-option"][data-winner="true"]').innerText()).includes("MINIGOLF"), "P28: der Gewinner ist in der Liste hervorgehoben");
    await shot(mira, "75a-abstimmung-ergebnis-gast");

    // Bob macht einen Plan daraus – geteilt ist er noch nicht: Mira erfährt Titel und Zeit, den Link gibt es im Chat.
    const plan = await api(bob, "POST", "rpc/create_plan_from_poll", {
      p_poll_id: poll.json,
      p_option_id: options[0].id,
      p_starts_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
      p_address: "Hafenstraße 9",
    });
    check(plan.status === 200, `P28: Plan aus der Abstimmung (${plan.status})`);
    planId = plan.json;
    await mira.page.reload();
    const planCard = mira.page.getByTestId("poll-outcome");
    await planCard.getByText("Daraus wurde ein Plan").waitFor();
    check((await planCard.getAttribute("data-answer")) === "yes", "P28: Plan-Karte ganz in Lime");
    check((await planCard.getByTestId("poll-outcome-link").count()) === 0 && (await planCard.getByText("Den Link zum Plan bekommst du im Gruppenchat.").isVisible()), "P28: ohne geteilten Plan kein Link, ehrlicher Hinweis");
    check(!/Hafenstraße|Bob|example\.test/.test(await mira.page.locator("body").innerText()), "P28: keine Adresse, keine Namen der Crew");

    // P28 Etappe 2: Bob teilt das Ergebnis von der Abstimmung aus in den Gruppenchat – mit dem Link des Plans.
    await bob.page.goto(`${APP}/polls/${poll.json}`);
    const share = bob.page.getByRole("button", { name: "Ergebnis teilen" });
    await share.waitFor();
    await stubShare(bob.page);
    await share.click();
    await bob.page.waitForFunction(() => (window.__shared ?? []).length > 0);
    const [shared] = await sharedData(bob.page);
    check(/^Entschieden: Minigolf am Hafen – .+\. Bist du dabei\?$/.test(shared?.text ?? ""), `P28 Etappe 2: Text „Entschieden: …“ (${shared?.text})`);
    const planToken = /\/s\/([0-9a-f]{32})/.exec(shared?.url ?? "")?.[1];
    check(Boolean(planToken), `P28 Etappe 2: geteilt wird der Plan-Link /s/<token> (${shared?.url})`);
    check(!/Hafenstraße|Mira/.test(`${shared?.text} ${shared?.url}`), "P28 Etappe 2: keine Adresse, keine Namen im geteilten Text");
    await unstubShare(bob.page);
    await noOverflow(bob, "Abstimmung entschieden mit „Ergebnis teilen“");
    await a11y(bob, "abstimmung-ergebnis-teilen");
    await bob.page.getByTestId("poll-plan-note").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(bob, "75c-abstimmung-ergebnis-teilen");
    // Mira kommt mit einem Tipp zur Plan-Karte.
    await mira.page.reload();
    const link = mira.page.getByTestId("poll-outcome-link");
    await link.waitFor();
    check((await link.getAttribute("href")) === `/s/${planToken}`, "P28: Link führt zur geteilten Plan-Karte");
    await noOverflow(mira, "Abstimm-Link mit Ergebnis");
    await a11y(mira, "abstimmung-ergebnis-gast");
    await shot(mira, "75b-abstimmung-plan-gast");
    for (const viewport of ["tablet", "desktop"]) {
      await mira.page.setViewportSize(VIEWPORTS[viewport]);
      await shot({ ...mira, viewport }, "75b-abstimmung-plan-gast");
    }
    await mira.page.setViewportSize(VIEWPORTS.mobile);
    check((await mira.page.getByTestId("poll-outcome-quick").count()) === 0, "P28 Etappe 3: ohne Zusagen über den Link keine Ein-Tipp-Zusage");

    // P28 Etappe 3: Bob erlaubt Zusagen über den Link – Mira (beim Gewinner „Bin dabei“) sagt mit einem Tipp zu.
    check((await api(bob, "POST", "rpc/set_plan_guests", { p_plan_id: planId, p_allowed: true })).status < 300, "P28 Etappe 3: Bob erlaubt Zusagen über den Link");
    await mira.page.reload();
    const quick = mira.page.getByTestId("poll-outcome-quick");
    await quick.waitFor();
    check((await quick.innerText()).includes("Du warst für „Minigolf am Hafen“"), "P28 Etappe 3: Frage nennt den Gewinner, für den Mira gestimmt hat");
    check(
      (await mira.page.getByTestId("poll-outcome-link").getAttribute("href")) === `/s/${planToken}`,
      "P28 Etappe 3: der Link zur Plan-Karte bleibt daneben",
    );
    let miraGuests = (await api(bob, "GET", `plan_guests?select=display_name&plan_id=eq.${planId}`)).json ?? [];
    check(miraGuests.length === 0, "P28 Etappe 3: nichts passiert automatisch – vor dem Tipp kein Gast am Plan");
    await noOverflow(mira, "Abstimm-Link mit Ein-Tipp-Zusage");
    await a11y(mira, "abstimmung-ergebnis-zusage");
    await quick.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(mira, "75d-abstimmung-ein-tipp-zusage");
    await quick.getByRole("button", { name: "Bin dabei – als Mira" }).click();
    const done = mira.page.getByTestId("poll-outcome-rsvp");
    await done.waitFor();
    check((await done.innerText()).includes("Du bist dabei, Mira."), "P28 Etappe 3: Zusage bestätigt");
    miraGuests = (await api(bob, "GET", `plan_guests?select=display_name,attendance_status&plan_id=eq.${planId}`)).json ?? [];
    check(
      miraGuests.length === 1 && miraGuests[0].display_name === "Mira" && miraGuests[0].attendance_status === "going",
      `P28 Etappe 3: Mira steht als Gast mit Zusage am Plan (${JSON.stringify(miraGuests)})`,
    );
    await a11y(mira, "abstimmung-ergebnis-zugesagt");
    await shot(mira, "75e-abstimmung-zugesagt");
    for (const viewport of ["tablet", "desktop"]) {
      await mira.page.setViewportSize(VIEWPORTS[viewport]);
      await shot({ ...mira, viewport }, "75e-abstimmung-zugesagt");
    }
    await mira.page.setViewportSize(VIEWPORTS.mobile);

    await link.click();
    await mira.page.waitForURL(new RegExp(`/s/${planToken}$`));
    check(true, "P28: Gast landet auf der Plan-Karte");
    // Dasselbe Gerät, derselbe Gast: die Plan-Karte kennt die Zusage schon.
    await mira.page.getByRole("heading", { level: 1, name: "Hallo Mira" }).waitFor();
    check(true, "P28 Etappe 3: die Plan-Karte zeigt Miras Zusage (kein zweites Antworten)");

    // Ohne die eigene Stimme auf dem Gerät (anderer Browser): Ergebnis ja, Link nein.
    const stranger = await newUser("Fremd", "mobile");
    try {
      await stranger.page.goto(`${APP}/v/${pollToken}`);
      await stranger.page.getByTestId("poll-outcome").getByText("Daraus wurde ein Plan").waitFor();
      check((await stranger.page.getByTestId("poll-outcome-link").count()) === 0, "P28: wer nicht mitgestimmt hat, bekommt keinen Link");
    } finally {
      users.splice(users.indexOf(stranger), 1);
      await stranger.context.close();
    }

    // Abgesagt: Hinweis statt Link, Karte wieder dunkel.
    await api(bob, "POST", "rpc/set_plan_status", { p_plan_id: planId, p_status: "cancelled" });
    await mira.page.goto(`${APP}/v/${pollToken}`);
    const cancelled = mira.page.getByTestId("poll-outcome");
    await cancelled.getByText("Der Plan ist abgesagt.").waitFor();
    check((await cancelled.getAttribute("data-answer")) === null && (await cancelled.getByTestId("poll-outcome-link").count()) === 0, "P28: abgesagt – dunkle Karte, kein Link");
  } finally {
    users.splice(users.indexOf(mira), 1);
    await mira.context.close();
    if (DB_URL) {
      const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
      if (planId) psql(`delete from public.plans where id = '${planId}'`);
      psql(`delete from public.polls where id = '${poll.json}'`);
    }
  }
});

// P12: Google und Apple erscheinen nur, wenn das Supabase-Projekt sie einschaltet (lokal aus – die Probe schaltet sie
// in der Antwort von /auth/v1/settings ein). Der Anbieter selbst ist nicht erreichbar; geprüft wird, wohin der Knopf führt,
// die Rückkehr mit Fehler und das Onboarding eines Kontos, das über Google entstanden ist (Altersbestätigung, Vorname).
await step("P12 – Anmeldung mit Google und Apple: Knöpfe, Weiterleitung, Fehler, Onboarding (Fiona, 390 px)", async () => {
  const fiona = await newUser("Fiona", "mobile");
  const { page } = fiona;
  try {
    // Ohne eingeschaltete Anbieter: nur das E-Mail-Formular.
    const settingsLoaded = page.waitForResponse((r) => r.url().includes("/auth/v1/settings"));
    await page.goto(`${APP}/login`);
    await settingsLoaded;
    await page.getByRole("button", { name: "Anmelden", exact: true }).waitFor();
    check((await page.getByTestId("social-sign-in").count()) === 0, "P12: ohne Anbieter im Projekt keine Google-/Apple-Knöpfe");

    // Anbieter eingeschaltet (Antwort des Projekts verändert), Anbieter-Seite abgefangen.
    await page.route("**/auth/v1/settings", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.external = { ...(json.external ?? {}), google: true, apple: true };
      await route.fulfill({ response, json });
    });
    let authorize = null;
    await page.route("**/auth/v1/authorize**", async (route) => {
      authorize = new URL(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><html lang="de"><title>Anbieter</title><main><h1>Anbieter</h1></main></html>' });
    });
    await page.goto(`${APP}/login`);
    const group = page.getByRole("group", { name: "Mit einem bestehenden Konto weiter" });
    await group.getByRole("button", { name: "Weiter mit Google" }).waitFor();
    const labels = await group.getByRole("button").allInnerTexts();
    check(labels.join("|") === "Weiter mit Google|Weiter mit Apple", `P12: Google und Apple über dem Formular (${labels.join(", ")})`);
    check(await page.getByLabel("E-Mail-Adresse").isVisible(), "P12: E-Mail-Anmeldung bleibt daneben");
    await shot(fiona, "p12-anmeldung-google-apple");

    await page.goto(`${APP}/register`);
    await page.getByRole("button", { name: "Weiter mit Apple" }).waitFor();
    check(await page.getByLabel("Ich bin mindestens 16 Jahre alt.").isVisible(), "P12: Registrierung mit E-Mail behält die Altersbestätigung");
    await page.getByRole("button", { name: "Weiter mit Google" }).click();
    await page.waitForURL(/\/auth\/v1\/authorize/);
    check(authorize?.searchParams.get("provider") === "google", `P12: Knopf führt zu Google (${authorize?.searchParams.get("provider")})`);
    check((authorize?.searchParams.get("redirect_to") ?? "").endsWith("/auth/confirm?via=oauth"), `P12: zurück auf /auth/confirm (${authorize?.searchParams.get("redirect_to")})`);
    await page.goto(`${APP}/login`);
    await page.getByRole("button", { name: "Weiter mit Apple" }).click();
    await page.waitForURL(/\/auth\/v1\/authorize/);
    check(authorize?.searchParams.get("provider") === "apple", "P12: Knopf führt zu Apple");

    // Zurück vom Anbieter mit Fehler (z. B. abgebrochen): eigene Meldung statt „Link abgelaufen“.
    await page.goto(`${APP}/auth/confirm?via=oauth#error=access_denied&error_code=access_denied&error_description=Abgebrochen`);
    await page.getByRole("heading", { name: "Die Anmeldung hat nicht geklappt" }).waitFor();
    check(await page.getByRole("link", { name: "Zur Anmeldung" }).isVisible(), "P12: Fehler führt zurück zur Anmeldung");
    await shot(fiona, "p12-anmeldung-fehlgeschlagen");

    // Ein Konto, wie es über Google entsteht: Name nur aus den Angaben des Anbieters, Anbieter „google“.
    if (!DB_URL || !ANON) {
      console.log("   (ohne E2E_DB_URL/SUPABASE_ANON_KEY: Onboarding nach Google nicht geprüft)");
      return;
    }
    const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
    const signup = await fetch(`${API}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email: fiona.email, password: PASSWORD, data: { full_name: "Fiona Fuchs", name: "Fiona Fuchs", avatar_url: "https://example.invalid/fiona.png" } }),
    });
    check(signup.ok, `P12: Konto angelegt (${signup.status})`);
    psql(`update auth.users set email_confirmed_at = now(), raw_app_meta_data = '{"provider": "google", "providers": ["google"]}' where email = '${fiona.email}'`);
    check(psql(`select p.display_name || '|' || coalesce(p.avatar_url, '-') from public.profiles p join auth.users u on u.id = p.id where u.email = '${fiona.email}'`) === "Fiona|-", "P12: Vorname vom Anbieter, kein fremdes Profilbild");
    await page.goto(`${APP}/login`);
    await page.getByLabel("E-Mail-Adresse").fill(fiona.email);
    await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.waitForURL(/\/onboarding/);
    await page.getByRole("heading", { name: "Wie sollen dich deine Freunde sehen?" }).waitFor();
    const age = page.getByLabel("Ich bin mindestens 16 Jahre alt.");
    check(await age.isVisible(), "P12: Onboarding fragt Konten über Google nach dem Alter");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByText("AFTERHOURS kannst du ab 16 Jahren nutzen.").waitFor();
    check(await page.getByRole("heading", { name: "Wie sollen dich deine Freunde sehen?" }).isVisible(), "P12: ohne Altersbestätigung geht es nicht weiter");
    await age.check();
    check((await page.getByText("AFTERHOURS kannst du ab 16 Jahren nutzen.").count()) === 0, "P12: Hinweis verschwindet mit dem Häkchen");
    await shot(fiona, "p12-onboarding-alter");
    await onboard(fiona);
    check(!page.url().includes("/onboarding"), "P12: Onboarding abgeschlossen");
  } finally {
    await page.unroute("**/auth/v1/settings").catch(() => {});
    await page.unroute("**/auth/v1/authorize**").catch(() => {});
  }
});

await step("P30 – „Fand der Abend statt?“: Abend mit einem Tipp abschließen oder still absagen (Bob 390 px, Alice, Carol)", async () => {
  if (!DB_URL) {
    console.log("   (E2E_DB_URL nicht gesetzt – Pläne in der Vergangenheit lassen sich nicht anlegen, P30 wird übersprungen)");
    return;
  }
  const sql = (q) => execFileSync("psql", [DB_URL, "-Atqc", q]).toString().trim();
  const uidOf = (user) => sql(`select id from auth.users where email = '${user.email}'`);
  const [aliceId, bobId, carolId] = [uidOf(alice), uidOf(bob), uidOf(carol)];
  // Zwei Abende von vorgestern (der Morgen danach ist sicher vorbei): Bob organisiert „Pizzaabend“ (Alice und Bob
  // dabei), Alice „Minigolf“ (nur Vorschlag, Bob dabei).
  const insertPlan = (title, by, status) =>
    sql(`insert into public.plans (crew_id, created_by, title, starts_at, status) values ('${ids.crew}', '${by}', '${title}', now() - interval '2 days', '${status}') returning id`).split("\n")[0];
  const pizza = insertPlan("Pizzaabend", bobId, "confirmed");
  const minigolf = insertPlan("Minigolf", aliceId, "proposed");
  sql(`insert into public.plan_participants (plan_id, user_id, attendance_status) values ('${pizza}', '${aliceId}', 'going'), ('${pizza}', '${bobId}', 'going'), ('${minigolf}', '${bobId}', 'going')
       on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status`);

  // P30 Etappe 2: „Fand’s statt?“ auf Home – Bob hat die Erinnerung weggewischt und öffnet einfach die App.
  const karaoke = insertPlan("Karaokeabend", bobId, "confirmed");
  sql(`update public.plans set starts_at = now() - interval '1 day' where id = '${karaoke}'`);
  sql(`insert into public.plan_participants (plan_id, user_id, attendance_status) values ('${karaoke}', '${bobId}', 'going')
       on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status`);
  const bp = bob.page;
  await bp.evaluate(() => localStorage.removeItem("afterhours.close.hidden")).catch(() => {});
  await bp.goto(`${APP}/`);
  const homeClose = bp.getByTestId("home-close");
  await homeClose.waitFor();
  const rowOf = (title) => homeClose.getByTestId("home-close-plan").filter({ hasText: title });
  await rowOf("Pizzaabend").waitFor();
  check((await rowOf("Karaokeabend").count()) === 1 && (await rowOf("Pizzaabend").count()) === 1, "P30 2: Home zeigt Bob beide offenen Abende");
  {
    const titles = await homeClose.getByTestId("home-close-plan").allInnerTexts();
    const k = titles.findIndex((x) => x.includes("Karaokeabend"));
    const p = titles.findIndex((x) => x.includes("Pizzaabend"));
    check(k >= 0 && p > k, "P30 2: der jüngste Abend steht oben");
    check(titles.length <= 3, `P30 2: höchstens drei Abende auf Home (${titles.length})`);
  }
  check((await rowOf("Minigolf").count()) === 0 || sql(`select count(*) from public.crew_members where crew_id = '${ids.crew}' and user_id = '${bobId}' and role in ('owner', 'admin')`) === "1",
        "P30 2: Alices Minigolf nur, wenn Bob Owner/Admin ist");
  check((await rowOf("Karaokeabend").getByText("1 dabei").count()) === 1, "P30 2: Zeile nennt, wie viele dabei waren");
  check((await rowOf("Pizzaabend").getByRole("link").getAttribute("href"))?.endsWith(`/plans/${pizza}#abschliessen`), "P30 2: Titel führt zur Karte auf der Planseite");
  {
    const box = await homeClose.boundingBox();
    const width = await bp.evaluate(() => document.documentElement.scrollWidth);
    check(Boolean(box && box.x >= 0 && box.x + box.width <= width + 1) && width <= (bp.viewportSize()?.width ?? 390), "P30 2: Karte passt auf 390 px");
  }
  await homeClose.scrollIntoViewIfNeeded();
  await bp.evaluate(() => document.getElementById("fands-statt")?.scrollIntoView({ block: "start" }));
  await shot(bob, "19c-home-fands-statt");

  // „Heute ausblenden“ hält bis morgen (nur dieses Gerät).
  await homeClose.getByTestId("home-close-hide").click();
  await bp.getByTestId("home-close").waitFor({ state: "detached" });
  await bp.reload();
  await bp.getByRole("heading", { level: 1 }).waitFor();
  await bp.waitForTimeout(500);
  check((await bp.getByTestId("home-close").count()) === 0, "P30 2: „Heute ausblenden“ hält nach dem Neuladen");
  await bp.evaluate(() => localStorage.removeItem("afterhours.close.hidden"));
  await bp.reload();
  await rowOf("Karaokeabend").waitFor();

  // Fehler: Plan bleibt offen, Zeile bleibt.
  await bp.route("**/rest/v1/rpc/close_plan", (route) => route.abort());
  await rowOf("Karaokeabend").getByRole("button", { name: "Ja, abschließen" }).click();
  await bp.locator('[role="alert"]').first().waitFor();
  await bp.waitForFunction(() => [...document.querySelectorAll("[data-testid=home-close-plan] [data-testid=plan-close-happened]")].every((b) => !b.hasAttribute("disabled")));
  check(sql(`select status from public.plans where id = '${karaoke}'`) === "confirmed" && (await rowOf("Karaokeabend").count()) === 1, "P30 2: Fehler – Abend bleibt offen, Zeile bleibt");
  await bp.unroute("**/rest/v1/rpc/close_plan");

  // Ein Tipp auf Home schließt ab – die Zeile verschwindet, Pizzaabend bleibt.
  await rowOf("Karaokeabend").getByRole("button", { name: "Ja, abschließen" }).click();
  await toast(bob, "Abgeschlossen – die Crew wird gefragt, wie’s war.");
  await rowOf("Karaokeabend").waitFor({ state: "detached" });
  check(sql(`select status from public.plans where id = '${karaoke}'`) === "completed", "P30 2: Karaokeabend von Home aus abgeschlossen");
  check((await rowOf("Pizzaabend").count()) === 1, "P30 2: die anderen Abende bleiben stehen");

  // Carol organisiert keinen der Abende – auf ihrer Startseite steht keiner davon.
  await carol.page.goto(`${APP}/`);
  await carol.page.getByRole("heading", { level: 1 }).waitFor();
  await carol.page.waitForTimeout(800);
  check((await carol.page.getByTestId("home-close-plan").filter({ hasText: /Pizzaabend|Karaokeabend/ }).count()) === 0, "P30 2: Carol sieht Bobs Abende nicht auf Home");

  // Bob (Organisator, 390 px) sieht die Karte oben auf der Planseite – die Erinnerung führt mit #abschliessen hierher.
  await bp.goto(`${APP}/plans/${pizza}#abschliessen`);
  const card = bp.getByTestId("plan-close");
  await card.waitFor();
  check((await card.getByRole("heading", { name: "Fand der Abend statt?" }).count()) === 1, "P30: Organisator wird gefragt, ob der Abend stattfand");
  const cardBox = await card.boundingBox();
  const attendanceBox = await bp.locator("#attendance-heading").boundingBox();
  check(Boolean(cardBox && attendanceBox && cardBox.y < attendanceBox.y), "P30: Karte steht oben, vor der eigenen Antwort");
  await shot(bob, "19d-fand-statt");

  // Carol (Mitglied, organisiert nicht) sieht keine Karte; über die API scheitert sie.
  if (sql(`select count(*) from public.crew_members where crew_id = '${ids.crew}' and user_id = '${carolId}'`) === "1") {
    await carol.page.goto(`${APP}/plans/${pizza}`);
    await carol.page.locator("#attendance-heading").waitFor();
    check((await carol.page.getByTestId("plan-close").count()) === 0, "P30: Carol (einfaches Mitglied) bekommt keine Karte");
  }
  if (ANON) {
    const carolTry = await api(carol, "POST", "rpc/close_plan", { p_plan_id: pizza, p_happened: true });
    check(carolTry.status >= 400, `API: Carol schließt Bobs Plan nicht ab (${carolTry.status})`);
    const anonTry = await api(null, "POST", "rpc/close_plan", { p_plan_id: pizza, p_happened: false });
    check(anonTry.status >= 400, `API: ohne Anmeldung nichts (${anonTry.status})`);
  }

  // Fehlerzustand: Ist der Server nicht erreichbar, bleibt alles, wie es war.
  await bp.route("**/rest/v1/rpc/close_plan", (route) => route.abort());
  await card.getByRole("button", { name: "Ja, abschließen" }).click();
  await bp.locator('[role="alert"]').first().waitFor();
  await bp.waitForFunction(() => !document.querySelector("[data-testid=plan-close-happened]")?.hasAttribute("disabled"));
  check(sql(`select status from public.plans where id = '${pizza}'`) === "confirmed" && (await card.isVisible()), "P30: Fehler – Plan bleibt offen, Karte bleibt");
  await bp.unroute("**/rest/v1/rpc/close_plan");

  // Ein Tipp: abgeschlossen, „Wie war’s?“ steht da, Alice (dabei) wird sofort gefragt.
  await card.getByRole("button", { name: "Ja, abschließen" }).click();
  await toast(bob, "Abgeschlossen – die Crew wird gefragt, wie’s war.");
  await bp.getByTestId("plan-feedback").waitFor();
  check((await bp.getByTestId("plan-close").count()) === 0, "P30: nach dem Abschluss ist die Karte weg, „Wie war’s?“ steht da");
  check(sql(`select status from public.plans where id = '${pizza}'`) === "completed", "P30: Plan ist abgeschlossen");
  check(sql(`select count(*) from public.notifications where user_id = '${aliceId}' and related_entity_id = '${pizza}' and type = 'plan_photo_nudge' and payload ->> 'feedback' = 'true'`) === "1",
        "P30: Alice wird genau einmal gefragt, wie’s war");
  // Bob kann vorher schon „Fand der Abend statt?“ bekommen haben (öffnet jemand aus der Crew die App, gehen die
  // Erinnerungen raus) – nach „Wie war’s?“ wird er aber nicht gefragt, er hat ja gerade selbst abgeschlossen.
  check(sql(`select count(*) from public.notifications where user_id = '${bobId}' and related_entity_id = '${pizza}' and type = 'plan_photo_nudge' and payload ->> 'feedback' = 'true'`) === "0",
        "P30: Bob hat selbst abgeschlossen und wird nicht nach „Wie war’s?“ gefragt");
  check(sql(`select count(*) from public.notifications where user_id = '${bobId}' and related_entity_id = '${pizza}' and type = 'plan_photo_nudge' and coalesce(payload ->> 'close', 'false') <> 'true'`) === "0",
        "P30: an Bob höchstens „Fand der Abend statt?“");
  await shot(bob, "19e-abgeschlossen");

  // Alice öffnet die Benachrichtigung – sie führt zu „Wie war’s?“.
  {
    const ap = alice.page;
    await ap.goto(`${APP}/notifications`);
    const note = ap.getByRole("link").filter({ hasText: "Wie war der Abend? Sag’s mit einem Tipp" }).filter({ hasText: "Pizzaabend" }).first();
    await note.waitFor();
    await note.click();
    await ap.waitForURL(new RegExp(`/plans/${pizza}#wie-wars`));
    await ap.getByTestId("plan-feedback").waitFor();
    check(true, "P30: Alice landet bei „Wie war’s?“");
  }

  // Alice: Minigolf hat nicht stattgefunden – Rückfrage, dann still abgesagt (keine Nachricht an Bob).
  {
    const ap = alice.page;
    await ap.goto(`${APP}/plans/${minigolf}`);
    const close = ap.getByTestId("plan-close");
    await close.waitFor();
    await close.getByRole("button", { name: "Hat nicht stattgefunden" }).click();
    await dialog(alice).getByRole("heading", { name: "Hat nicht stattgefunden?" }).waitFor();
    await shot(alice, "19f-nicht-stattgefunden");
    await dialog(alice).getByRole("button", { name: "Ja, absagen" }).click();
    await toast(alice, "Plan abgesagt – ohne Nachricht an die Crew.");
    await ap.getByText("Dieser Plan wurde abgesagt.").first().waitFor().catch(() => {});
    check(sql(`select status from public.plans where id = '${minigolf}'`) === "cancelled", "P30: Minigolf ist abgesagt");
    check(sql(`select count(*) from public.notifications where related_entity_id = '${minigolf}' and type = 'plan_cancelled'`) === "0", "P30: niemand bekommt eine Absage-Nachricht");
    check((await ap.getByTestId("plan-close").count()) === 0, "P30: abgesagt – keine Karte mehr");
  }

  // P30 2: Alles abgeschlossen – auf Bobs Startseite steht keiner der Abende mehr.
  await bp.goto(`${APP}/`);
  await bp.getByRole("heading", { level: 1 }).waitFor();
  await bp.waitForTimeout(800);
  check((await bp.getByTestId("home-close-plan").filter({ hasText: /Pizzaabend|Karaokeabend|Minigolf/ }).count()) === 0, "P30 2: nach dem Abschluss ist Home wieder ruhig");
});

await step("P35 – Crew stummschalten: 8 Stunden, bis auf Weiteres, wieder laut; privat und mit Fehlerzustand (Bob 390 px, Carol)", async () => {
  const psql = (sql) => execFileSync("psql", [DB_URL, "-Atqc", sql]).toString().trim();
  const openSettings = async (user) => {
    await user.page.goto(`${APP}/crews/${ids.crew}`);
    await user.page.getByRole("tab", { name: "Einstellungen" }).click();
    const card = user.page.getByTestId("crew-mute");
    await card.getByTestId("crew-mute-status").waitFor();
    return card;
  };
  try {
    // Bob (390 px): Crew ist laut, keine Dauer gewählt, kein „Wieder laut“.
    const card = await openSettings(bob);
    check((await card.getByRole("heading").first().textContent())?.trim() === "Mitteilungen dieser Crew", "P35: Karte „Mitteilungen dieser Crew“ in den Einstellungen der Crew");
    check((await card.getByTestId("crew-mute-status").innerText()).trim() === "Laut", "P35: Stand „Laut“");
    check((await card.locator('button[aria-pressed="true"]').count()) === 0, "P35: keine Dauer gewählt");
    check(await card.getByText(/in der App weiter alles/).isVisible(), "P35: ehrlich – in der App kommt weiter alles an");
    check((await card.getByRole("button", { name: "Wieder laut" }).count()) === 0, "P35: kein „Wieder laut“, solange laut");

    // 8 Stunden: Stand „Stumm bis <Uhrzeit>“, Zeile in der Datenbank mit Ende in 8 h.
    const saved = bob.page.waitForResponse((r) => r.url().includes("/rpc/set_crew_push_mute") && r.request().method() === "POST");
    await card.getByRole("button", { name: "8 Stunden" }).click();
    check((await saved).ok(), "P35: „8 Stunden“ gespeichert");
    await toast(bob, "Für 8 Stunden stumm.");
    const status = card.getByTestId("crew-mute-status");
    await bob.page.waitForFunction(() => /^Stumm bis \S/.test(document.querySelector('[data-testid="crew-mute-status"]')?.textContent?.trim() ?? ""));
    check(true, `P35: Stand „${(await status.innerText()).trim()}“`);
    check((await card.getByRole("button", { name: "8 Stunden" }).getAttribute("aria-pressed")) === "true", "P35: „8 Stunden“ ist gewählt");
    const hours = Number(psql(`select round(extract(epoch from m.muted_until - now()) / 3600) from public.crew_push_mutes m join auth.users u on u.id = m.user_id where u.email = '${bob.email}' and m.crew_id = '${ids.crew}'`));
    check(hours === 8, `P35: in der Datenbank stumm für 8 Stunden (${hours})`);
    await noOverflow(bob, "Crew-Einstellungen – stumm");
    await a11y(bob, "crew-stumm");
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(bob, "73a-crew-stumm");

    // Nach dem Neuladen gleicher Stand; „Bis ich’s ändere“ ohne Ende.
    const again = await openSettings(bob);
    check(/^Stumm bis /.test((await again.getByTestId("crew-mute-status").innerText()).trim()), "P35: nach dem Neuladen weiter stumm");
    await again.getByRole("button", { name: "Bis ich’s ändere" }).click();
    await toast(bob, "Stumm, bis du es änderst.");
    await bob.page.waitForFunction(() => document.querySelector('[data-testid="crew-mute-status"]')?.textContent?.trim() === "Stumm");
    check(psql(`select count(*) from public.crew_push_mutes m join auth.users u on u.id = m.user_id where u.email = '${bob.email}' and m.muted_until is null`) === "1", "P35: ohne Ende gespeichert");

    // Etappe 2: „Stumm“ auf einen Blick – Pille im Kopf der Crew-Seite (Tipp führt zu den Einstellungen) und in der Crew-Liste.
    const pass = bob.page.getByTestId("crew-pass-muted");
    await pass.waitFor();
    check((await pass.innerText()).trim().startsWith("Stumm"), "P35 2: Pille „Stumm“ im Kopf der Crew-Seite");
    await bob.page.goto(`${APP}/crews/${ids.crew}`);
    await pass.waitFor();
    check(await bob.page.getByRole("tab", { name: "Übersicht" }).getAttribute("aria-selected") === "true", "P35 2: Seite öffnet in der Übersicht");
    await noOverflow(bob, "Crew-Kopf – stumm");
    await a11y(bob, "crew-kopf-stumm");
    await bob.page.getByTestId("crew-pass").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await shot(bob, "73b-crew-kopf-stumm");
    await pass.click();
    await bob.page.getByTestId("crew-mute").getByTestId("crew-mute-status").waitFor();
    check(await bob.page.getByRole("tab", { name: "Einstellungen" }).getAttribute("aria-selected") === "true", "P35 2: Tipp auf die Pille öffnet die Einstellungen");
    await bob.page.goto(`${APP}/crews`);
    const row = bob.page.locator(`[data-testid="crew-row"][href="/crews/${ids.crew}"]`);
    await row.getByTestId("crew-row-muted").waitFor();
    check((await row.getByTestId("crew-row-muted").innerText()).trim() === "Stumm", "P35 2: Pille „Stumm“ an der Crew-Zeile");
    check((await bob.page.getByTestId("crew-row-muted").count()) === 1, "P35 2: nur die stumme Crew trägt die Pille");
    await noOverflow(bob, "Crew-Liste – stumm");
    await shot(bob, "73c-crew-liste-stumm");
    await carol.page.goto(`${APP}/crews`);
    await carol.page.getByTestId("crew-row").first().waitFor();
    await carol.page.waitForTimeout(500);
    check((await carol.page.getByTestId("crew-row-muted").count()) === 0, "P35 2: Carol sieht keine Pille – Bobs Stille bleibt privat");

    // Privat: Carol (Desktop) sieht für sich „Laut“ – nichts von Bobs Stille.
    const carolCard = await openSettings(carol);
    check((await carolCard.getByTestId("crew-mute-status").innerText()).trim() === "Laut", "P35: Carol sieht ihre eigene Einstellung, nicht Bobs");
    const visible = await api(carol, "GET", "crew_push_mutes?select=user_id");
    check(visible.status === 200 && Array.isArray(visible.json) && visible.json.length === 0, `P35: Carol liest keine fremde Stille über die API (${visible.status})`);

    // Wieder laut (Bob ist inzwischen auf der Crew-Liste – zurück in die Einstellungen).
    const loud = await openSettings(bob);
    await loud.getByRole("button", { name: "Wieder laut" }).click();
    await toast(bob, "Die Crew ist wieder laut.");
    await bob.page.waitForFunction(() => document.querySelector('[data-testid="crew-mute-status"]')?.textContent?.trim() === "Laut");
    check(psql(`select count(*) from public.crew_push_mutes m join auth.users u on u.id = m.user_id where u.email = '${bob.email}'`) === "0", "P35: wieder laut – keine Zeile mehr");
    check((await bob.page.getByTestId("crew-pass-muted").count()) === 0, "P35 2: wieder laut – Pille im Kopf ist weg");

    // Fehlerzustand: Lesen scheitert → Fehlerkarte mit „Erneut versuchen“, danach geht es wieder.
    // 400 mit PostgREST-Code: kein automatisches Wiederholen und kein Serverfehler im Protokoll.
    await bob.page.route("**/rest/v1/crew_push_mutes*", (route) => route.fulfill({ status: 400, contentType: "application/json", body: '{"code":"PGRST000","message":"kaputt","details":null,"hint":null}' }));
    await bob.page.goto(`${APP}/crews/${ids.crew}`);
    await bob.page.getByRole("tab", { name: "Einstellungen" }).click();
    const broken = bob.page.getByTestId("crew-mute");
    await broken.getByRole("alert").waitFor({ timeout: 20_000 });
    check(await broken.getByText("Die Einstellung ließ sich gerade nicht laden.").isVisible(), "P35: Fehlerzustand mit eigenem Text");
    await bob.page.unroute("**/rest/v1/crew_push_mutes*");
    await broken.getByRole("button", { name: "Erneut versuchen" }).click();
    await broken.getByTestId("crew-mute-status").waitFor();
    check(true, "P35: nach „Erneut versuchen“ wieder geladen");
  } finally {
    psql(`delete from public.crew_push_mutes m using auth.users u where u.id = m.user_id and u.email in ('${bob.email}', '${carol.email}')`);
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
