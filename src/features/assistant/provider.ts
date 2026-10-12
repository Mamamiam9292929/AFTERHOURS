/**
 * Austauschbare Schnittstelle zum KI-Planungsassistenten.
 *
 * Der Browser spricht nie direkt mit einem KI-Anbieter: Er ruft die Supabase Edge Function
 * "assistant" auf (supabase/functions/assistant). Dort liegt der API-Schlüssel als Server-Secret,
 * dort wird die Anfrage ausgewertet und ausschließlich gegen die Tabelle `activities` beantwortet –
 * der Assistent kann also keine Orte, Preise oder Öffnungszeiten erfinden, die nicht hinterlegt sind.
 * Ein anderer Anbieter erfordert nur eine andere Implementierung der Edge Function.
 */
import { supabase } from "@/lib/supabase";
import type { Activity } from "@/lib/types";

export const isAssistantEnabled = import.meta.env.VITE_ASSISTANT_ENABLED === "true";

export interface AssistantSuggestion {
  activity: Activity;
  /** Kurze Begründung in ganzen Sätzen. */
  reason: string;
  /** Was unsicher ist (z. B. "Preis unbekannt"). */
  caveats: string[];
}

export interface AssistantReply {
  /** Wie die Anfrage verstanden wurde, in einem Satz. */
  understood: string;
  /** Rückfrage, wenn eine wichtige Angabe fehlt. */
  missing: string | null;
  suggestions: AssistantSuggestion[];
}

export interface AssistantRequest {
  message: string;
  city: string | null;
}

export interface AssistantProvider {
  plan(request: AssistantRequest): Promise<AssistantReply>;
}

export const assistantProvider: AssistantProvider = {
  async plan(request) {
    const { data, error } = await supabase.functions.invoke<AssistantReply>("assistant", { body: request });
    if (error) throw error;
    if (!data || !Array.isArray(data.suggestions)) throw new Error("invalid assistant response");
    return data;
  },
};
