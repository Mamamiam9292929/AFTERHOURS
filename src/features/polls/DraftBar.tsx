import { Link, useLocation } from "react-router-dom";
import { IconClose, IconVote } from "@/components/icons";
import { t } from "@/i18n";
import { usePollDraft } from "./draft";

/** Schwebende Leiste, sobald in Discover Orte für eine Abstimmung gesammelt wurden. */
export function DraftBar() {
  const draft = usePollDraft();
  const { pathname } = useLocation();
  if (draft.items.length === 0 || pathname.startsWith("/polls/new")) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 lg:bottom-6 lg:pl-64">
      <div role="region" aria-label={t.discover.draft.count(draft.items.length)} className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-lime/60 bg-nav py-2 pl-4 pr-2 shadow-2xl shadow-black/60 motion-safe:animate-[sheet-in_220ms_var(--ease-out-soft)]">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-tight text-fg">{t.discover.draft.count(draft.items.length)}</p>
        <Link to="/polls/new" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-control bg-lime px-4 text-sm font-semibold text-lime-ink hover:bg-lime-press">
          <IconVote className="size-4" aria-hidden />
          {t.discover.draft.start}
        </Link>
        <button type="button" onClick={draft.clear} aria-label={t.discover.draft.clear} title={t.discover.draft.clear} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg">
          <IconClose className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
