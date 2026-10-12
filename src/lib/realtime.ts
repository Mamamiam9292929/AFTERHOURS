import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

let subscriptionCounter = 0;

interface TableSubscription {
  table: string;
  /** PostgREST-Filter, z. B. "poll_id=eq.<uuid>" */
  filter?: string;
}

/**
 * Ruft onChange auf, sobald sich eine der Tabellen ändert (Supabase Realtime, postgres_changes).
 * Realtime liefert nur Zeilen, die die angemeldete Person laut RLS lesen darf.
 *
 * Ist Realtime nicht erreichbar, passiert nichts – die Abfragen haben zusätzlich ein
 * Nachlade-Intervall, sodass die Oberfläche auch dann aktuell bleibt (nur etwas verzögert).
 */
export function useRealtime(channelName: string | null, tables: TableSubscription[], onChange: () => void): void {
  const callback = useRef(onChange);
  callback.current = onChange;
  const signature = JSON.stringify(tables);

  useEffect(() => {
    if (!channelName) return;
    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback.current(), 120);
    };
    // Eindeutiger Topic je Abonnement: Mehrere Komponenten dürfen dieselbe Tabelle beobachten, ohne sich
    // einen (bereits abonnierten) Kanal zu teilen – das würde supabase-js mit einer Exception quittieren.
    let channel = supabase.channel(`${channelName}:${++subscriptionCounter}`);
    for (const { table, filter } of JSON.parse(signature) as TableSubscription[]) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, fire);
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [channelName, signature]);
}
