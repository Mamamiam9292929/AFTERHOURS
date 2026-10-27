/**
 * Roadmap P7 · Fotos von Orten über Wikimedia Commons.
 *
 * Aus OpenStreetMap kennt die Datenbank nur den Verweis eines Ortes: eine Datei bei Commons
 * (`commons_file`, „File:…“) oder einen Wikidata-Eintrag (`wikidata_id`, dessen Bild P18). Bild,
 * Urheber:in und Lizenz holt erst der Browser – und nur, wenn die Person es will (Tipp auf „Foto
 * anzeigen“ oder für dieses Gerät eingeschaltet), weil Wikimedia dabei die IP-Adresse erfährt.
 *
 * Gezeigt wird ein Bild nur mit freier Lizenz (CC0, Public Domain, CC BY, CC BY-SA) und – wo die
 * Lizenz es verlangt – mit Urheber:in. Alles andere zählt als „kein Foto“; erfunden wird nichts.
 * Reiner Code ohne React, getestet in tests/unit/commons.test.mjs.
 */

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
/** Breite des Vorschaubilds: reicht für die Detailseite auf dem Desktop und für 2× auf dem Handy. */
export const PHOTO_WIDTH = 960;

export interface PhotoRef {
  commons_file: string | null;
  wikidata_id: string | null;
}

export interface PlacePhoto {
  src: string;
  width: number | null;
  height: number | null;
  /** „Moritzbastei Leipzig.jpg“ – ohne „File:“. */
  file: string;
  /** Seite der Datei bei Commons (Lizenz und Urheber im Original). */
  pageUrl: string;
  author: string | null;
  license: string;
  licenseUrl: string | null;
}

