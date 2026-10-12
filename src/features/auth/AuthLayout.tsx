import type { ReactNode } from "react";
import { IconCheck } from "@/components/icons";
import { Logo } from "@/components/ui/Logo";
import { t } from "@/i18n";

/**
 * Rahmen für Anmeldung und Registrierung. Ab Desktop steht links die Marke mit dem Ticket-Motiv,
 * rechts das Formular; auf dem Smartphone nur Logo und Formular.
 */
export function AuthLayout({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-nav lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-lime/10 blur-3xl" />
        <Logo />
        <div className="relative space-y-8">
          <h2 className="display text-[52px] text-fg xl:text-[68px]">
            {t.auth.brand.headline.map((line) => (
              <span key={line} className="block whitespace-nowrap">
                {line}
              </span>
            ))}
          </h2>
          <p className="max-w-sm text-lg leading-snug text-muted">{t.auth.brand.body}</p>
          <ul className="space-y-2.5">
            {t.auth.brand.points.map((point) => (
              <li key={point} className="flex items-center gap-3 text-fg">
                <span className="flex size-6 items-center justify-center rounded-full bg-lime text-lime-ink">
                  <IconCheck className="size-3.5" strokeWidth={3} aria-hidden />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="font-display text-xl font-bold tracking-wide text-faint">{t.claim}</p>
      </aside>

      <main className="flex flex-col px-5 pb-10 pt-safe sm:px-8">
        <div className="pt-6 lg:hidden">
          <Logo compact />
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          <h1 className="display text-[44px] text-fg sm:text-[52px]">{title}</h1>
          {intro && <div className="mt-3 text-[15px] leading-snug text-muted">{intro}</div>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
