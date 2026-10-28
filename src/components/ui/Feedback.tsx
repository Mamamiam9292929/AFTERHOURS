import type { ReactNode } from "react";
import { IconRefresh, IconSpinner } from "@/components/icons";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { Button } from "./Button";

/**
 * D4 · Bild für leere Zustände im Stil 2.0: drei aufgefächerte Karten in den Farben der App (wie der Kartenstapel
 * beim Abstimmen), vorne Lime mit dem Symbol des Bereichs. Kein Foto, keine Figur – nur Bausteine der App.
 * Stile inline, damit das Start-CSS nicht wächst.
 */
const FAN = [
  { rotate: -14, x: -22, y: 6, color: "var(--color-pink)" },
  { rotate: 9, x: 20, y: 2, color: "var(--color-violet)" },
] as const;

export function EmptyArt({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden data-empty-art="" className="relative mx-auto" style={{ width: 120, height: 92 }}>
      <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--color-lime) 22%, transparent), transparent)", filter: "blur(6px)" }} />
      {FAN.map((card) => (
        <div
          key={card.rotate}
          className="absolute rounded-[16px] border border-white/15"
          style={{
            left: 34 + card.x,
            top: 14 + card.y,
            width: 52,
            height: 66,
            transform: `rotate(${card.rotate}deg)`,
            background: `linear-gradient(160deg, color-mix(in srgb, ${card.color} 55%, transparent), color-mix(in srgb, ${card.color} 18%, transparent))`,
          }}
        />
      ))}
      <div
        className="absolute flex items-center justify-center rounded-[16px] bg-lime text-lime-ink [&>svg]:size-6"
        style={{ left: 34, top: 10, width: 52, height: 66, boxShadow: "0 14px 30px -14px var(--color-lime)" }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Leerer Zustand: sagt, was hier stehen wird, und bietet den nächsten Schritt an. D4: als Glas-Karte; mit `art`
 * (Symbol des Bereichs) steht darüber der aufgefächerte Kartenstapel, Text und Aktion mittig.
 */
export function EmptyState({ icon, art, title, body, action, className }: { icon?: ReactNode; art?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  if (art) {
    return (
      <div data-empty-state="" className={cn("flex flex-col items-center gap-4 rounded-[20px] border border-white/10 bg-white/[0.04] px-5 py-6 text-center", className)}>
        <EmptyArt>{art}</EmptyArt>
        <div className="space-y-1">
          <p className="font-display text-[17px] font-bold text-fg">{title}</p>
          {body && <p className="mx-auto max-w-prose text-sm leading-snug text-muted">{body}</p>}
        </div>
        {action}
      </div>
    );
  }
  return (
    <div data-empty-state="" className={cn("flex flex-col items-start gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-5 py-6", className)}>
      {icon && <div className="text-muted [&>svg]:size-6">{icon}</div>}
      <div className="space-y-1">
        <p className="font-semibold text-fg">{title}</p>
        {body && <p className="max-w-prose text-sm leading-snug text-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}

/** Fehlerzustand für fehlgeschlagene Ladevorgänge – mit erneutem Versuch. */
export function ErrorState({ error, onRetry, title = t.errors.loadFailed, className }: { error?: unknown; onRetry?: () => void; title?: string; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-card border border-danger/35 bg-danger/5 px-5 py-5", className)}>
      <div className="space-y-1">
        <p className="font-semibold text-fg">{title}</p>
        <p className="text-sm leading-snug text-muted">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} icon={<IconRefresh className="size-4" aria-hidden />}>
          {t.actions.retry}
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-control bg-[linear-gradient(100deg,var(--color-surface)_40%,var(--color-raised)_50%,var(--color-surface)_60%)] bg-[length:200%_100%] motion-safe:animate-[shimmer_1.6s_linear_infinite]",
        className,
      )}
    />
  );
}

/** Platzhalter für Listen, solange Daten laden. */
export function ListSkeleton({ rows = 3, height = "h-24" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-3" role="status" aria-label={t.states.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("w-full rounded-card", height)} />
      ))}
    </div>
  );
}

export function PageSpinner({ label = t.states.loading }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-muted">
      <IconSpinner className="size-7 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

type BadgeTone = "neutral" | "lime" | "amber" | "danger" | "outline";

export function Badge({ tone = "neutral", icon, children, className }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-raised text-muted",
        tone === "lime" && "bg-lime text-lime-ink",
        tone === "amber" && "bg-amber/15 text-amber",
        tone === "danger" && "bg-danger/15 text-danger",
        tone === "outline" && "border border-line-strong text-muted",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Kennzeichnung für Beispieldaten. Erscheint überall, wo Demo-Inhalte stehen. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge tone="outline" className={cn("border-amber/50 text-amber", className)}>
      {t.states.demo}
    </Badge>
  );
}

/** Hinweisfläche für ehrliche Statusmeldungen ("noch nicht verfügbar", "Demo-Modus"). */
export function Notice({ tone = "info", icon, title, children, className }: { tone?: "info" | "amber" | "lime"; icon?: ReactNode; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-card border px-4 py-3.5 text-sm leading-snug",
        tone === "info" && "border-line bg-surface text-muted",
        tone === "amber" && "border-amber/35 bg-amber/5 text-muted",
        tone === "lime" && "border-lime/35 bg-lime/5 text-muted",
        className,
      )}
    >
      {icon && <div className={cn("mt-0.5 shrink-0 [&>svg]:size-[18px]", tone === "amber" && "text-amber", tone === "lime" && "text-lime")}>{icon}</div>}
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
