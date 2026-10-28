/**
 * P4 · Web-Push: Wohin eine Benachrichtigung führt und wie sie als Mitteilung des Geräts aussieht.
 *
 * Läuft an zwei Stellen: in der App (Liste der Benachrichtigungen) und im Service Worker, wenn ein Push
 * ankommt (gebaut als `push-texts.js`, siehe `src/push/render.ts`). Die Texte selbst kommen von außen
 * (`t.notifications.text`), damit es nur eine Quelle gibt.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export interface NotificationRef {
  type: string;
  crew_id: string | null;
  entity_type: string | null;
  related_entity_id: string | null;
}

/** Wohin eine Benachrichtigung führt – immer ein Pfad dieser App, nie eine fremde Adresse. */
export function notificationTarget(n: NotificationRef): string | null {
  if (n.type === "reward_earned") return "/rewards";
  // S4: „Heute noch wer?“ wird auf Home beantwortet.
  if (n.type === "spontaneous_ask" || n.type === "spontaneous_answer" || n.type === "spontaneous_match") return "/";
  // P3 Etappe 3b: Die Erinnerung führt direkt zu „Kosten teilen“.
  if (n.type === "plan_expense_reminder" && n.related_entity_id) return `/plans/${n.related_entity_id}#kosten`;
  if (!n.related_entity_id) return n.crew_id ? `/crews/${n.crew_id}` : null;
  if (n.entity_type === "poll") return `/polls/${n.related_entity_id}`;
  if (n.entity_type === "plan") return `/plans/${n.related_entity_id}`;
  if (n.entity_type === "crew") return `/crews/${n.related_entity_id}`;
  return null;
}

/** Was im Push steckt (siehe `claim_push_batch` in der Migration 20261028010000_web_push.sql). */
export interface PushMessage {
  v?: number;
  id?: string;
  type?: string;
  actor?: string | null;
  crew_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  payload?: Record<string, unknown>;
  at?: string;
  unread?: number;
}

export type TextFor = (type: string) => ((actor: string, payload: Record<string, unknown>) => { title: string; body?: string }) | undefined;

export interface PushTexts {
  /** Titel, wenn der Push unbekannt oder unvollständig ist. */
  fallbackTitle: string;
  fallbackBody: string;
  /** Name, wenn die auslösende Person unbekannt ist („Jemand“). */
  someone: string;
}

export interface PushView {
  title: string;
  body: string;
  /** Pfad in der App, der beim Antippen geöffnet wird. */
  url: string;
  /** Gleiche Benachrichtigung → ersetzt statt doppelt. */
  tag: string;
  /** Ungelesene für den Zähler am App-Icon (falls bekannt). */
  badge: number | null;
  timestamp: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value : null);

/** Aus dem Inhalt eines Pushs die Mitteilung des Geräts. Alles Unbekannte fällt auf einen allgemeinen Text zurück. */
export function pushView(raw: unknown, textFor: TextFor, texts: PushTexts): PushView {
  const message: PushMessage = raw && typeof raw === "object" ? (raw as PushMessage) : {};
  const fallback: PushView = { title: texts.fallbackTitle, body: texts.fallbackBody, url: "/notifications", tag: "afterhours", badge: null, timestamp: null };
  const id = uuidOrNull(message.id);
  const badge = typeof message.unread === "number" && Number.isFinite(message.unread) && message.unread >= 0 ? Math.floor(message.unread) : null;
  const at = typeof message.at === "string" ? Date.parse(message.at) : NaN;
  const timestamp = Number.isFinite(at) ? at : null;
  const render = typeof message.type === "string" ? textFor(message.type) : undefined;
  if (!render) return { ...fallback, tag: id ?? fallback.tag, badge, timestamp };

  const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? message.payload : {};
  const actor = typeof message.actor === "string" && message.actor.trim() ? message.actor.trim() : texts.someone;
  let text: { title: string; body?: string };
  try {
    text = render(actor, payload);
  } catch {
    return { ...fallback, tag: id ?? fallback.tag, badge, timestamp };
  }
  const target = notificationTarget({
    type: message.type as string,
    crew_id: uuidOrNull(message.crew_id),
    entity_type: typeof message.entity_type === "string" ? message.entity_type : null,
    related_entity_id: uuidOrNull(message.entity_id),
  });
  return {
    title: text.title || texts.fallbackTitle,
    body: text.body ?? "",
    url: target ?? "/notifications",
    tag: id ?? fallback.tag,
    badge,
    timestamp,
  };
}
