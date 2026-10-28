/**
 * Web-Push ohne Bibliothek (P4): Verschlüsselung nach RFC 8291 (aes128gcm, RFC 8188) und
 * VAPID-Anmeldung nach RFC 8292 – alles mit Web Crypto, das in Deno (und Browsern) eingebaut ist.
 *
 * Der Push-Dienst (Google, Apple, Mozilla, Microsoft) sieht nur die verschlüsselte Nachricht. Lesen
 * kann sie allein das Gerät, das die Schlüssel (p256dh, auth) erzeugt hat.
 */

/** Bytes auf einem normalen ArrayBuffer – so will es Web Crypto (TypeScript ≥ 5.7). */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Bytes): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Bytes {
  const clean = text.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) throw new Error("invalid_base64url");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

/** HKDF mit nur einem Block (≤ 32 Byte Ausgabe) – mehr braucht Web-Push nicht. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** Öffentlicher P-256-Schlüssel (65 Byte, unkomprimiert) als JWK-Teile. */
function pointToJwk(point: Bytes): { kty: "EC"; crv: "P-256"; x: string; y: string } {
  if (point.length !== 65 || point[0] !== 4) throw new Error("invalid_public_key");
  return { kty: "EC", crv: "P-256", x: base64UrlEncode(point.slice(1, 33)), y: base64UrlEncode(point.slice(33, 65)) };
}

async function importEcdhPrivate(privateKey: Bytes, publicKey: Bytes): Promise<CryptoKey> {
  return await crypto.subtle.importKey("jwk", { ...pointToJwk(publicKey), d: base64UrlEncode(privateKey), ext: true }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

async function importEcdhPublic(publicKey: Bytes): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

export interface EncryptOptions {
  /** Nur für Tests (RFC 8291, Abschnitt 5): feste Werte statt Zufall. */
  salt?: Bytes;
  senderPrivateKey?: Bytes;
  senderPublicKey?: Bytes;
}

/** Größte Nachricht, die in einen Datensatz von 4096 Byte passt (4096 − 86 Kopf − 16 Tag − 1 Trenner). */
export const MAX_PLAINTEXT = 3993;

/**
 * Verschlüsselt `plaintext` für ein Gerät (RFC 8291). Ergebnis ist der fertige Rumpf der Anfrage:
 * salt (16) · Datensatzgröße (4) · Länge der Schlüssel-ID (1) · öffentlicher Absenderschlüssel (65) · Chiffrat.
 */
export async function encryptPayload(plaintext: Bytes, p256dh: string, authSecret: string, options: EncryptOptions = {}): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("payload_too_large");
  const uaPublic = base64UrlDecode(p256dh);
  const auth = base64UrlDecode(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid_public_key");
  if (auth.length !== 16) throw new Error("invalid_auth_secret");

  let asPrivate: CryptoKey;
  let asPublic: Bytes;
  if (options.senderPrivateKey && options.senderPublicKey) {
    asPrivate = await importEcdhPrivate(options.senderPrivateKey, options.senderPublicKey);
    asPublic = options.senderPublicKey;
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("invalid_salt");

  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await importEcdhPublic(uaPublic) }, asPrivate, 256));
  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // Einziger (und damit letzter) Datensatz: Trenner 0x02, keine Auffüllung.
  const record = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/**
 * Gegenstück zu `encryptPayload` – so entschlüsselt das Gerät. Wird nur in Tests gebraucht (und
 * in der Browser-Journey nachgebaut), prüft aber die Rechnung unabhängig von der Verschlüsselung.
 */
export async function decryptPayload(body: Bytes, uaPrivateKey: Bytes, uaPublicKey: Bytes, authSecret: Bytes): Promise<Bytes> {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const uaPrivate = await importEcdhPrivate(uaPrivateKey, uaPublicKey);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await importEcdhPublic(asPublic) }, uaPrivate, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(encoder.encode("WebPush: info\0"), uaPublicKey, asPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext));
  // Auffüllung (Nullen) und Trenner abschneiden.
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end--;
  if (end < 0 || record[end] !== 2) throw new Error("invalid_padding");
  return record.slice(0, end);
}

