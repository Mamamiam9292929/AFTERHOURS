import { locale, t } from "@/i18n";
import { copyText } from "@/lib/hooks";
import { siteUrl } from "@/lib/supabase";
import { formatDateLong, formatDateTime, formatTime } from "@/lib/time";

/**
 * W8 · Teilen in den Gruppenchat. Der Text enthält nur Titel, Zeitpunkt und Link – keine Namen,
 * Adressen oder Treffpunkte. Der Link führt in die App; den Plan selbst sieht nur, wer in der Crew ist.
 */
export interface ShareContent {
  title: string;
  text: string;
  url: string;
}

/**
 * P11 Etappe 2b: Auf Englisch trägt der geteilte Link `?lang=en` – dann ist auch die Vorschau im Gruppenchat
 * englisch (api/share.js). Deutsch bleibt ohne Zusatz wie bisher. Nur die Sprache, keine Person.
 */
const langQuery = () => (locale === "en" ? "?lang=en" : "");

/**
 * W2: Mit Teilen-Token führt der Link auf /s/<token> – dort gibt es eine Vorschau für Messenger und
 * Freunde ohne Konto. Ohne Token (noch nicht geladen, Fehler) bleibt es beim direkten Link zum Plan.
 */
export function planShare(plan: { id: string; title: string; starts_at: string }, shareToken?: string | null): ShareContent {
  return {
    title: plan.title,
    text: t.share.planText(plan.title, `${formatDateLong(plan.starts_at)}, ${formatTime(plan.starts_at)}`),
    url: shareToken ? `${siteUrl()}/s/${shareToken}${langQuery()}` : `${siteUrl()}/plans/${plan.id}`,
  };
}

/**
 * P28 Etappe 2: Ist eine Abstimmung entschieden und ein Plan daraus geworden, geht das Ergebnis mit demselben Link
 * wie beim Plan zurück in den Gruppenchat – „Entschieden: …“ statt nur Titel und Zeit. Gäste, die über den
 * Abstimm-Link mitgestimmt haben, finden den Plan danach auch dort (P28).
 */
export function decidedShare(plan: { id: string; title: string; starts_at: string }, shareToken?: string | null): ShareContent {
  return { ...planShare(plan, shareToken), text: t.share.decidedText(plan.title, `${formatDateLong(plan.starts_at)}, ${formatTime(plan.starts_at)}`) };
}

/** W2 Etappe 2: wie beim Plan – mit Token auf /v/<token> (Vorschau), sonst direkt zur Abstimmung. */
export function pollShare(poll: { id: string; title: string; ends_at: string }, shareToken?: string | null): ShareContent {
  return {
    title: poll.title,
    text: t.share.pollText(poll.title, formatDateTime(poll.ends_at)),
    url: shareToken ? `${siteUrl()}/v/${shareToken}${langQuery()}` : `${siteUrl()}/polls/${poll.id}`,
  };
}

export type ShareOutcome = "shared" | "cancelled" | "copied" | "failed";

/** Öffnet das Teilen-Menü des Geräts; ohne Web Share API wird Text samt Link kopiert. */
export async function shareOrCopy(content: ShareContent): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(content);
      return "shared";
    } catch (error) {
      // Abbruch durch die Person ist kein Fehler; alles andere fällt auf Kopieren zurück.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(`${content.text}\n${content.url}`)) ? "copied" : "failed";
}
