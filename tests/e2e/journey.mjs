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
    window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
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
      const marked = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none" || style.borderColor === "rgb(197, 248, 42)";
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
  await alice.page.goto(`${APP}/home`);
  await alice.page.getByRole("heading", { level: 1 }).waitFor();
  await alice.page.getByText("In drei Schritten zum ersten Plan").waitFor();
  check(true, "Home zeigt neuen Nutzern den Einstieg");
  await shot(alice, "04-home-neu");
});

await step("Schritt 2 – Crew erstellen", async () => {
  const { page } = alice;
  await page.getByRole("link", { name: "Crew erstellen" }).first().click();
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
const optionCard = (user, option) => user.page.getByRole("listitem").filter({ has: user.page.getByRole("heading", { name: option }) });

await step("Schritt 6 – Die Crew stimmt ab", async () => {
  await bob.page.goto(`${APP}/home`);
  await bob.page.getByRole("heading", { name: "Deine Antwort fehlt" }).waitFor();
  check(true, "Bob sieht auf Home, dass seine Antwort fehlt");
  await bob.page.goto(`${APP}/notifications`);
  await bob.page.getByText("Alice hat eine Abstimmung gestartet").waitFor();
  check(true, "Bob wurde über die neue Abstimmung benachrichtigt");
  await bob.page.getByText("Alice hat eine Abstimmung gestartet").click();
  await bob.page.waitForURL(new RegExp(`/polls/${ids.poll}`));

  // W8: Abstimmung in den Gruppenchat teilen – Titel, Frist, Link; keine Namen.
  await stubShare(bob.page);
  await bob.page.getByRole("button", { name: "Abstimmung teilen" }).click();
  const pollShared = (await sharedData(bob.page))[0];
  check(pollShared?.url?.endsWith(`/polls/${ids.poll}`), "Abstimmung teilen: Link führt zur Abstimmung");
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

await step("W8 – Plan in den Gruppenchat teilen (Carol)", async () => {
  const { page, context } = carol;
  await page.goto(`${APP}/plans/${ids.plan}`);
  await page.getByRole("heading", { level: 1, name: "Strike District Bowling" }).waitFor();
  await stubShare(page);
  await page.getByRole("button", { name: "Plan teilen" }).click();
  const shared = (await sharedData(page))[0];
  check(shared?.url?.endsWith(`/plans/${ids.plan}`), "Plan teilen: Link führt zum Plan");
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
  if (clip !== null) check(clip.startsWith("Strike District Bowling – ") && clip.trim().endsWith(`/plans/${ids.plan}`), "Zwischenablage enthält Text und Link");
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
  await page.getByRole("button", { name: "Plan absagen" }).click();
  await dialog(carol).getByRole("button", { name: "Plan absagen" }).click();
  await toast(carol, "Plan abgesagt.");
  await page.getByText("Abgesagt").first().waitFor();
  check((await page.getByRole("button", { name: "Plan bearbeiten" }).count()) === 0, "abgesagter Plan lässt sich nicht mehr bearbeiten");
  await alice.page.goto(`${APP}/notifications`);
  await alice.page.getByText("Carol hat einen Plan abgesagt").waitFor();
  check(true, "Absage benachrichtigt die Crew");
  await shot(alice, "31-benachrichtigungen");
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

await step("W4 – Installierbar, offline, Zähler am App-Icon (Bob)", async () => {
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

  await context.setOffline(true);
  await page.reload();
  await page.getByText("Offline – Inhalte laden, sobald du wieder Netz hast.").waitFor();
  check(true, "ohne Netz öffnet sich die App aus dem Cache und sagt ehrlich, dass sie offline ist");
  await shot(app, "34-offline");
  await context.setOffline(false);
  await page.getByText("Offline – Inhalte laden").waitFor({ state: "detached" });
  await homeReady();
  check(true, "wieder online: Hinweis verschwindet, Home lädt");
  users.splice(users.indexOf(app), 1);
  await context.close();
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
