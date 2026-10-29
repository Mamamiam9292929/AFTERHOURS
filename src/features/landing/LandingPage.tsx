import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  IconCalendarCheck,
  IconCheck,
  IconClose,
  IconDiscover,
  IconForward,
  IconHelp,
  IconLink,
  IconPhoneApp,
  IconRepeat,
  IconShield,
  IconSparkles,
  IconWallet,
  IconWeatherPartly,
} from "@/components/icons";
import { AvatarStack, type Person } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Feedback";
import { Logo } from "@/components/ui/Logo";
import { LanguageLink } from "@/components/ui/LanguageSwitch";
import { locale, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/hooks";
import { parseQuickPoll } from "@/lib/quickpoll";
import { formatTime, nextWeekday, ticketDate, zonedToUtc } from "@/lib/time";

const copy = t.landing;

/** Erfundene Namen für die Beispiele – nur Initialen auf Avataren, jedes Beispiel ist als solches markiert. */
const SAMPLE_PEOPLE: Person[] = copy.sample.people.map((name, index) => ({ id: `sample-${index}-${name}`, display_name: name, avatar_url: null }));

const FEATURE_ICONS: Record<(typeof copy.features.items)[number]["key"], typeof IconDiscover> = {
  guests: IconLink,
  auto: IconSparkles,
  places: IconDiscover,
  weather: IconWeatherPartly,
  repeat: IconRepeat,
  money: IconWallet,
  calendar: IconCalendarCheck,
  app: IconPhoneApp,
};

/** Dieselben Kartenflächen wie der Wisch-Stapel der Abstimmung (S6). */
const DECK = ["linear-gradient(155deg,#5b3fe0,#b81f68)", "linear-gradient(155deg,#1d4fd6,#0b7d6c)", "linear-gradient(155deg,#b81f68,#b5470a)"];

const linkClass = "font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";
const glassCard = "rounded-[28px] border border-white/10 bg-white/[0.04] backdrop-blur-md";

/**
 * W6 · Öffentliche Startseite, seit V2 im Stil „Aurora × Y2K × Deck“: Aurora im Hintergrund, Chrom-Plakat,
 * Glas-Karten, Kartenstapel. Wer die Adresse ohne Konto öffnet, sieht, was AFTERHOURS kann – mit einer
 * echten Probe des Satz-Zerlegers (S1, läuft nur im Browser) und Beispielen aus echten Bausteinen der App,
 * sichtbar als „Beispiel“ markiert. Keine Nutzerzahlen, Bewertungen oder Preise.
 * Angemeldete leitet der Router vorher zu /home weiter.
 */
export function LandingPage() {
  useDocumentTitle(copy.pageTitle);
  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      <div className="aurora" aria-hidden />
      <header className="glass sticky top-0 z-30 border-b border-white/[0.06] pt-safe">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link to="/" className="rounded-control" aria-label="AFTERHOURS">
            <Logo compact />
          </Link>
          <nav className="flex items-center gap-2">
            <ButtonLink to="/login" variant="ghost" size="sm">
              {copy.nav.login}
            </ButtonLink>
            <ButtonLink to="/register" size="sm" className="hidden sm:inline-flex">
              {copy.nav.start}
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main>
        <Hero />
        <Steps />
        <Answers />
        <Features />
        <FinalCall />
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-white/10 px-5 py-8 text-sm text-muted sm:px-8">
        <span className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <Logo compact />
          <span className="font-display text-base font-bold text-faint">{t.claim}</span>
        </span>
        <span className="flex gap-5">
          <Link to="/privacy" className={linkClass}>
            {copy.footer.privacy}
          </Link>
          <Link to="/login" className={linkClass}>
            {copy.footer.login}
          </Link>
          <LanguageLink className={linkClass} />
        </span>
      </footer>
      <div className="pb-safe" />
    </div>
  );
}

function SampleBadge({ className, children = copy.sample.label }: { className?: string; children?: string }) {
  return (
    <Badge tone="outline" className={cn("border-amber/50 text-amber", className)}>
      {children}
    </Badge>
  );
}

