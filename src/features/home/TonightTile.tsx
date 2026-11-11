import type { ReactNode } from "react";

/** Eine Kachel der „Heute Abend“-Leiste auf Home (D3 Etappe 2a): rundes Symbol, kleine Überschrift, Inhalt. */
export function Tile({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-fg [&>svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}
