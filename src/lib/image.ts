/**
 * Profilbilder werden im Browser auf 128×128 zugeschnitten und als kleines JPEG (Data-URL, wenige kB)
 * im Profil gespeichert. Damit braucht das MVP keinen Datei-Speicher; die Datenbank akzeptiert
 * ausschließlich Bild-Data-URLs dieser Art oder https-Adressen.
 */
export const AVATAR_SIZE = 128;
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

export type AvatarError = "not_an_image" | "too_large" | "unreadable";

export async function fileToAvatarDataUrl(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: AvatarError }> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "not_an_image" };
  if (file.size > MAX_INPUT_BYTES) return { ok: false, error: "too_large" };
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: "unreadable" };
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    bitmap.close();
    return { ok: true, dataUrl: canvas.toDataURL("image/jpeg", 0.82) };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}