function Hero() {
  return (
    <section aria-labelledby="landing-title" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-10 sm:px-8 sm:pt-16 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-14 lg:pb-24 lg:pt-20">
      <div className="min-w-0">
        <p className="inline-flex rounded-full border border-lime/40 bg-lime/10 px-3.5 py-1.5 text-[13px] font-bold text-lime">{copy.hero.eyebrow}</p>
        <h1 id="landing-title" className="display chrome mt-5 text-[30px] uppercase [hyphens:manual] min-[400px]:text-[34px] sm:text-[50px] lg:text-[54px]">
          {copy.hero.title.map((line) => (
            <span key={line} className="block">
              {line}{" "}
            </span>
          ))}
          <span className="block text-lime">{copy.hero.titleAccent}</span>
        </h1>
        <p className="mt-6 max-w-xl text-[17px] leading-snug text-muted sm:text-lg">{copy.hero.body}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink
            to="/register"
            size="lg"
            className="h-15 px-8 font-display text-[16px] font-black uppercase shadow-[0_18px_40px_-14px_var(--color-lime)]"
            icon={<IconForward className="order-last size-5" aria-hidden />}
          >
            {copy.hero.cta}
          </ButtonLink>
          <ButtonLink to="/login" size="lg" variant="secondary" className="h-15">
            {copy.hero.login}
          </ButtonLink>
        </div>
        <p className="mt-4 text-[14px] leading-snug text-faint">{copy.hero.note}</p>
      </div>
      <SentenceDemo />
    </section>
  );
}

/**
 * Probe von S1: dasselbe `parseQuickPoll` wie im Sheet „Ein Satz reicht.“, nur ohne Abschicken.
 * Nichts verlässt den Browser; der Knopf führt zur Registrierung.
 */
function SentenceDemo() {
  const [text, setText] = useState<string>(copy.demo.initial);
  const inputId = useId();
  const parsed = useMemo(() => parseQuickPoll(text, new Date(), locale), [text]);
  return (
    <figure aria-label={copy.demo.label} className="mx-auto w-full max-w-[480px] lg:mx-0 lg:justify-self-end">
      <div className="flex flex-wrap items-center gap-2">
        <SampleBadge />
        <span className="text-[13px] text-faint">{copy.demo.badge}</span>
      </div>
      <div className={cn(glassCard, "mt-4 p-5 shadow-2xl shadow-black/50 sm:p-6")} data-testid="landing-demo">
        <label htmlFor={inputId} className="text-[13px] font-semibold text-muted">
          {copy.demo.input}
        </label>
        <input
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          autoComplete="off"
          className="mt-2 h-14 w-full rounded-[20px] border-[1.5px] border-lime bg-white/[0.06] px-5 text-[16px] font-semibold text-fg placeholder:font-normal placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-lime/40"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {copy.demo.examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              aria-label={`${copy.demo.exampleLabel}: ${ex}`}
              className="h-9 rounded-full border border-white/12 bg-white/[0.05] px-3.5 text-[13px] font-medium text-muted hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>
        <div aria-live="polite" className="mt-5 border-t border-white/10 pt-5">
          <span className="text-[13px] font-semibold text-muted">{copy.demo.preview}</span>
          {parsed.options.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{copy.demo.empty}</p>
          ) : (
            <>
              <p className="display mt-2 text-[22px] text-fg">{parsed.title}</p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label={copy.demo.preview}>
                {parsed.activities.map((a, i) => (
                  <li key={`a-${a}`} className={cn("rounded-full px-3.5 py-2 text-sm font-bold text-white", i % 2 ? "bg-[#c2246f]" : "bg-[#5b3fe0]")}>
                    {a}
                  </li>
                ))}
                {parsed.days.map((d) => (
                  <li key={`d-${d.date}`} className="rounded-full bg-white/[0.1] px-3.5 py-2 text-sm font-bold text-fg">
                    {d.label}
                  </li>
                ))}
                {parsed.time && <li className="rounded-full bg-white/[0.1] px-3.5 py-2 text-sm font-bold text-fg">{parsed.time}</li>}
              </ul>
              <p className="mt-3 text-sm text-muted">{copy.demo.options(parsed.options.length)}</p>
            </>
          )}
        </div>
        <ButtonLink to="/register" block className="mt-5 h-13 font-display text-[14px] font-black uppercase">
          {copy.demo.cta}
        </ButtonLink>
        <p className="mt-3 text-center text-[13px] text-faint">{copy.demo.privacy}</p>
      </div>
    </figure>
  );
}

