// W6 · Vorschau der Startseite in Messengern und Suchmaschinen: Tags in index.html, absolute Bildadresse
// beim Build, Vorschaubild, und dass geteilte Pläne (W2) die allgemeinen Tags vollständig ersetzen.
// Läuft ohne Netz: node --test tests/unit/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { injectMeta, shareMetaTags } from "../../api/_lib/share-card.js";
import { absoluteOgImages } from "../../scripts/og-image.mjs";

const shell = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const head = shell.slice(0, shell.indexOf("</head>"));
const meta = (html, key) => [...html.matchAll(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`, "g"))].map((m) => m[1]);

test("index.html: Titel, Beschreibung und Bild für die Vorschau", () => {
  assert.deepEqual(meta(head, "og:title"), ["AFTERHOURS – Ein Abend. Eine Crew. Kein Chat-Chaos."]);
  assert.equal(meta(head, "og:description").length, 1);
  assert.deepEqual(meta(head, "og:image"), ["/og/home.png"]);
  assert.deepEqual(meta(head, "og:image:width"), ["1200"]);
  assert.deepEqual(meta(head, "og:image:height"), ["630"]);
  assert.deepEqual(meta(head, "twitter:card"), ["summary_large_image"]);
  assert.match(meta(head, "og:image:alt")[0], /Beispiel/, "das Bild zeigt eine Beispiel-Abstimmung – der Alt-Text sagt das");
  assert.equal(meta(head, "robots").length, 0, "die Startseite darf in Suchmaschinen erscheinen");
  assert.doesNotMatch(head, /\d[\d.]*\s*(Nutzer|Crews|Downloads|Bewertungen)|★|kostenlos|gratis/i, "keine Zahlen- oder Preisbehauptungen");
});

test("Vorschaubild: PNG mit 1200 × 630", () => {
  const png = readFileSync(new URL("../../public/og/home.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 400_000, `klein genug für Messenger (${png.length} Byte)`);
});

test("Build: og:image wird mit VITE_SITE_URL absolut, sonst bleibt alles gleich", () => {
  assert.deepEqual(meta(absoluteOgImages(shell, "https://afterhours.test/"), "og:image"), ["https://afterhours.test/og/home.png"]);
  assert.deepEqual(meta(absoluteOgImages(shell, " https://a.test/app "), "og:image"), ["https://a.test/app/og/home.png"]);
  for (const site of [undefined, "", "javascript:alert(1)", 'https://a.test/"><script>', "afterhours.test"]) {
    assert.equal(absoluteOgImages(shell, site), shell, `unverändert für ${JSON.stringify(site)}`);
  }
  assert.ok(absoluteOgImages(shell, "https://a.test").includes('<link rel="icon" href="/icons/favicon.svg"'), "nur og-Bilder, keine anderen Pfade");
});

test("Geteilter Plan (W2) ersetzt die Vorschau der Startseite vollständig", () => {
  const built = absoluteOgImages(shell, "https://afterhours.test");
  const tags = shareMetaTags({ title: "Bowling · AFTERHOURS", description: "Freitag · 3 sind dabei. Bist du dabei?", url: "https://afterhours.test/s/1", image: "https://afterhours.test/og/plan.png" });
  const html = injectMeta(built, tags);
  const planHead = html.slice(0, html.indexOf("</head>"));
  assert.deepEqual(meta(planHead, "og:title"), ["Bowling · AFTERHOURS"]);
  assert.deepEqual(meta(planHead, "og:image"), ["https://afterhours.test/og/plan.png"]);
  assert.equal(meta(planHead, "twitter:card").length, 1);
  assert.equal(meta(planHead, "og:image:alt").length, 1);
  assert.ok(!planHead.includes("home.png") && !planHead.includes("Kein Chat-Chaos"));
  assert.ok(planHead.includes('<meta name="theme-color"') && planHead.includes('<link rel="manifest"'), "übrige Tags der Hülle bleiben");
  assert.ok(html.includes('<div id="root"></div>'));
});
