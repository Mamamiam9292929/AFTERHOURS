import { safeNextPath } from "@/lib/validation";

const KEY = "afterhours.next";
let suppressedUntil = 0;

/**
 * Merkt sich, wohin jemand eigentlich wollte (z. B. einen Einladungslink), solange Anmeldung,
 * Registrierung und E-Mail-Bestätigung dazwischenliegen – auch über einen neuen Tab hinweg.
 */
export function rememberNext(path: string): void {
  const safe = safeNextPath(path);
  if (!safe || Date.now() < suppressedUntil) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path: safe, at: Date.now() }));
  } catch {
    /* Speicher nicht verfügbar – dann geht es eben zu Home. */
  }
}

export function consumeNext(): string | null {
  const next = peekNext();
  clearNext();
  return next;
}

/** Liest das gemerkte Ziel, ohne es zu verbrauchen (frei von Seiteneffekten – darf beim Rendern laufen). */
export function peekNext(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: string; at?: number };
    if (!parsed.at || Date.now() - parsed.at > 24 * 60 * 60 * 1000) return null;
    return safeNextPath(parsed.path);
  } catch {
    return null;
  }
}

export function clearNext(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nichts zu löschen */
  }
}

/**
 * Beim ausdrücklichen Abmelden: gemerktes Ziel verwerfen. Die nächste Anmeldung – womöglich einer
 * anderen Person am selben Gerät – beginnt auf Home statt auf der zuletzt geöffneten Seite.
 */
export function forgetNext(): void {
  suppressedUntil = Date.now() + 3000;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nichts zu verwerfen */
  }
}
