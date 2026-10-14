import { useMemo } from "react";
import { Link } from "react-router-dom";
import { IconCalendarPlus, IconCar, IconDiscover, IconForward, IconPhoneApp, IconPlans, IconShare, IconShield } from "@/components/icons";
import { AvatarStack, type Person } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Feedback";
import { Logo } from "@/components/ui/Logo";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/hooks";
import { formatTime, nextWeekday, ticketDate, zonedToUtc } from "@/lib/time";

const copy = t.landing;

/** Erfundene Namen für die Beispiele – nur Initialen auf Avataren, jedes Beispiel ist als solches markiert. */
const SAMPLE_PEOPLE: Person[] = copy.sample.people.map((name, index) => ({ id: `sample-${index}-${name}`, display_name: name, avatar_url: null }));

const FEATURE_ICONS: Record<(typeof copy.features.items)[number]["key"], typeof IconDiscover> = {
  places: IconDiscover,
  answer: IconPlans,
  share: IconShare,
  calendar: IconCalendarPlus,
  rides: IconCar,
  app: IconPhoneApp,
};

const linkClass = "font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";

/**
 * W6 · Öffentliche Startseite: Wer die Adresse ohne Konto öffnet, sieht, was AFTERHOURS kann, statt vor
 * einer Anmeldemaske zu stehen. Die Bilder sind echte Bausteine der App (Ticket, Stimmbalken) mit
 * Beispielinhalt – sichtbar als „Beispiel“ markiert. Keine Nutzerzahlen, Bewertungen oder Preise.
 * Angemeldete leitet der Router vorher zu /home weiter.
 */
export function LandingPage() {
  useDocumentTitle(copy.pageTitle);
  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      <div aria-hidden className="home-glow" />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 pt-safe sm:px-8">
        <Link to="/" className="mt-5 rounded-control" aria-label="AFTERHOURS">
          <Logo compact />
        </Link>
        <nav className="mt-5 flex items-center gap-2">
          <ButtonLink to="/login" variant="ghost" size="sm">
            {copy.nav.login}
          </ButtonLink>
          <ButtonLink to="/register" size="sm" className="hidden sm:inline-flex">
            {copy.nav.start}
          </ButtonLink>
        </nav>
      </header>

      <main>
        <Hero />
        <Steps />
        <Features />
        <FinalCall />
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-8 text-sm text-muted sm:px-8">
        <span className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <Logo compact />
          <span className="font-display text-lg font-bold tracking-wide text-faint">{t.claim}</span>
        </span>
        <span className="flex gap-5">
          <Link to="/privacy" className={linkClass}>
            {copy.footer.privacy}
          </Link>
          <Link to="/login" className={linkClass}>
            {copy.footer.login}
          </Link>
        </span>
      </footer>
      <div className="pb-safe" />
    </div>
  );
}

function Hero() {
  return (
    <section aria-labelledby="landing-title" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16 lg:pb-24 lg:pt-20">
      <div className="min-w-0">
        <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-lime">{copy.hero.eyebrow}</p>
        <h1 id="landing-title" className="display mt-4 text-[46px] uppercase text-fg sm:text-[76px] lg:text-[78px]">
          {copy.hero.title.map((line) => (
            <span key={line} className="block">
              {line}{" "}
            </span>
          ))}
          <span className="block text-lime">{copy.hero.titleAccent}</span>
        </h1>
        <p className="mt-6 max-w-xl text-[17px] leading-snug text-muted sm:text-lg">{copy.hero.body}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink to="/register" size="lg" icon={<IconForward className="order-last size-5" aria-hidden />}>
            {copy.hero.cta}
          </ButtonLink>
          <ButtonLink to="/login" size="lg" variant="secondary">
            {copy.hero.login}
          </ButtonLink>
        </div>
        <p className="mt-4 text-[14px] leading-snug text-faint">{copy.hero.note}</p>
      </div>
      <SampleTicket />
    </section>
  );
}

