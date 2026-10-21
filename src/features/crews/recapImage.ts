import type { RecapCardModel } from "@/lib/recapcard";

/** Texte für das Bild – kommen aus `t`, damit hier nichts Sichtbares fest steht. */
export interface RecapImageTexts {
  kicker: string;
  eveningsLabel: string;
  since: string | null;
  facts: { label: string; value: string }[];
  monthsTitle: string;
  monthLetters: string[];
  footer: string;
  host: string;
}

export const RECAP_IMAGE_WIDTH = 1080;
export const RECAP_IMAGE_HEIGHT = 1350;
/** Höhe des höchsten Monats auf dem Bild (für `recapCardModel`). */
export const RECAP_IMAGE_BAR_MAX = 120;

const BASE = "#08080d";
const LIME = "#c8ff2e";
const FG = "#f5f5f7";
const MUTED = "rgba(245,245,247,0.72)";
const DISPLAY = '"Unbounded", "Instrument Sans", sans-serif';
const SANS = '"Instrument Sans", sans-serif';

/** Die eigenen Schriften laden, bevor gezeichnet wird – sonst nimmt Canvas still eine Ersatzschrift. */
async function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const wanted = [`900 100px ${DISPLAY}`, `700 40px ${DISPLAY}`, `600 30px ${SANS}`, `700 30px ${SANS}`];
  await Promise.race([Promise.all(wanted.map((font) => document.fonts.load(font).catch(() => []))), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Schriftgröße so weit verkleinern, bis der Text in die Breite passt. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, size: number, maxWidth: number, min = 18): number {
  let current = size;
  ctx.font = `${weight} ${current}px ${family}`;
  while (current > min && ctx.measureText(text).width > maxWidth) {
    current -= 2;
    ctx.font = `${weight} ${current}px ${family}`;
  }
  return current;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(8,8,13,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, RECAP_IMAGE_WIDTH, RECAP_IMAGE_HEIGHT);
}

/**
 * P9 Etappe 2 · Zeichnet den Rückblick als Bild im Stil 2.0 (Aurora, Unbounded, Lime) – nur Zahlen.
 * Läuft vollständig im Browser; nichts wird hochgeladen.
 */
export async function renderRecapImage(model: RecapCardModel, texts: RecapImageTexts): Promise<Blob> {
  await fontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = RECAP_IMAGE_WIDTH;
  canvas.height = RECAP_IMAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  const pad = 88;
  const inner = RECAP_IMAGE_WIDTH - pad * 2;

  // Grund und Aurora.
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, RECAP_IMAGE_WIDTH, RECAP_IMAGE_HEIGHT);
  glow(ctx, 170, 150, 640, "rgba(123,92,255,0.55)");
  glow(ctx, 960, 300, 560, "rgba(255,79,163,0.42)");
  glow(ctx, 560, 1320, 560, "rgba(200,255,46,0.16)");
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Wortmarke.
  ctx.font = `800 44px ${DISPLAY}`;
  let x = pad;
  for (const [part, color] of [["AFTER", FG], ["/", LIME], ["HOURS", FG]] as const) {
    ctx.fillStyle = color;
    ctx.fillText(part, x, 150);
    x += ctx.measureText(part).width;
  }

  // Überschrift und große Zahl.
  ctx.fillStyle = MUTED;
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText(texts.kicker.toLocaleUpperCase("de-DE"), pad, 290);
  const number = String(model.evenings);
  ctx.fillStyle = LIME;
  fitFont(ctx, number, 900, DISPLAY, number.length <= 2 ? 300 : 230, inner);
  ctx.fillText(number, pad - 8, 590);
  ctx.fillStyle = FG;
  fitFont(ctx, texts.eveningsLabel, 700, DISPLAY, 60, inner);
  ctx.fillText(texts.eveningsLabel, pad, 680);
  if (texts.since) {
    ctx.fillStyle = MUTED;
    ctx.font = `600 38px ${SANS}`;
    ctx.fillText(texts.since, pad, 740);
  }

  // Kacheln: Serie, größte Runde, Lieblingstag.
  if (texts.facts.length > 0) {
    const gap = 24;
    const w = (inner - gap * (texts.facts.length - 1)) / texts.facts.length;
    texts.facts.forEach((fact, i) => {
      const fx = pad + i * (w + gap);
      roundRect(ctx, fx, 810, w, 150, 28);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = MUTED;
      fitFont(ctx, fact.label.toLocaleUpperCase("de-DE"), 700, SANS, 24, w - 48, 16);
      ctx.fillText(fact.label.toLocaleUpperCase("de-DE"), fx + 24, 862);
      ctx.fillStyle = FG;
      fitFont(ctx, fact.value, 700, DISPLAY, 38, w - 48, 18);
      ctx.fillText(fact.value, fx + 24, 920);
    });
  }

  // Die letzten zwölf Monate.
  ctx.fillStyle = MUTED;
  ctx.font = `600 28px ${SANS}`;
  ctx.fillText(texts.monthsTitle, pad, 1040);
  const baseline = 1190;
  const barGap = 14;
  const barWidth = (inner - barGap * (model.bars.length - 1)) / Math.max(1, model.bars.length);
  model.bars.forEach((bar, i) => {
    const bx = pad + i * (barWidth + barGap);
    roundRect(ctx, bx, baseline - bar.height, barWidth, bar.height, bar.count > 0 ? [10, 10, 2, 2] : 2);
    ctx.fillStyle = bar.count > 0 ? LIME : "rgba(255,255,255,0.2)";
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.font = `600 24px ${SANS}`;
    ctx.textAlign = "center";
    ctx.fillText(texts.monthLetters[i] ?? "", bx + barWidth / 2, baseline + 38);
    ctx.textAlign = "left";
  });

  // Fußzeile.
  ctx.fillStyle = FG;
  ctx.font = `700 30px ${SANS}`;
  ctx.fillText(texts.footer, pad, 1290);
  if (texts.host) {
    ctx.fillStyle = MUTED;
    ctx.font = `600 26px ${SANS}`;
    ctx.textAlign = "right";
    ctx.fillText(texts.host, RECAP_IMAGE_WIDTH - pad, 1290);
    ctx.textAlign = "left";
  }

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas_unavailable"))), "image/png"));
}
