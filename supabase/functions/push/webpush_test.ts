// P4: Web-Push ohne Netz – Verschlüsselung gegen das Beispiel aus RFC 8291, VAPID, erlaubte Dienste, Versand.
//   deno test supabase/functions/push/webpush_test.ts
import { deliverAll, messageBytes, PUSH_TTL_SECONDS, type PushItem } from "./deliver.ts";
import {
  allowedEndpoint,
  base64UrlDecode,
  base64UrlEncode,
  classifyResponse,
  decryptPayload,
  encryptPayload,
  MAX_PLAINTEXT,
  validVapidKeys,
  vapidAuthorization,
  vapidKeysMatch,
  type VapidKeys,
  type Bytes,
} from "./webpush.ts";


// Eigene kleine Prüfhilfen – ohne Netz, wie in den übrigen Function-Tests.
function assert(condition: unknown, message = "Bedingung nicht erfüllt"): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message ? `${message}: ` : ""}erwartet ${b}, erhalten ${a}`);
}
async function assertRejects(fn: () => Promise<unknown>, _type?: unknown, includes?: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (includes && !String((error as Error)?.message).includes(includes)) throw new Error(`falscher Fehler: ${(error as Error)?.message}`);
    return;
  }
  throw new Error("kein Fehler");
}

const text = new TextEncoder();
const read = new TextDecoder();

// RFC 8291, Abschnitt 5 (Beispiel mit festen Schlüsseln und festem Salz).
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** Ein „Gerät“ wie im Browser: Schlüsselpaar P-256 und 16 Byte Auth-Geheimnis. */
async function device() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { publicKey, privateKey: base64UrlDecode(jwk.d!), auth, p256dh: base64UrlEncode(publicKey), authText: base64UrlEncode(auth) };
}

async function vapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), privateKey: jwk.d!, subject: "mailto:push@afterhours.invalid" };
}

Deno.test("RFC 8291: Verschlüsselung ergibt genau das Beispiel der Spezifikation", async () => {
  const body = await encryptPayload(text.encode(RFC.plaintext), RFC.uaPublic, RFC.auth, {
    salt: base64UrlDecode(RFC.salt),
    senderPrivateKey: base64UrlDecode(RFC.asPrivate),
    senderPublicKey: base64UrlDecode(RFC.asPublic),
  });
  assertEquals(base64UrlEncode(body), RFC.body);
});

Deno.test("RFC 8291: das Beispiel lässt sich mit dem Geräteschlüssel entschlüsseln", async () => {
  const plain = await decryptPayload(base64UrlDecode(RFC.body), base64UrlDecode(RFC.uaPrivate), base64UrlDecode(RFC.uaPublic), base64UrlDecode(RFC.auth));
  assertEquals(read.decode(plain), RFC.plaintext);
});

Deno.test("Hin und zurück: jede Nachricht hat neues Salz und neuen Absenderschlüssel", async () => {
  const ua = await device();
  const message = JSON.stringify({ type: "poll_created", actor: "Bob", payload: { title: "Bowling 🎳 am Freitag" } });
  const a = await encryptPayload(text.encode(message), ua.p256dh, ua.authText);
  const b = await encryptPayload(text.encode(message), ua.p256dh, ua.authText);
  assert(base64UrlEncode(a) !== base64UrlEncode(b), "zwei Nachrichten dürfen nie gleich aussehen");
  assertEquals(new DataView(a.buffer).getUint32(16), 4096, "Datensatzgröße im Kopf");
  assertEquals(a[20], 65, "Schlüssel-ID = öffentlicher Absenderschlüssel");
  assertEquals(read.decode(await decryptPayload(a, ua.privateKey, ua.publicKey, ua.auth)), message);
  // Ein anderes Gerät kann nichts lesen.
  const other = await device();
  await assertRejects(() => decryptPayload(a, other.privateKey, other.publicKey, other.auth));
});

Deno.test("Grenzen: zu große Nachricht und kaputte Schlüssel werden abgelehnt", async () => {
  const ua = await device();
  await encryptPayload(new Uint8Array(MAX_PLAINTEXT), ua.p256dh, ua.authText);
  await assertRejects(() => encryptPayload(new Uint8Array(MAX_PLAINTEXT + 1), ua.p256dh, ua.authText), Error, "payload_too_large");
  await assertRejects(() => encryptPayload(text.encode("x"), ua.p256dh.slice(0, 40), ua.authText), Error, "invalid_public_key");
  await assertRejects(() => encryptPayload(text.encode("x"), ua.p256dh, "AAAA"), Error, "invalid_auth_secret");
  const big = messageBytes({ type: "plan_changed", actor: "Bob", payload: { title: "x".repeat(5000) } });
  assert(big.length <= MAX_PLAINTEXT, "zu große Inhalte gehen ohne Einzelheiten");
  assertEquals(JSON.parse(read.decode(big)).payload, {});
});

Deno.test("VAPID: signiertes JWT für den Push-Dienst, 12 Stunden gültig", async () => {
  const keys = await vapidKeys();
  assert(validVapidKeys(keys));
  assert(await vapidKeysMatch(keys));
  const now = Date.UTC(2026, 9, 28, 20, 0, 0);
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc:def", keys, now);
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert(match, header);
  const [, h, c, s, k] = match;
  assertEquals(k, keys.publicKey);
  assertEquals(JSON.parse(read.decode(base64UrlDecode(h))), { typ: "JWT", alg: "ES256" });
  assertEquals(JSON.parse(read.decode(base64UrlDecode(c))), { aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:push@afterhours.invalid" });
  const verifier = await crypto.subtle.importKey("raw", base64UrlDecode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, base64UrlDecode(s), text.encode(`${h}.${c}`)), "Signatur passt zum öffentlichen Schlüssel");
});

Deno.test("VAPID: falsche oder unpassende Schlüssel werden erkannt", async () => {
  const keys = await vapidKeys();
  const other = await vapidKeys();
  assert(!validVapidKeys({ ...keys, subject: "push@afterhours.invalid" }), "Kontakt braucht mailto: oder https://");
  assert(!validVapidKeys({ ...keys, publicKey: keys.publicKey.slice(1) }));
  assert(!validVapidKeys({ ...keys, privateKey: "" }));
  assert(!(await vapidKeysMatch({ ...keys, privateKey: other.privateKey })), "privater Schlüssel eines anderen Paares fällt auf");
});

Deno.test("Nur bekannte Push-Dienste – keine internen oder fremden Adressen", () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://web.push.apple.com/QGx",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=BQ",
  ]) assertEquals(allowedEndpoint(ok)?.href, new URL(ok).href, ok);
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilfcm.googleapis.com.example/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "nicht einmal eine Adresse",
  ]) assertEquals(allowedEndpoint(bad), null, bad);
  // Stellvertreter in der CI: ausdrücklich freigegeben, und nur der wird über http angesprochen.
  const stub = allowedEndpoint("https://172.17.0.1:8091/push/alice", { extraHosts: ["172.17.0.1:8091"], plaintextHosts: ["172.17.0.1:8091"] });
  assertEquals(stub?.href, "http://172.17.0.1:8091/push/alice");
  assertEquals(allowedEndpoint("https://172.17.0.1:8092/push/alice", { extraHosts: ["172.17.0.1:8091"] }), null);
});

Deno.test("Antworten der Push-Dienste", () => {
  assertEquals(classifyResponse(201), "sent");
  assertEquals(classifyResponse(404), "gone");
  assertEquals(classifyResponse(410), "gone");
  for (const status of [400, 403, 413, 429, 500, 503]) assertEquals(classifyResponse(status), "retry", String(status));
});

Deno.test("Versand: verschlüsselt, signiert, Ergebnis je Gerät", async () => {
  const keys = await vapidKeys();
  const ua = await device();
  const items: PushItem[] = [
    { id: 1, endpoint: "https://fcm.googleapis.com/fcm/send/ok", p256dh: ua.p256dh, auth: ua.authText, urgency: "high", message: { type: "spontaneous_ask", actor: "Bob" } },
    { id: 2, endpoint: "https://fcm.googleapis.com/fcm/send/weg", p256dh: ua.p256dh, auth: ua.authText, message: { type: "poll_created" } },
    { id: 3, endpoint: "https://fcm.googleapis.com/fcm/send/netz", p256dh: ua.p256dh, auth: ua.authText, message: { type: "poll_created" } },
    { id: 4, endpoint: "https://intern.example/x", p256dh: ua.p256dh, auth: ua.authText, message: { type: "poll_created" } },
    { id: 5, endpoint: "https://fcm.googleapis.com/fcm/send/kaputt", p256dh: "AAAA", auth: ua.authText, message: { type: "poll_created" } },
  ];
  const requests: { url: string; headers: Headers; body: Bytes }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers), body: init?.body as Bytes });
    if (url.endsWith("/netz")) throw new TypeError("network down");
    return new Response(null, { status: url.endsWith("/weg") ? 410 : 201 });
  }) as typeof fetch;

  const outcomes = await deliverAll(items, keys, {}, fakeFetch);
  assertEquals(outcomes, [
    { id: 1, result: "sent" },
    { id: 2, result: "gone" },
    { id: 3, result: "retry" },
    { id: 4, result: "gone" },
    { id: 5, result: "gone" },
  ]);
  assertEquals(requests.length, 3, "nur erlaubte Dienste mit brauchbaren Schlüsseln werden angefragt");
  // Parallel verschickt – Reihenfolge der Anfragen ist nicht fest.
  const first = requests.find((r) => r.url.endsWith("/ok"))!;
  assertEquals(first.headers.get("TTL"), String(PUSH_TTL_SECONDS));
  assertEquals(first.headers.get("Urgency"), "high");
  assertEquals(first.headers.get("Content-Encoding"), "aes128gcm");
  assert(first.headers.get("Authorization")?.startsWith("vapid t="));
  assertEquals(requests.find((r) => r.url.endsWith("/weg"))!.headers.get("Urgency"), "normal");
  const plain = JSON.parse(read.decode(await decryptPayload(first.body, ua.privateKey, ua.publicKey, ua.auth)));
  assertEquals(plain, { type: "spontaneous_ask", actor: "Bob" });
});
