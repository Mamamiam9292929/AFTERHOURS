import { t } from "@/i18n";
import { copyText } from "@/lib/hooks";
import { siteUrl } from "@/lib/supabase";
import { formatDateLong, formatDateTime, formatTime } from "@/lib/time";

/**
 * W8 · Teilen in den Gruppenchat. Der Text enthält nur Titel, Zeitpunkt und Link – keine Namen,
 * Adressen oder Treffpunkte. Der Link führt in die App; sehen kann den Plan nur, wer in der Crew ist.
 */
export interface ShareContent {
  title: string;
  text: string;
  url: string;
}

export function planShare(plan: { id: string; title: string; starts_at: string }): ShareContent {
  return {
    title: plan.title,
    text: t.share.planText(plan.title, `${formatDateLong(plan.starts_at)}, ${formatTime(plan.starts_at)}`),
    url: `${siteUrl()}/plans/${plan.id}`,
  };
}

export function pollShare(poll: { id: string; title: string; ends_at: string }): ShareContent {
  return {
    title: poll.title,
    text: t.share.pollText(poll.title, formatDateTime(poll.ends_at)),
    url: `${siteUrl()}/polls/${poll.id}`,
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
