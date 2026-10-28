/**
 * Versand eines Stapels aus claim_push_batch: je Gerät verschlüsseln, signieren, an den Push-Dienst
 * schicken und das Ergebnis für report_push_results einsammeln. `fetch` ist austauschbar (Tests).
 */
import { allowedEndpoint, type Bytes, classifyResponse, type DeliveryResult, encryptPayload, type EndpointRules, MAX_PLAINTEXT, vapidAuthorization, type VapidKeys } from "./webpush.ts";

export interface PushItem {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  urgency?: string;
  message: Record<string, unknown>;
}

export interface PushOutcome {
  id: number;
  result: DeliveryResult;
}

/** Wie lange der Push-Dienst eine Nachricht für ein ausgeschaltetes Gerät aufhebt (12 Stunden). */
export const PUSH_TTL_SECONDS = 12 * 3600;
const PARALLEL = 10;
const encoder = new TextEncoder();

/** Nachricht als Bytes; passt sie nicht in einen Push, geht sie ohne Einzelheiten (die App zeigt dann einen allgemeinen Text). */
export function messageBytes(message: Record<string, unknown>): Bytes {
  const full = encoder.encode(JSON.stringify(message));
  if (full.length <= MAX_PLAINTEXT) return full;
  return encoder.encode(JSON.stringify({ ...message, payload: {}, actor: null }));
}

export async function deliverOne(item: PushItem, vapid: VapidKeys, rules: EndpointRules, fetchImpl: typeof fetch = fetch): Promise<PushOutcome> {
  const target = allowedEndpoint(item.endpoint, rules);
  if (!target) return { id: item.id, result: "gone" };
  let body: Bytes;
  try {
    body = await encryptPayload(messageBytes(item.message), item.p256dh, item.auth);
  } catch {
    // Unbrauchbare Schlüssel – das Gerät muss sich neu anmelden.
    return { id: item.id, result: "gone" };
  }
  try {
    const response = await fetchImpl(target.href, {
      method: "POST",
      headers: {
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: item.urgency === "high" ? "high" : "normal",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        Authorization: await vapidAuthorization(item.endpoint, vapid),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return { id: item.id, result: classifyResponse(response.status) };
  } catch {
    return { id: item.id, result: "retry" };
  }
}

export async function deliverAll(items: PushItem[], vapid: VapidKeys, rules: EndpointRules, fetchImpl: typeof fetch = fetch): Promise<PushOutcome[]> {
  const outcomes: PushOutcome[] = [];
  for (let i = 0; i < items.length; i += PARALLEL) {
    outcomes.push(...(await Promise.all(items.slice(i, i + PARALLEL).map((item) => deliverOne(item, vapid, rules, fetchImpl)))));
  }
  return outcomes;
}
