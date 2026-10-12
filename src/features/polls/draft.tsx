import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** Vorgemerkte Option für eine neue Abstimmung (aus Discover gesammelt). */
export interface DraftItem {
  activityId: string;
  title: string;
  priceCents: number | null;
}

interface PollDraft {
  items: DraftItem[];
  has: (activityId: string) => boolean;
  /** false, wenn die Auswahl voll ist. */
  add: (item: DraftItem) => boolean;
  remove: (activityId: string) => void;
  clear: () => void;
}

const KEY = "afterhours.poll-draft";
export const MAX_POLL_OPTIONS = 10;
const DraftContext = createContext<PollDraft | null>(null);

function load(): DraftItem[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as DraftItem[];
    return Array.isArray(parsed) ? parsed.filter((i) => typeof i?.activityId === "string" && typeof i?.title === "string").slice(0, MAX_POLL_OPTIONS) : [];
  } catch {
    return [];
  }
}

/** Sammelkorb: Orte in Discover antippen, dann in einem Schritt zur Abstimmung machen. */
export function PollDraftProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<DraftItem[]>(load);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* ohne Speicher lebt die Auswahl nur bis zum Neuladen */
    }
  }, [items]);

  const has = useCallback((activityId: string) => items.some((i) => i.activityId === activityId), [items]);
  const add = useCallback(
    (item: DraftItem) => {
      if (items.some((i) => i.activityId === item.activityId)) return true;
      if (items.length >= MAX_POLL_OPTIONS) return false;
      setItems((current) => [...current, item]);
      return true;
    },
    [items],
  );
  const remove = useCallback((activityId: string) => setItems((current) => current.filter((i) => i.activityId !== activityId)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({ items, has, add, remove, clear }), [items, has, add, remove, clear]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function usePollDraft(): PollDraft {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("usePollDraft must be used within PollDraftProvider");
  return ctx;
}
