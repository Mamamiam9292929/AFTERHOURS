/**
 * W7 · Store-Grafiken aus den Quellen in docs/design/store-*.html rendern (Playwright, Chromium).
 *
 *   node scripts/store-graphics.mjs
 *
 * Ergebnis in store/grafik/ – Größen und Farbtiefe prüft tests/unit/store-texts.test.mjs:
 *   app-store-icon-1024.png      1024 × 1024, RGB ohne Transparenz (Apple verlangt das)
 *   play-icon-512.png             512 × 512, RGBA, 32 Bit (Google verlangt das)
 *   play-feature-1024x500.png    1024 × 500, RGB ohne Transparenz (Vorstellungsgrafik)
 * Die Store-Screenshots entstehen in der Browser-Journey (Schritt „W7 – Store-Screenshots“).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = (name) => path.join(root, "store", "grafik", name);
const src = (name) => pathToFileURL(path.join(root, "docs", "design", name)).href;

const jobs = [
  { source: "store-icon.html", size: [1024, 1024], file: "app-store-icon-1024.png", alpha: false },
  { source: "store-icon.html", size: [512, 512], file: "play-icon-512.png", alpha: true },
  { source: "store-feature.html", size: [1024, 500], file: "play-feature-1024x500.png", alpha: false },
];

const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const [width, height] = job.size;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(src(job.source));
    await page.evaluate(() => document.fonts.ready);
    // Chromium speichert deckende Screenshots als RGB. Für Google (32-Bit-PNG) läuft das Bild einmal durch ein
    // Canvas, dessen PNG immer einen Alphakanal hat – die Pixel bleiben gleich.
    let png = await page.screenshot();
    if (job.alpha) {
      const dataUrl = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        return canvas.toDataURL("image/png");
      }, png.toString("base64"));
      png = Buffer.from(dataUrl.split(",")[1], "base64");
    }
    fs.writeFileSync(out(job.file), png);
    await page.close();
    console.log(`✓ ${job.file} (${width} × ${height}${job.alpha ? ", RGBA" : ", RGB"})`);
  }
} finally {
  await browser.close();
}
