import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { IconCircleCheck, IconAlert } from "@/components/icons";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";

interface ToastItem {
  id: number;
  tone: "success" | "error";
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Kurze Rückmeldungen nach Aktionen. Screenreader erhalten sie über eine Live-Region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: ToastItem["tone"], message: string) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-2), { id, tone, message }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (error) => push("error", typeof error === "string" ? error : errorMessage(error)),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-2.5 rounded-control border px-4 py-3 text-sm font-medium shadow-xl shadow-black/50 motion-safe:animate-[sheet-in_200ms_var(--ease-out-soft)]",
              item.tone === "success" ? "border-lime/50 bg-nav text-fg" : "border-danger/60 bg-nav text-fg",
            )}
          >
            {item.tone === "success" ? <IconCircleCheck className="mt-px size-[18px] shrink-0 text-lime" aria-hidden /> : <IconAlert className="mt-px size-[18px] shrink-0 text-danger" aria-hidden />}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
