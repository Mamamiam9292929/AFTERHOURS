/**
 * P11 · Formate für das englische Wörterbuch – bewusst ohne Import aus `@/lib`: Ein nachgeladener Chunk, der
 * Module des Start-Chunks importiert, während dieser per Top-Level-Await auf ihn wartet, zwingt den Bundler,
 * den Start-Chunk in viele kleine Teile zu zerlegen. Gleiche Ausgabe wie `src/lib/time.ts`/`format.ts` auf Englisch.
 */
const zone = "Europe/Berlin";
const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateShort = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" });
const euroWhole = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euroCents = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

export const formatTime = (v: Date | string) => time.format(new Date(v));
export const formatDateTime = (v: Date | string) => `${dateShort.format(new Date(v))}, ${formatTime(v)}`;
export const formatEuro = (cents: number) => (cents % 100 === 0 ? euroWhole.format(cents / 100) : euroCents.format(cents / 100));
