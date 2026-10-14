// W2 · Messenger-Vorschau für geteilte Pläne (Vercel Function, Node-Laufzeit).
// vercel.json leitet /s/<token> hierher. Die Antwort ist die normale App-Hülle (index.html) –
// Menschen sehen also die App –, nur mit Open-Graph-Tags für diesen Plan im <head>. WhatsApp,
// Signal, Telegram & Co. lesen diese Tags, ohne JavaScript auszuführen.
//
// Daten holt die Funktion wie ein Besucher ohne Konto: mit dem öffentlichen anon-Key über die
// Datenbankfunktion preview_shared_plan. Kein Secret, keine Rechte darüber hinaus.
import { BRAND, describeSharedPlan, fallbackShell, injectMeta, SHARE_TOKEN, shareMetaTags } from "./_lib/share-card.js";

export async function GET(request) {
  return handleShare(request, process.env, fetch);
}

export async function handleShare(request, env, fetchImpl) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("token") ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
  const token = SHARE_TOKEN.test(raw) ? raw : null;
  const site = (env.VITE_SITE_URL || url.origin).replace(/\/+$/, "");
  const shareUrl = token ? `${site}/s/${token}` : site;

  const [shell, preview] = await Promise.all([loadShell(url.origin, fetchImpl), token ? loadPreview(token, env, fetchImpl) : null]);
  const { title, description } = preview ? describeSharedPlan(preview) : BRAND;
  const tags = shareMetaTags({ title, description, url: shareUrl, image: `${site}/og/plan.png` });
  const html = shell ? injectMeta(shell, tags) : fallbackShell(tags, shareUrl);

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Titel oder Zusagen können sich ändern; Messenger holen die Vorschau ohnehin nur einmal.
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
async function loadPreview(token, env, fetchImpl) {
  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "";
  if (!base || !key) return null;
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Klassische anon-Keys sind JWTs und gehören zusätzlich in Authorization; „publishable keys“ nicht.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  try {
    const response = await fetchImpl(`${base}/rest/v1/rpc/preview_shared_plan`, {
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