function SectionTitle({ id, text, accent, className }: { id: string; text: string; accent: string; className?: string }) {
  return (
    <h2 id={id} className={cn("display chrome text-[30px] uppercase sm:text-[44px]", className)}>
      {text} <span className="text-lime">{accent}</span>
    </h2>
  );
}

function Steps() {
  return (
    <section aria-labelledby="landing-steps" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:py-24">
      <div className="min-w-0">
        <SectionTitle id="landing-steps" text={copy.steps.title} accent={copy.steps.titleAccent} />
        <ol className="mt-10 space-y-4">
          {copy.steps.items.map((item, index) => (
            <li key={item.title} className={cn(glassCard, "flex gap-5 p-5")}>
              <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-lime font-display text-[19px] font-black text-lime-ink">
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-[19px] font-bold text-fg">{item.title}</h3>
                <p className="mt-1.5 leading-snug text-muted">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <SampleDeck />
    </section>
  );
}

/** Kartenstapel wie in der Abstimmung (S6) – nur Bild, die Knöpfe sind Deko. */
function SampleDeck() {
  const [top, ...rest] = copy.deck.cards;
  if (!top) return null;
  return (
    <figure aria-label={copy.deck.label} className="mx-auto w-full max-w-[420px] min-w-0">
      <SampleBadge />
      <div aria-hidden className="relative mx-auto mt-5 h-[300px] sm:h-[340px]">
        {rest
          .slice()
          .reverse()
          .map((card, i) => {
            const depth = rest.length - i;
            return (
              <div
                key={card.title}
                className="absolute inset-0 rounded-[32px] border border-white/15 opacity-90"
                style={{ background: DECK[depth % DECK.length], transform: `translateY(${depth * 14}px) scale(${1 - depth * 0.05}) rotate(${depth % 2 ? 3 : -3}deg)` }}
              />
            );
          })}
        <div className="absolute inset-0 flex -rotate-2 flex-col justify-between rounded-[32px] border border-white/20 p-6 text-white shadow-2xl shadow-black/60" style={{ background: DECK[0] }}>
          <span className="self-end rounded-full bg-black/30 px-3 py-1.5 text-[13px] font-bold">{top.going}</span>
          <div>
            <p className="display text-[40px] uppercase leading-[0.95]">{top.title}</p>
            <p className="mt-3 text-[16px] font-bold">{top.when}</p>
          </div>
        </div>
      </div>
      <div aria-hidden className="mt-9 flex items-center justify-center gap-4">
        <span className="flex size-16 items-center justify-center rounded-full border border-white/15 bg-white/[0.07] text-danger">
          <IconClose className="size-7" />
        </span>
        <span className="flex size-13 items-center justify-center rounded-full border border-white/15 bg-white/[0.07] text-amber">
          <IconHelp className="size-6" />
        </span>
        <span className="flex size-20 items-center justify-center rounded-full bg-lime text-lime-ink shadow-[0_16px_40px_-10px_var(--color-lime)]">
          <IconCheck className="size-9" />
        </span>
      </div>
      <p className="mt-3 text-center text-[13px] text-faint">{copy.deck.hint}</p>
    </figure>
  );
}

/** Plan-Karten in den drei Antwortfarben – echte `.ticket`-Karten mit Beispielinhalt, Termine am nächsten Wochenende. */
function Answers() {
  const cards = useMemo(
    () => copy.answers.cards.map((card) => ({ ...card, startsAt: zonedToUtc(nextWeekday(card.weekday), card.time) ?? new Date() })).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    [],
  );
  return (
    <section aria-labelledby="landing-answers" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:py-24">
      <div className="min-w-0 lg:order-last">
        <SectionTitle id="landing-answers" text={copy.answers.title} accent={copy.answers.titleAccent} />
        <p className="mt-6 max-w-xl text-[17px] leading-snug text-muted">{copy.answers.body}</p>
      </div>
      <figure aria-label={copy.answers.label} className="mx-auto w-full max-w-[460px] min-w-0 lg:mx-0">
        <SampleBadge />
        <ul className="mt-4 space-y-3">
          {cards.map((card, index) => {
            const date = ticketDate(card.startsAt);
            return (
              <li key={card.title} className="ticket" data-answer={card.answer} style={{ transform: `rotate(${index === 1 ? 1.2 : index === 2 ? -1 : -0.6}deg)` }}>
                <div className="ticket-stub flex flex-col items-center justify-center px-2 py-4 text-center text-fg">
                  <span className="text-[13px] font-bold">{date.weekday}</span>
                  <span className="font-display text-[35px] font-extrabold leading-[0.9]">{date.day}</span>
                  <span className="text-[13px] font-bold">{date.month}</span>
                </div>
                <div className="flex min-w-0 flex-col justify-between gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-[17px] font-bold leading-tight text-fg">{card.title}</p>
                    <span className="shrink-0 rounded-full border-[1.5px] border-current px-2.5 py-0.5 text-[12px] font-black uppercase text-fg">{card.stamp}</span>
                  </div>
                  <p className="text-sm text-muted">
                    <span className="font-semibold text-fg">{formatTime(card.startsAt)}</span> · {card.place}
                  </p>
                  <AvatarStack people={SAMPLE_PEOPLE.slice(0, 4 - index)} max={4} ringColor="transparent" />
                </div>
              </li>
            );
          })}
        </ul>
      </figure>
    </section>
  );
}

function Features() {
  return (
    <section aria-labelledby="landing-features" className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
      <SectionTitle id="landing-features" text={copy.features.title} accent={copy.features.titleAccent} />
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {copy.features.items.map((item) => {
          const Icon = FEATURE_ICONS[item.key];
          return (
            <li key={item.key} className={cn(glassCard, "p-5")}>
              <span className="flex size-11 items-center justify-center rounded-full bg-lime/12 text-lime">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-[17px] font-bold text-fg">{item.title}</h3>
              <p className="mt-1.5 text-[15px] leading-snug text-muted">{item.body}</p>
            </li>
          );
        })}
      </ul>
      <div className={cn(glassCard, "mt-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6")}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime/12 text-lime">
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
    </section>
  );
}

/** Schluss als Plakat: die Frage in Chrom, die Antwort „Du.“ in Lime. */
function FinalCall() {
  return (
    <section aria-labelledby="landing-final" className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8 lg:pb-28">
      <div className="relative overflow-hidden rounded-[36px] border border-white/10 p-7 text-center sm:p-12" style={{ background: "linear-gradient(155deg, rgb(91 63 224 / 0.35), rgb(184 31 104 / 0.25) 55%, rgb(11 11 16 / 0.6))" }}>
        <h2 id="landing-final" className="display chrome mx-auto max-w-3xl text-[30px] uppercase sm:text-[48px]">
          {copy.final.question} <span className="text-lime">{copy.final.answer}</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl leading-snug text-muted">{copy.final.body}</p>
        <ButtonLink
          to="/register"
          size="lg"
          className="mt-8 h-15 px-8 font-display text-[16px] font-black uppercase shadow-[0_18px_40px_-14px_var(--color-lime)]"
          icon={<IconForward className="order-last size-5" aria-hidden />}
        >
          {copy.final.cta}
        </ButtonLink>
      </div>
    </section>
  );
}
