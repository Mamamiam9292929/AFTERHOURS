// W2 · Teilen-Karten: Bausteine für die Messenger-Vorschau eines geteilten Plans (/s/<token>) bzw. einer
// geteilten Abstimmung (/v/<token>, Etappe 2).
// Reine Funktionen ohne Netz – getestet in tests/unit/share-card.test.mjs.
//
// Die Texte stehen ausnahmsweise hier statt in src/i18n: Sie entstehen auf dem Server, bevor die
// App lädt, und gehen nur an Messenger-Vorschauen. Inhalt wie in der App (t.plans.shared, t.polls.shared).
//
// P11 Etappe 2b: Deutsch oder Englisch. Die Sprache bringt der Link mit (`?lang=en`, gesetzt von der App der
// teilenden Person, src/lib/share.ts) – die Vorschau erscheint im Gruppenchat, also in der Sprache dessen,
// der teilt. Ohne Angabe Deutsch wie bisher.

export const SHARE_TOKEN = /^[0-9a-f]{32}$/;

/** Nur bekannte Sprachen; alles andere → Deutsch. */
export function shareLocale(value) {
  return value === "en" ? "en" : "de";
}

const BRANDS = {
  de: {
    title: "AFTERHOURS",
    description: "Mit deiner Crew abstimmen, Orte entdecken und Pläne festmachen. Weniger planen. Mehr erleben.",
    imageAlt: "AFTERHOURS – ein Ticket für euren nächsten Abend",
  },
  en: {
    title: "AFTERHOURS",
    description: "Vote with your crew, discover places and lock in plans. Less planning. More living.",
    imageAlt: "AFTERHOURS – a ticket for your next night out",
  },
};

export const BRAND = BRANDS.de;

export function brandFor(locale) {
  return BRANDS[shareLocale(locale)];
}

const POLL_IMAGE_ALT = { de: "AFTERHOURS – eine Abstimmung eurer Crew", en: "AFTERHOURS – a poll by your crew" };

/** Bildbeschreibung der Vorschau je Art und Sprache. */
export function imageAltFor(kind, locale) {
  const lang = shareLocale(locale);
  return kind === "poll" ? POLL_IMAGE_ALT[lang] : BRANDS[lang].imageAlt;
}

/**
 * Die beiden Arten geteilter Links: Pfad in der App, Datenbankfunktion für die Vorschau, Vorschaubild.
 * Die Tokens sehen gleich aus (32 Hex-Zeichen), liegen aber in getrennten Tabellen.
 */
export const SHARE_KINDS = {
  plan: { path: "s", rpc: "preview_shared_plan", image: "/og/plan.png", imageAlt: BRAND.imageAlt },
  poll: { path: "v", rpc: "preview_shared_poll", image: "/og/poll.png", imageAlt: POLL_IMAGE_ALT.de },
};

const TIME_ZONE = "Europe/Berlin";
const FORMATS = {
  de: {
    day: new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" }),
    time: new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }),
  },
  en: {
    day: new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" }),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  },
};

/** „Freitag, 17. Oktober · 20:00 Uhr“ bzw. „Friday 17 October · 20:00“ in Berliner Zeit. */
export function formatWhen(iso, locale = "de") {
  const lang = shareLocale(locale);
  const date = new Date(iso);
  const { day, time } = FORMATS[lang];
  return lang === "en" ? `${day.format(date).replace(",", "")} · ${time.format(date)}` : `${day.format(date)} · ${time.format(date)} Uhr`;
}

