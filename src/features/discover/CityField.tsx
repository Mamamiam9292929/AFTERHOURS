import { useEffect, useId, useState } from "react";
import { IconPin } from "@/components/icons";
import { CITY_NAMES } from "@/data/cities";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

/**
 * Freie Stadteingabe mit Vorschlägen. Übernommen wird bei Auswahl eines Vorschlags, Enter oder
 * Verlassen des Feldes – nicht bei jedem Tastendruck, weil jede neue Stadt einen Import auslösen kann.
 */
export function CityField({ value, onCommit, className }: { value: string | null; onCommit: (city: string) => void; className?: string }) {
  const [text, setText] = useState(value ?? "");
  const listId = useId();
  useEffect(() => setText(value ?? ""), [value]);

  function commit(raw: string) {
    const city = raw.replace(/\s+/g, " ").trim();
    if (city.length >= 2 && city.toLocaleLowerCase("de") !== (value ?? "").toLocaleLowerCase("de")) onCommit(city);
    else if (city.length < 2) setText(value ?? "");
  }

  return (
    <div className={cn("relative", className)}>
      <IconPin className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
      <input
        type="text"
        list={listId}
        value={text}
        aria-label={t.discover.city}
        placeholder={t.discover.cityPlaceholder}
        autoComplete="address-level2"
        maxLength={80}
        onChange={(e) => {
          setText(e.target.value);
          if (CITY_NAMES.includes(e.target.value)) commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
          }
        }}
        onBlur={() => commit(text)}
        className="h-12 w-full rounded-full border border-white/12 bg-white/[0.06] pl-11 pr-3 text-fg placeholder:text-faint hover:border-white/25 focus:border-lime focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden"
      />
      <datalist id={listId}>
        {CITY_NAMES.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>
    </div>
  );
}
