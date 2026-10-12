import { t } from "@/i18n";
import { formatEuro } from "@/lib/format";
import { openStateAt } from "@/lib/hours";
import type { Activity } from "@/lib/types";

/** Preisangabe eines Ortes – oder ehrlich "unbekannt". */
export function priceLabel(activity: Pick<Activity, "price_min_cents" | "price_max_cents">): string {
  const { price_min_cents: min, price_max_cents: max } = activity;
  if (min == null && max == null) return t.discover.price.unknown;
  if ((min ?? 0) === 0 && (max ?? 0) === 0) return t.discover.price.free;
  if (min != null && max != null) {
    if (min === max) return formatEuro(min);
    if (min === 0) return t.discover.price.upTo(formatEuro(max));
    return `${formatEuro(min).replace(/\s?€/, "")}–${formatEuro(max)}`;
  }
  if (min != null) return t.discover.price.from(formatEuro(min));
  return t.discover.price.upTo(formatEuro(max ?? 0));
}

export function openLabel(activity: Pick<Activity, "opening_hours" | "opening_hours_raw">, now: Date = new Date()): { text: string; tone: "open" | "closed" | "unknown" } {
  const state = openStateAt(activity.opening_hours, now);
  if (state.state === "unknown") return { text: activity.opening_hours_raw ? t.discover.open.rawOnly : t.discover.open.unknown, tone: "unknown" };
  if (state.state === "open") return { text: t.discover.open.openUntil(state.closesAt), tone: "open" };
  if (!state.opensAt) return { text: t.discover.open.closed, tone: "closed" };
  if (!state.opensDay) return { text: t.discover.open.closedOpensAt(state.opensAt), tone: "closed" };
  return { text: t.discover.open.closedOpensDay(t.weekdays[state.opensDay], state.opensAt), tone: "closed" };
}