/** Texte der Vorschau je Sprache (wie t.plans.shared und t.polls.shared in der App). */
const TEXTS = {
  de: {
    going: (n) => (n <= 0 ? "Noch keine Zusage" : n === 1 ? "1 ist dabei" : `${n} sind dabei`),
    planCancelled: (when) => `Abgesagt – war geplant für ${when}.`,
    planCompleted: (when) => `Vorbei – das war ${when}.`,
    planOpen: (when, going) => `${when} · ${going}. Bist du dabei?`,
    options: (n) => (n === 1 ? "1 Vorschlag" : `${n} Vorschläge`),
    dates: (n) => (n === 1 ? "1 Termin" : `${n} Termine`),
    datesListed: (head, listed, rest) => `${head} zur Wahl: ${listed}${rest > 0 ? ` und ${rest} ${rest === 1 ? "weiterer" : "weitere"}` : ""}`,
    decided: (voters) => `Entschieden – ${voters === 1 ? "1 hat" : `${voters} haben`} abgestimmt. Wie es weitergeht, sieht die Crew in AFTERHOURS.`,
    voters: (n) => (n === 0 ? "Noch keine Stimme" : n === 1 ? "1 hat abgestimmt" : `${n} haben abgestimmt`),
    askDate: "Wann kannst du?",
    askPoll: "Stimmst du mit ab?",
    guests: "Geht auch ohne Konto.",
    pollOpen: (options, voters, until, ask) => `${options} · ${voters} · Abstimmen bis ${until}. ${ask}`,
    weekdays: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
    slot: (weekday, y, m, d) => `${weekday} ${d}.${m}.`,
  },
  en: {
    going: (n) => (n <= 0 ? "No one's in yet" : n === 1 ? "1 is in" : `${n} are in`),
    planCancelled: (when) => `Cancelled – was planned for ${when}.`,
    planCompleted: (when) => `Over – that was ${when}.`,
    planOpen: (when, going) => `${when} · ${going}. Are you in?`,
    options: (n) => (n === 1 ? "1 option" : `${n} options`),
    dates: (n) => (n === 1 ? "1 date" : `${n} dates`),
    datesListed: (head, listed, rest) => `${head} to choose from: ${listed}${rest > 0 ? ` and ${rest} more` : ""}`,
    decided: (voters) => `Decided – ${voters === 1 ? "1 person" : `${voters} people`} voted. The crew sees what's next in AFTERHOURS.`,
    voters: (n) => (n === 0 ? "No votes yet" : n === 1 ? "1 has voted" : `${n} have voted`),
    askDate: "When can you make it?",
    askPoll: "Will you vote?",
    guests: "No account needed.",
    pollOpen: (options, voters, until, ask) => `${options} · ${voters} · Vote until ${until}. ${ask}`,
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    slot: (weekday, y, m, d) => `${weekday} ${Number(d)} ${MONTHS_EN[Number(m) - 1]}`,
  },
};
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Titel und Beschreibung der Vorschau. Nur, was die Vorschau-Funktion der Datenbank liefert:
 * Titel, Zeit, Status, Zahl der Zusagen – keine Namen, Orte oder Crew.
 */
export function describeSharedPlan(preview, locale = "de") {
  const lang = shareLocale(locale);
  const text = TEXTS[lang];
  if (!preview || preview.status !== "valid" || !preview.plan) {
    return { title: BRANDS[lang].title, description: BRANDS[lang].description };
  }
  const { plan } = preview;
  const when = formatWhen(plan.starts_at, lang);
  const title = `${plan.title} · AFTERHOURS`;
  if (plan.status === "cancelled") return { title, description: text.planCancelled(when) };
  if (plan.status === "completed") return { title, description: text.planCompleted(when) };
  return { title, description: text.planOpen(when, text.going(Number(plan.going_count) || 0)) };
}

/**
 * W2 Etappe 2 · Titel und Beschreibung der Vorschau einer Abstimmung. Nur, was preview_shared_poll
 * liefert: Frage, Frist, offen/entschieden, Zahl der Vorschläge und der Personen, die abgestimmt haben
 * (Gäste eingeschlossen), und ob Gäste ohne Konto mitstimmen dürfen (W3).
 */
