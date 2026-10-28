#!/usr/bin/env node
/*
 * P4 · VAPID-Schlüssel für Web-Push erzeugen (P-256, ohne Abhängigkeiten, nichts geht ins Netz).
 *
 *   node scripts/vapid-keys.mjs                         # Ausgabe als Zeilen für .env bzw. Supabase-Secrets
 *   node scripts/vapid-keys.mjs mailto:push@example.org # Kontakt gleich mit eintragen
 *
 * Dann (gehostet):  supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:…
 *                   supabase functions deploy push
 * Der private Schlüssel gehört nur in die Secrets der Edge Function – nie ins Frontend, nie ins Repository.
 * Wer die Schlüssel später austauscht, macht alle bestehenden Push-Abos ungültig (die Geräte müssen
 * Push neu einschalten).
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
const subject = process.argv[2] ?? "mailto:push@example.org";

console.log(`VAPID_PUBLIC_KEY=${raw.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${priv.d}`);
console.log(`VAPID_SUBJECT=${subject}`);
