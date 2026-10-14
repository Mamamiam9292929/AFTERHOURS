// W6 · Messenger verlangen absolute Bildadressen in og:image. Ist VITE_SITE_URL beim Build gesetzt,
// wird aus content="/og/…" in index.html content="https://<domain>/og/…" (Plugin in vite.config.ts).
// Ohne gültige Adresse bleibt der Pfad relativ. Getestet in tests/unit/site-meta.test.mjs.

/**
 * @param {string} html
 * @param {string | undefined} site
 * @returns {string}
 */
export function absoluteOgImages(html, site) {
  const base = String(site ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s"'<>]+$/.test(base)) return html;
  return html.replaceAll('content="/og/', `content="${base}/og/`);
}