/** Beispiel-Plan im Stil des großen Tickets auf Home – Datum ist immer der kommende Samstag. */
function SampleTicket() {
  const startsAt = useMemo(() => zonedToUtc(nextWeekday("sat"), "20:00") ?? new Date(), []);
  const date = ticketDate(startsAt);
  const going = SAMPLE_PEOPLE.slice(0, 4);
  return (
    <figure aria-label={copy.sample.ticketLabel} className="mx-auto w-full max-w-[460px] lg:mx-0 lg:justify-self-end">
      <SampleBadge />
      <div className="ticket-feature-wrap mt-4" data-answer="going">
        <div className="ticket ticket-feature">
          <div className="ticket-stub flex flex-col items-center justify-center gap-1 bg-lime px-2 py-5 text-center text-lime-ink">
            <span className="text-[15px] font-bold uppercase tracking-wide">{date.weekday}</span>
            <span className="font-display text-[76px] font-extrabold leading-[0.85] sm:text-[92px]">{date.day}</span>
            <span className="text-[15px] font-bold uppercase tracking-wide">{date.month}</span>
            <span className="ticket-stamp is-new" aria-hidden>
              {copy.sample.ticketStamp}
            </span>
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-4 p-5 sm:p-6">
            <div className="min-w-0">
              <Badge tone="lime">{t.enums.planStatus.confirmed}</Badge>
              <p className="display mt-3 break-words text-[36px] uppercase text-fg sm:text-[44px]">{copy.sample.ticketTitle}</p>
              <p className="mt-2.5 text-[15px] text-muted">
                <span className="font-semibold text-fg">{formatTime(startsAt)}</span> · {copy.sample.ticketPlace}
              </p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <AvatarStack people={going} max={4} size="md" />
              <span className="ml-auto text-[15px] font-semibold text-muted">
                <span className="sr-only">{copy.sample.goingOf(going.length, SAMPLE_PEOPLE.length)}</span>
                <span aria-hidden className="flex items-baseline gap-1.5">
                  <span className="font-display text-[34px] font-extrabold leading-none text-fg">{going.length}</span>
                  {t.plans.ticket.goingOf(SAMPLE_PEOPLE.length)}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

function SampleBadge({ className }: { className?: string }) {
  return (
    <Badge tone="outline" className={cn("border-amber/50 text-amber", className)}>
      {copy.sample.label}
    </Badge>
  );
}

function SectionTitle({ id, text, accent }: { id: string; text: string; accent: string }) {
  return (
    <h2 id={id} className="display text-[40px] uppercase text-fg sm:text-[56px]">
      {text} <span className="text-lime">{accent}</span>
    </h2>
  );
}

function Steps() {
  return (
    <section aria-labelledby="landing-steps" className="border-y border-line bg-nav/60">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <div className="min-w-0">
          <SectionTitle id="landing-steps" text={copy.steps.title} accent={copy.steps.titleAccent} />
          <ol className="mt-10 space-y-8">
            {copy.steps.items.map((item, index) => (
              <li key={item.title} className="flex gap-5">
                <span aria-hidden className="display w-12 shrink-0 text-[44px] leading-none text-lime tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 border-t border-dashed border-line-strong pt-3">
                  <h3 className="text-[19px] font-bold text-fg">{item.title}</h3>
                  <p className="mt-1.5 leading-snug text-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <SamplePoll />
      </div>
    </section>
  );
}

/** Beispiel-Abstimmung im Stil der Abstimmungsseite: Stand als Lime-Balken, führende Option mit „Vorn“. */
function SamplePoll() {
  const total = SAMPLE_PEOPLE.length - 1;
  return (
    <figure aria-label={copy.sample.pollLabel} className="min-w-0 self-center">
      <SampleBadge />
      <div className="stage-card mt-4 rounded-card border border-line bg-surface p-5 sm:p-6">
        <p className="display text-[34px] uppercase text-fg sm:text-[40px]">
          {copy.sample.pollQuestion} <span className="text-lime">{copy.sample.pollQuestionAccent}</span>
        </p>
        <p className="mt-2 text-sm text-muted">{copy.sample.pollMeta}</p>
        <ul className="mt-5 space-y-3">
          {copy.sample.options.map((option, index) => (
            <li
              key={option.title}
              className={cn("poll-option relative overflow-hidden rounded-card border p-4", index === 0 ? "poll-option-leading border-lime/45" : "border-line bg-surface")}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="display min-w-0 text-[24px] uppercase text-fg">{option.title}</p>
                {index === 0 && (
                  <Badge tone="lime" className="text-[13px]">
                    {copy.sample.leading}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">{option.meta}</p>
              <div className={cn("relative mt-3 flex min-h-12 items-center gap-3 overflow-hidden rounded-control border bg-raised/70 py-2 pl-3 pr-4", index === 0 ? "border-lime" : "border-transparent")}>
                <div aria-hidden className="poll-bar-fill absolute inset-y-0 left-0" style={{ width: `${(option.yes / total) * 100}%` }} />
                <span className="relative flex min-w-0 flex-1 items-center gap-3">
                  <AvatarStack people={SAMPLE_PEOPLE.slice(index, index + option.yes)} max={4} ringColor="var(--color-raised)" />
                  <span className="text-sm font-semibold text-fg">{copy.sample.yes(option.yes)}</span>
                </span>
                <span aria-hidden className="display relative text-[26px] leading-none text-fg tabular-nums">
                  {option.yes}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

function Features() {
  return (
    <section aria-labelledby="landing-features" className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
      <SectionTitle id="landing-features" text={copy.features.title} accent={copy.features.titleAccent} />
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {copy.features.items.map((item) => {
          const Icon = FEATURE_ICONS[item.key];
          return (
            <li key={item.key} className="stage-card rounded-card border border-line bg-surface p-5">
              <span className="flex size-11 items-center justify-center rounded-control bg-lime/12 text-lime">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-[17px] font-bold text-fg">{item.title}</h3>
              <p className="mt-1.5 text-[15px] leading-snug text-muted">{item.body}</p>
            </li>
          );
        })}
      </ul>
      <PrivacyNote />
    </section>
  );
}

function PrivacyNote() {
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-card border border-line bg-nav/60 p-5 sm:flex-row sm:items-start sm:p-6">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-lime/12 text-lime">
        <IconShield className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="text-[17px] font-bold text-fg">{copy.privacy.title}</h3>
        <p className="mt-1.5 max-w-3xl text-[15px] leading-snug text-muted">{copy.privacy.body}</p>
        <Link to="/privacy" className={cn(linkClass, "mt-3 inline-block text-[15px]")}>
          {copy.privacy.link}
        </Link>
      </div>
    </div>
  );
}

/** Schluss als Eintrittskarte: Frage rechts, die Antwort „Du.“ im Abriss. */
function FinalCall() {
  return (
    <section aria-labelledby="landing-final" className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8 lg:pb-28">
      <div className="ticket-feature-wrap [transform:none]" data-answer="going">
        <div className="ticket ticket-feature">
          <div className="ticket-stub flex flex-col items-center justify-center gap-2 bg-lime px-2 py-6 text-center text-lime-ink">
            <span className="text-[13px] font-bold uppercase tracking-wide">{copy.final.stub}</span>
            <span className="font-display text-[56px] font-extrabold uppercase leading-[0.85] sm:text-[72px]">{copy.final.answer}</span>
            <span className="ticket-barcode mt-1" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col items-start p-5 sm:p-8">
            <h2 id="landing-final" className="display text-[34px] uppercase text-fg sm:text-[48px]">
              {copy.final.question}
            </h2>
            <p className="mt-3 max-w-xl leading-snug text-muted">{copy.final.body}</p>
            <ButtonLink to="/register" size="lg" className="mt-6" icon={<IconForward className="order-last size-5" aria-hidden />}>
              {copy.final.cta}
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
