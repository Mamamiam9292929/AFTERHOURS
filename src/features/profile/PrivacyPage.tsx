import { IconEye, IconGlobe, IconInfo, IconLock, IconPin, IconShield } from "@/components/icons";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { PanelCard } from "@/components/ui/PanelCard";
import { GLASS_PILL } from "@/components/ui/Pill";
import { useAuth } from "@/features/auth/AuthProvider";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/hooks";

/**
 * V2 Etappe 3o · Je Abschnitt der Datenschutz-Seite: Sprungziel, Symbol und Farbschein (nur als Licht, nie als
 * Textfarbe) – in der Reihenfolge von `t.privacy.sections`. Fehlt ein Eintrag, greift der letzte.
 */
const SECTION_LOOK = [
  { id: "stored", icon: IconLock, tone: "violet" },
  { id: "visibility", icon: IconEye, tone: "pink" },
  { id: "location", icon: IconPin, tone: "lime" },
  { id: "rights", icon: IconShield, tone: "violet" },
  { id: "third-parties", icon: IconGlobe, tone: "pink" },
] as const;

const look = (index: number) => SECTION_LOOK[Math.min(index, SECTION_LOOK.length - 1)]!;

/**
 * Kopf als Karte oben auf dem Stapel: Kennzeile, Titel in Chrom, die Kurzfassung als Lime-Pillen (alles davon
 * steht auch unten im Text) und der Hinweis, dass dies keine geprüfte Datenschutzerklärung ist – bewusst in
 * der Karte, damit er nicht überlesen wird.
 */
function Hero() {
  return (
    <section aria-labelledby="privacy-title" className="ticket-feature-wrap" data-testid="privacy-hero">
      <div className="vote-card overflow-hidden rounded-[32px] p-5 sm:p-7">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-lime/10 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-violet/25 blur-3xl" />
        <div className="relative">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">{t.privacy.label}</p>
          <h1 id="privacy-title" className="display chrome mt-3 break-words text-[27px] uppercase sm:text-[37px]">
            {t.privacy.title}
          </h1>
          <ul className="mt-4 flex flex-wrap gap-2" data-testid="privacy-facts">
            {t.privacy.facts.map((fact) => (
              <li key={fact} className="inline-flex h-9 items-center gap-2 rounded-full bg-lime px-3.5 text-[13px] font-bold text-lime-ink">
                <span aria-hidden className="size-2 rounded-full bg-lime-ink" />
                {fact}
              </li>
            ))}
          </ul>
          <p className="mt-5 flex gap-3 rounded-[20px] border border-amber/40 bg-amber/[0.07] p-4 text-sm leading-snug text-muted" data-testid="privacy-disclaimer">
            <IconInfo className="mt-0.5 size-[18px] shrink-0 text-amber" aria-hidden />
            <span>{t.privacy.disclaimer}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/** Sprung-Pillen wie in den Einstellungen: auf dem Handy ist die Seite lang. */
function SectionNav() {
  return (
    <nav aria-label={t.privacy.jumpLabel} className="-mx-5 mt-6 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {t.privacy.sections.map((section, index) => (
          <li key={section.title}>
            <a href={`#privacy-${look(index).id}`} className={cn(GLASS_PILL, "h-11 whitespace-nowrap hover:border-lime/60 hover:text-fg")}>
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Abschnitte als Glas-Karten aus dem Deck – wie die Bereiche der Einstellungen. */
function Sections() {
  return (
    <div className="mt-6 space-y-4">
      {t.privacy.sections.map((section, index) => {
        const { id, icon: Icon, tone } = look(index);
        return (
          <PanelCard key={section.title} id={`privacy-${id}`} title={section.title} icon={<Icon />} tone={tone} className="scroll-mt-6">
            <ul className="space-y-2">
              {section.items.map((item) => (
                <li key={item} className="flex gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3 text-[15px] leading-snug text-fg">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-lime" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </PanelCard>
        );
      })}
    </div>
  );
}

/** Eigenständige Seite: ohne Anmeldung erreichbar (Link von der Registrierung) und aus dem Profil heraus. */
export function PrivacyPage() {
  useDocumentTitle(t.privacy.title);
  const { user } = useAuth();
  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      <div className="aurora" aria-hidden />
      <div className="mx-auto w-full max-w-2xl px-5 pb-16 pt-safe sm:px-8">
        <div className="py-6">
          <Logo compact />
        </div>
        <Hero />
        <SectionNav />
        <Sections />
        <ButtonLink to={user ? "/settings#account" : "/login"} variant="secondary" className="mt-8">
          {user ? t.privacy.toSettings : t.privacy.toLogin}
        </ButtonLink>
      </div>
    </div>
  );
}
