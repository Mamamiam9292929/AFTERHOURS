import { IconCheck } from "@/components/icons";
import { cn } from "@/lib/cn";
import { crewWorld } from "@/lib/crewWorld";
import type { Crew } from "@/lib/types";

/**
 * V2 Etappe 3m/3n · Crew-Auswahl in Formularen (Plan anlegen, Abstimmung starten): Crews als Pillen in ihrer
 * eigenen Farbwelt (V2 Etappe 3i) statt einer Auswahlliste; die gewählte trägt eine Lime-Kante und einen Haken.
 */
export function CrewPicker({ crews, value, onChange, label }: { crews: Pick<Crew, "id" | "name" | "emoji">[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {crews.map((crew) => {
        const on = crew.id === value;
        return (
          <button
            key={crew.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(crew.id)}
            className={cn("crew-world flex h-12 max-w-full items-center gap-2.5 rounded-full border py-1 pl-1 pr-4 text-left transition-colors", on ? "border-lime" : "border-white/10 hover:border-white/25")}
            data-world={crewWorld(crew.id)}
          >
            <span aria-hidden className="crew-world-tile grid size-10 shrink-0 place-items-center rounded-full text-[19px]">
              {crew.emoji}
            </span>
            <span className="truncate font-semibold text-fg">{crew.name}</span>
            {on && <IconCheck className="size-4 shrink-0 text-lime" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