export class PhotoError extends Error {
  constructor() {
    super("photo_unavailable");
  }
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

export const hasPhotoRef = (ref: Partial<PhotoRef> | null | undefined) => Boolean(ref?.commons_file || ref?.wikidata_id);

const FILE = /^File:[^\][/|#<>{}\u0000-\u001f]{1,240}\.(?:jpe?g|png|webp)$/i;
const MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
// Freie Lizenzen, die Commons so benennt („CC BY-SA 4.0“, „CC BY 3.0 de“, „CC0“, „Public domain“).
const FREE_LICENSE = /^(?:CC0(?: 1\.0)?|CC BY(?:-SA)? [1-4]\.0(?: [a-z]{2,3})?|Public domain|PD(?:[- ][A-Za-z0-9.-]+)?)$/i;
const NEEDS_AUTHOR = /^CC BY/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML aus den Commons-Metadaten → reiner Text (nie als HTML einsetzen). */
export function plainText(html: unknown, max = 120): string | null {
  if (typeof html !== "string") return null;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const meta = (data: Record<string, { value?: unknown } | undefined> | undefined, key: string) => data?.[key]?.value;

/** Antwort von Commons (imageinfo) → Foto oder null, wenn es keins mit freier Lizenz gibt. */
export function parseImageInfo(body: unknown): PlacePhoto | null {
  const page = (body as { query?: { pages?: unknown[] } } | null)?.query?.pages?.[0] as
    | { title?: string; missing?: boolean; imageinfo?: Record<string, unknown>[] }
    | undefined;
  const info = page?.imageinfo?.[0];
  if (!page || page.missing || !info || typeof page.title !== "string" || !FILE.test(page.title)) return null;

  const src = typeof info.thumburl === "string" ? info.thumburl : typeof info.url === "string" ? info.url : "";
  const pageUrl = typeof info.descriptionurl === "string" ? info.descriptionurl : "";
  if (!/^https:\/\/upload\.wikimedia\.org\/[^\s"'<>]+$/.test(src)) return null;
  if (!/^https:\/\/commons\.wikimedia\.org\/[^\s"'<>]+$/.test(pageUrl)) return null;
  if (typeof info.mime !== "string" || !MIME.has(info.mime)) return null;

  const ext = info.extmetadata as Record<string, { value?: unknown }> | undefined;
  const license = plainText(meta(ext, "LicenseShortName"), 40);
  if (!license || !FREE_LICENSE.test(license)) return null;
  // Erkennbare Personen (Persönlichkeitsrechte) zeigt die App nicht als Titelbild eines Ortes.
  const restrictions = String(meta(ext, "Restrictions") ?? "");
  if (/\bpersonality\b/i.test(restrictions)) return null;
  const author = plainText(meta(ext, "Artist"));
  const attribution = String(meta(ext, "AttributionRequired") ?? "").toLowerCase() === "true" || NEEDS_AUTHOR.test(license);
  if (attribution && !author) return null;

  const rawLicenseUrl = meta(ext, "LicenseUrl");
  const licenseUrl = typeof rawLicenseUrl === "string" ? rawLicenseUrl.replace(/^\/\//, "https://") : "";
  const width = Number(info.thumbwidth ?? info.width);
  const height = Number(info.thumbheight ?? info.height);
  return {
    src,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    file: page.title.slice("File:".length),
    pageUrl,
    author,
    license,
    licenseUrl: /^https:\/\/[^\s"'<>]+$/.test(licenseUrl) ? licenseUrl : null,
  };
}

/** Antwort von Wikidata (wbgetclaims, P18) → „File:…“ oder null. Bevorzugt, sonst normal; nie veraltet. */
export function parseWikidataImage(body: unknown): string | null {
  const claims = (body as { claims?: { P18?: { rank?: string; mainsnak?: { datavalue?: { value?: unknown } } }[] } } | null)?.claims?.P18 ?? [];
  const usable = claims.filter((c) => c.rank !== "deprecated");
  const best = usable.find((c) => c.rank === "preferred") ?? usable[0];
  const value = best?.mainsnak?.datavalue?.value;
  if (typeof value !== "string") return null;
  const file = `File:${value.replace(/_/g, " ").trim()}`;
  return FILE.test(file) ? file : null;
}

// Ohne Cookies und ohne Referrer: Wikimedia erfährt nicht, von welcher Seite (welchem Ort) die Anfrage kommt.
const REQUEST: RequestInit = { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" };

async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  let response: Awaited<ReturnType<Fetcher>>;
  try {
    response = await fetcher(url, REQUEST);
  } catch {
    throw new PhotoError();
  }
  if (!response.ok) throw new PhotoError();
  return response.json().catch(() => {
    throw new PhotoError();
  });
}

export function imageInfoUrl(file: string): string {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*", prop: "imageinfo",
    iiprop: "url|mime|extmetadata", iiurlwidth: String(PHOTO_WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|AttributionRequired|Restrictions", titles: file,
  });
  return `${COMMONS_API}?${params}`;
}

export function wikidataUrl(id: string): string {
  const params = new URLSearchParams({ action: "wbgetclaims", format: "json", origin: "*", entity: id, property: "P18" });
  return `${WIKIDATA_API}?${params}`;
}

/**
 * Foto zu einem Ort: erst die Commons-Datei aus OSM, sonst das Bild des Wikidata-Eintrags.
 * null = kein Foto mit freier Lizenz; PhotoError = Commons/Wikidata gerade nicht erreichbar.
 */
export async function loadPlacePhoto(ref: PhotoRef, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<PlacePhoto | null> {
  const files: string[] = [];
  if (ref.commons_file && FILE.test(ref.commons_file)) files.push(ref.commons_file);
  for (const file of files) {
    const photo = parseImageInfo(await getJson(fetcher, imageInfoUrl(file)));
    if (photo) return photo;
  }
  if (ref.wikidata_id && /^Q[1-9][0-9]{0,11}$/.test(ref.wikidata_id)) {
    const file = parseWikidataImage(await getJson(fetcher, wikidataUrl(ref.wikidata_id)));
    if (file && !files.includes(file)) return parseImageInfo(await getJson(fetcher, imageInfoUrl(file)));
  }
  return null;
}

// Einwilligung „Fotos automatisch laden“ – nur auf diesem Gerät, nie an den Server.
const AUTO_KEY = "afterhours.photos.auto";

export function photosAutoLoad(): boolean {
  try {
    return window.localStorage.getItem(AUTO_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPhotosAutoLoad(on: boolean) {
  try {
    if (on) window.localStorage.setItem(AUTO_KEY, "1");
    else window.localStorage.removeItem(AUTO_KEY);
  } catch {
    // Speicher gesperrt (privater Modus o. Ä.) – dann fragt die App eben jedes Mal.
  }
}
