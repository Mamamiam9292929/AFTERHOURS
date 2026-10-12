import { t } from "@/i18n";

/** Kleine, abhängigkeitsfreie Formularprüfung. Die verbindliche Prüfung passiert in der Datenbank. */
export type Validator = (value: string) => string | null;

export const required = (message: string = t.validation.required): Validator => (value) =>
  value.trim() === "" ? message : null;

export const minLength = (min: number, message?: string): Validator => (value) =>
  value.trim().length < min ? (message ?? t.validation.minLength(min)) : null;

export const maxLength = (max: number): Validator => (value) =>
  value.trim().length > max ? t.validation.maxLength(max) : null;

export const email: Validator = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) ? null : t.validation.email;

export const password: Validator = (value) => (value.length < 8 ? t.validation.password : null);

export function validate(value: string, ...validators: Validator[]): string | null {
  for (const validator of validators) {
    const result = validator(value);
    if (result) return result;
  }
  return null;
}

/** Nur relative Pfade innerhalb der App sind als Weiterleitungsziel erlaubt (kein Open Redirect). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.includes("://")) return null;
  return next;
}
