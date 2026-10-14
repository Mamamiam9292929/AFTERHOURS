// W2 · Teilen-Karten: Bausteine für die Messenger-Vorschau eines geteilten Plans (/s/<token>).
// Reine Funktionen ohne Netz – getestet in tests/unit/share-card.test.mjs.
//
// Die Texte stehen ausnahmsweise hier statt in src/i18n: Sie entstehen auf dem Server, bevor die
// App lädt, und gehen nur an Messenger-Vorschauen. Inhalt wie in der App (t.plans.shared).

export const SHARE_TOKEN = /^[0-9a-f]{32}$/;

export const BRAND = {
  title: "AFTERHOURS",
  description: "Mit deiner Crew abstimmen, Orte entdecken und Pläne festmachen. Weniger planen. Mehr erleben.",
  imageAlt: "AFTERHOURS – ein Ticket für euren nächsten Abend",
};

const TIME_ZONE = "Europe/Berlin";
const dayFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
const timeFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** „Freitag, 17. Oktober · 20:00 Uhr“ in Berliner Zeit. */
export function formatWhen(iso) {
  const date = new Date(iso);
  return `${dayFormat.format(date)} · ${timeFormat.format(date)} Uhr`;
}

function goingText(n) {
  if (n <= 0) return "Noch keine Zusage";
  return n === 1 ? "1 ist dabei" : `${n} sind dabei`;
}

/**
 * Titel und Beschreibung der Vorschau. Nur, was die Vorschau-Funktion der Datenbank liefert:
 * Titel, Zeit, Status, Zahl der Zusagen – keine Namen, Orte oder Crew.
 */
export function describeSharedPlan(preview) {
  if (!preview || preview.status !== "valid" || !preview.plan) {
    return { title: BRAND.title, description: BRAND.description };
  }
  const { plan } = preview;
  const when = formatWhen(plan.starts_at);
  const title = `${plan.title} · AFTERHOURS`;
  if (plan.status === "cancelled") return { title, description: `Abgesagt – war geplant für ${when}.` };
  if (plan.status === "completed") return { title, description: `Vorbei – das war ${when}.` };
  return { title, description: `${when} · ${goingText(Number(plan.going_count) || 0)}. Bist du dabei?` };
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
export function shareMetaTags({ title, description, url, image }) {
  const e = escapeHtml;
  return [
    `<title>${e(title)}</title>`,
    `<meta name="description" content="${e(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="AFTERHOURS" />`,
    `<meta property="og:locale" content="de_DE" />`,
    `<meta property="og:title" content="${e(title)}" />`,
    `<meta property="og:description" content="${e(description)}" />`,
    `<meta property="og:url" content="${e(url)}" />`,
    `<meta property="og:image" content="${e(image)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${e(BRAND.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="robots" content="noindex" />`,
  ].join("\n    ");
}

/**
 * Ersetzt Titel, Beschreibung und die allgemeinen Vorschau-Tags der App-Hülle (W6, index.html) durch die
 * Vorschau-Tags des Plans – Messenger nehmen sonst oft das erste og:title. Der Rest bleibt unverändert.
 */
export function injectMeta(html, tags) {
  const stripped = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="description"[^>]*>\s*/i, "")
    .replace(/<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/gi, "")
    .replace(/<!--\s*W6 · Vorschau[\s\S]*?-->\s*/i, "");
  if (!/<\/head>/i.test(stripped)) return `<!doctype html><html lang="de"><head>${tags}</head><body></body></html>`;
  return stripped.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

/** Notbehelf, falls die App-Hülle nicht geladen werden kann: nur Vorschau und ein Link in die App. */
export function fallbackShell(tags, appUrl) {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${tags}
  </head>
  <body>
    <p><a href="${escapeHtml(appUrl)}">AFTERHOURS öffnen</a></p>
  </body>
</html>`;
}
