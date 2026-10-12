import { useEffect, useState } from "react";

/** Aktuelle Zeit, die sich im angegebenen Takt aktualisiert – für Fristen und "in 5 Minuten". */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Wert, der erst nach `delayMs` Ruhe übernommen wird – z. B. Suchtext vor der Serverabfrage. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} – AFTERHOURS` : "AFTERHOURS";
  }, [title]);
}

/** Kopiert Text und meldet, ob es geklappt hat (die Zwischenablage kann gesperrt sein). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