export function describeSharedPoll(preview, locale = "de") {
  const lang = shareLocale(locale);
  const text = TEXTS[lang];
  if (!preview || preview.status !== "valid" || !preview.poll) {
    return { title: BRANDS[lang].title, description: BRANDS[lang].description };
  }
  const { poll } = preview;
  const title = `${poll.title} · AFTERHOURS`;
  const isDate = poll.kind === "date";
  const options = isDate ? dateOptionsText(Number(poll.option_count) || 0, poll.dates, lang) : text.options(Number(poll.option_count) || 0);
  const voters = Number(poll.voter_count) || 0;
  if (poll.status !== "open") return { title, description: text.decided(voters) };
  // W3: Hat die Crew Gäste zugelassen, geht Mitstimmen ohne Konto – das gehört in die Einladung.
  const question = isDate ? text.askDate : text.askPoll;
  const ask = poll.guests === true ? `${question} ${text.guests}` : question;
  return { title, description: text.pollOpen(options, text.voters(voters), formatWhen(poll.ends_at, lang), ask) };
}

const MAX_LISTED_DATES = 4;

/** P1 · „Fr 23.10. 19:00“ bzw. „Fri 23 Oct 19:00“ aus {date: "2026-10-23", time: "19:00" | null}; ungültig → null. */
export function formatSlot(slot, locale = "de") {
  const text = TEXTS[shareLocale(locale)];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(slot?.date ?? ""));
  if (!match) return null;
  const [, y, m, d] = match;
  const weekday = text.weekdays[new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()];
  const time = typeof slot.time === "string" && /^\d{2}:\d{2}$/.test(slot.time) ? ` ${slot.time}` : "";
  return `${text.slot(weekday, y, m, d)}${time}`;
}

/**
 * P1 Etappe 2 · Termin-Abstimmung: Die Termine selbst stehen in der Vorschau (sie enthalten weder Namen
 * noch Orte) – „3 Termine zur Wahl: Fr 23.10. 19:00, Sa 24.10., …“. Mehr als vier werden gezählt.
 */
function dateOptionsText(count, dates, lang) {
  const text = TEXTS[lang];
  const slots = (Array.isArray(dates) ? dates : []).map((slot) => formatSlot(slot, lang)).filter(Boolean);
  const total = Math.max(count, slots.length);
  const head = text.dates(total);
  if (slots.length === 0) return head;
  const listed = slots.slice(0, MAX_LISTED_DATES).join(", ");
  const rest = total - Math.min(slots.length, MAX_LISTED_DATES);
  return text.datesListed(head, listed, rest);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Open-Graph- und Twitter-Tags; `image` muss eine absolute Adresse sein (Messenger verlangen das). */
export function shareMetaTags({ title, description, url, image, imageAlt = BRAND.imageAlt, locale = "de" }) {
  const e = escapeHtml;
  return [
    `<title>${e(title)}</title>`,
    `<meta name="description" content="${e(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="AFTERHOURS" />`,
    `<meta property="og:locale" content="${shareLocale(locale) === "en" ? "en_GB" : "de_DE"}" />`,
    `<meta property="og:title" content="${e(title)}" />`,
    `<meta property="og:description" content="${e(description)}" />`,
    `<meta property="og:url" content="${e(url)}" />`,
    `<meta property="og:image" content="${e(image)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${e(imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="robots" content="noindex" />`,
  ].join("\n    ");
}

/**
 * Ersetzt Titel, Beschreibung und die allgemeinen Vorschau-Tags der App-Hülle (W6, index.html) durch die
 * Vorschau-Tags des Plans bzw. der Abstimmung – Messenger nehmen sonst oft das erste og:title. Der Rest bleibt unverändert.
 */
export function injectMeta(html, tags, locale = "de") {
  const stripped = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="description"[^>]*>\s*/i, "")
    .replace(/<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/gi, "")
    .replace(/<!--\s*W6 · Vorschau[\s\S]*?-->\s*/i, "");
  const lang = shareLocale(locale);
  if (!/<\/head>/i.test(stripped)) return `<!doctype html><html lang="${lang}"><head>${tags}</head><body></body></html>`;
  return stripped.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

/** Notbehelf, falls die App-Hülle nicht geladen werden kann: nur Vorschau und ein Link in die App. */
export function fallbackShell(tags, appUrl, locale = "de") {
  const lang = shareLocale(locale);
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${tags}
  </head>
  <body>
    <p><a href="${escapeHtml(appUrl)}">${lang === "en" ? "Open AFTERHOURS" : "AFTERHOURS öffnen"}</a></p>
  </body>
</html>`;
}