export interface VapidKeys {
  /** Öffentlicher Schlüssel, 65 Byte base64url – derselbe, den der Browser beim Abonnieren bekommt. */
  publicKey: string;
  /** Privater Schlüssel (d), 32 Byte base64url. */
  privateKey: string;
  /** Kontakt für die Push-Dienste: mailto:… oder https://… */
  subject: string;
}

/** Prüft die VAPID-Umgebung, bevor irgendetwas verschickt wird. */
export function validVapidKeys(keys: Partial<VapidKeys>): keys is VapidKeys {
  try {
    if (!keys.publicKey || !keys.privateKey || !keys.subject) return false;
    const pub = base64UrlDecode(keys.publicKey);
    const priv = base64UrlDecode(keys.privateKey);
    return pub.length === 65 && pub[0] === 4 && priv.length === 32 && /^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(keys.subject);
  } catch {
    return false;
  }
}

/** `Authorization`-Kopf nach RFC 8292: „vapid t=<JWT>, k=<öffentlicher Schlüssel>“, 12 Stunden gültig. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    { ...pointToJwk(base64UrlDecode(keys.publicKey)), d: keys.privateKey, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Web Crypto liefert r‖s (64 Byte) – genau das Format, das JWS (ES256) erwartet.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${keys.publicKey}`;
}

/**
 * Nur bekannte Push-Dienste werden angeschrieben – sonst könnte jemand über eine erfundene
 * „Geräteadresse“ die Function auf beliebige Server (auch interne) schicken lassen.
 */
export const PUSH_HOSTS = ["fcm.googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com"];

export interface EndpointRules {
  /** Zusätzliche Hosts (exakt, mit Port), z. B. für Tests. */
  extraHosts?: string[];
  /** Hosts, die statt https über http angesprochen werden – nur für den Stellvertreter in der CI. */
  plaintextHosts?: string[];
}

/** Adresse, an die tatsächlich geschickt wird – oder null, wenn der Dienst nicht erlaubt ist. */
export function allowedEndpoint(endpoint: string, rules: EndpointRules = {}): URL | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const known = !url.port && PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  const extra = (rules.extraHosts ?? []).includes(url.host.toLowerCase());
  if (!known && !extra) return null;
  if ((rules.plaintextHosts ?? []).includes(url.host.toLowerCase())) url.protocol = "http:";
  return url;
}

export type DeliveryResult = "sent" | "gone" | "retry";

/** Antwort des Push-Dienstes → was mit dem Eintrag passiert. */
export function classifyResponse(status: number): DeliveryResult {
  if (status >= 200 && status < 300) return "sent";
  // 404/410: Gerät beim Dienst abgemeldet – es kommt nie wieder etwas an.
  if (status === 404 || status === 410) return "gone";
  // Alles andere (Überlast, Fehler, abgelehnte Anmeldung) später noch einmal. Ein Gerät, das 20-mal
  // hintereinander scheitert, entfernt die Datenbank – so löscht ein falsch gesetzter Schlüssel nicht
  // auf einen Schlag alle Geräte.
  return "retry";
}

/** Passt der private VAPID-Schlüssel zum öffentlichen? (Probe-Signatur, nichts verlässt die Function.) */
export async function vapidKeysMatch(keys: VapidKeys): Promise<boolean> {
  try {
    const jwk = pointToJwk(base64UrlDecode(keys.publicKey));
    const signer = await crypto.subtle.importKey("jwk", { ...jwk, d: keys.privateKey, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const verifier = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const probe = encoder.encode("afterhours-vapid-probe");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, probe);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, signature, probe);
  } catch {
    return false;
  }
}
