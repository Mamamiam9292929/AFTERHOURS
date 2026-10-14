// W2 · Messenger-Vorschau für geteilte Pläne und Abstimmungen (Vercel Function, Node-Laufzeit).
// vercel.json leitet /s/<token> (Plan) und /v/<token> (Abstimmung, Etappe 2) hierher. Die Antwort ist die normale App-Hülle (index.html) –
// Menschen sehen also die App –, nur mit Open-Graph-Tags für diesen Plan bzw. diese Abstimmung im <head>. WhatsApp,
// Signal, Telegram & Co. lesen diese Tags, ohne JavaScript auszuführen.
//
// Daten holt die Funktion wie ein Besucher ohne Konto: mit dem öffentlichen anon-Key über die
// Datenbankfunktion preview_shared_plan bzw. preview_shared_poll. Kein Secret, keine Rechte darüber hinaus.
import { BRAND, describeSharedPlan, describeSharedPoll, fallbackShell, injectMeta, SHARE_KINDS, SHARE_TOKEN, shareMetaTags } from "./_lib/share-card.js";

export async function GET(request) {
  return handleShare(request, process.env, fetch);
}

export async function handleShare(request, env, fetchImpl) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  // Art aus ?kind=poll (Rewrite in vercel.json) oder aus dem Pfad /v/<token>; sonst Plan wie bisher.
  const kind = url.searchParams.get("kind") === "poll" || segments[0] === "v" ? "poll" : "plan";
  const config = SHARE_KINDS[kind];
  const raw = url.searchParams.get("token") ?? segments.pop() ?? "";
  const token = SHARE_TOKEN.test(raw) ? raw : null;
  const site = (env.VITE_SITE_URL || url.origin).replace(/\/+$/, "");
  const shareUrl = token ? `${site}/${config.path}/${token}` : site;

  const [shell, preview] = await Promise.all([loadShell(url.origin, fetchImpl), token ? loadPreview(config.rpc, token, env, fetchImpl) : null]);
  const describe = kind === "poll" ? describeSharedPoll : describeSharedPlan;
  const { title, description } = preview ? describe(preview) : BRAND;
  const tags = shareMetaTags({ title, description, url: shareUrl, image: `${site}${config.image}`, imageAlt: config.imageAlt });
  const html = shell ? injectMeta(shell, tags) : fallbackShell(tags, shareUrl);

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Titel, Zusagen oder Stimmen können sich ändern; Messenger holen die Vorschau ohnehin nur einmal.
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

async function loadShell(origin, fetchImpl) {
  try {
    const response = await fetchImpl(`${origin}/index.html`, { signal: AbortSignal.timeout(3000) });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/** Antwort der Datenbank oder null (nicht erreichbar, Rate Limit) – dann gibt es die allgemeine Vorschau. */
async function loadPreview(rpc, token, env, fetchImpl) {
  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "";
  if (!base || !key) return null;
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Klassische anon-Keys sind JWTs und gehören zusätzlich in Authorization; „publishable keys“ nicht.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  try {
    const response = await fetchImpl(`${base}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_token: token }),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
