/**
 * P10 Etappe 1b · Fotos vor dem Hochladen verkleinern.
 *
 * Das Foto wird im Browser neu gezeichnet (Canvas) und neu gespeichert: höchstens 1600 px an der langen
 * Seite, als WebP – wo der Browser kein WebP speichern kann (Safari), als JPEG. Beim Neuzeichnen fallen
 * alle Metadaten weg (EXIF mit Aufnahmeort, Kamera, Uhrzeit); nur die Pixel gehen hinaus.
 */

export const PHOTO_MAX_SIDE = 1600;
/** Grenze des Buckets (2 MiB); die Qualität sinkt, bis das Foto passt. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PLAN_PHOTO_LIMIT = 50;
export const PLAN_PHOTO_USER_LIMIT = 10;

export type PhotoType = "image/webp" | "image/jpeg";

export interface ShrunkPhoto {
  blob: Blob;
  width: number;
  height: number;
  type: PhotoType;
}

/** Maße, die in `max` × `max` passen, ohne zu vergrößern; nie unter 1 px. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Wie viele Fotos darf ich noch hochladen? (je Plan 50, je Person 10) */
export function photosLeft(total: number, mine: number): number {
  return Math.max(0, Math.min(PLAN_PHOTO_LIMIT - total, PLAN_PHOTO_USER_LIMIT - mine));
}

/** Nur Bilder, die der Browser lesen kann; HEIC (iPhone) liefert Safari beim Auswählen schon als JPEG. */
export function looksLikeImage(file: { type: string; name: string }): boolean {
  return file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name);
}

/** Fehler im Format der RPC-Fehler, damit `errorMessage` den Text kennt. */
const invalidPhoto = () => Object.assign(new Error("invalid_plan_photo"), { code: "P0001" });

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Datei → verkleinertes WebP/JPEG ohne Metadaten. Wirft `invalid_plan_photo` (P0001), wenn das nicht geht. */
export async function shrinkPhoto(file: File): Promise<ShrunkPhoto> {
  let bitmap: ImageBitmap;
  try {
    // Ausrichtung aus EXIF anwenden (Hochformat bleibt Hochformat), danach ist EXIF egal.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw invalidPhoto();
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  if (width === 0) throw invalidPhoto();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw invalidPhoto();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of [0.82, 0.7, 0.55]) {
    let blob = await toBlob(canvas, "image/webp", quality);
    // Safari speichert statt WebP stillschweigend PNG – dann JPEG.
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) break;
    if (blob.size <= PHOTO_MAX_BYTES) return { blob, width, height, type: blob.type };
  }
  throw invalidPhoto();
}
