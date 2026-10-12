import { APP_LOCALE } from "./time";

const euroWhole = new Intl.NumberFormat(APP_LOCALE, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euroCents = new Intl.NumberFormat(APP_LOCALE, { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const numberFormat = new Intl.NumberFormat(APP_LOCALE);

/** 1800 -> "18 €", 1850 -> "18,50 €" */
export function formatEuro(cents: number): string {
  return cents % 100 === 0 ? euroWhole.format(cents / 100) : euroCents.format(cents / 100);
}

export const formatNumber = (value: number) => numberFormat.format(value);

/** "Euro-Betrag" aus einem Formularfeld ("18", "18,50", "18.5") in Cent; leer -> null, ungültig -> undefined. */
export function parseEuroInput(raw: string): number | null | undefined {
  const value = raw.trim().replace(/\s|€/g, "").replace(",", ".");
  if (value === "") return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return undefined;
  return Math.round(Number(value) * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(100, Math.round(km * 10) * 100)} m`;
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km)} km`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? "1 Std." : `${hours} Std.`;
  return `${hours} Std. ${rest} Min.`;
}

/** Initialen für Avatare ohne Bild. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
