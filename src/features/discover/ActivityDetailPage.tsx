import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { IconCalendarPlus, IconClock, IconCrews, IconEuro, IconExternal, IconFlag, IconGlobe, IconInfo, IconMap, IconPhone, IconPin, IconTimer, IconUser, IconVote } from "@/components/icons";
import { Fact, PageHeader, Section } from "@/components/layout/Page";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, DemoBadge, EmptyState, ErrorState, Notice, PageSpinner } from "@/components/ui/Feedback";
import { FormMessage, TextAreaField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { usePollDraft } from "@/features/polls/draft";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatDistance, formatDuration } from "@/lib/format";
import { distanceKm } from "@/lib/geo";
import { WEEK } from "@/lib/hours";
import { mapProvider } from "@/lib/maps";
import { supabase } from "@/lib/supabase";
import { formatDateWithYear, zonedParts } from "@/lib/time";
import type { Activity } from "@/lib/types";
import { ActivityCover } from "./ActivityCard";
import { typicalPriceCents, useActivity, usePlaceRegion } from "./api";
import { openLabel, priceLabel } from "./display";

const externalLink = "inline-flex items-center gap-1.5 font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";

function OpeningHours({ activity }: { activity: Activity }) {
  const hours = activity.opening_hours;
  const today = zonedParts().weekday;
  const state = openLabel(activity);
  const osm = activity.provider_id === "osm";
  const hint = osm ? <p className="mt-3 text-[13px] leading-snug text-faint">{t.discover.detail.hoursOsmHint}</p> : null;
  if (!hours || Object.keys(hours).length === 0) {
    if (activity.opening_hours_raw) {
      return (
        <div>
          <p className="text-[15px] text-muted">{t.discover.detail.hoursRaw}</p>
          <p className="mt-1 break-words font-mono text-[14px] text-fg">{activity.opening_hours_raw}</p>
          {hint}
        </div>
      );
    }
    return <p className="text-[15px] text-muted">{t.discover.open.unknown}</p>;
  }
  return (
    <div>
      <p className={cn("mb-3 text-[15px] font-semibold", state.tone === "open" ? "text-lime" : "text-fg")}>{state.text}</p>
      <table className="w-full max-w-sm text-[15px]">
        <tbody>
          {WEEK.map((day) => {
            const spans = hours[day] ?? [];
            return (
              <tr key={day} className={cn(day === today ? "font-semibold text-fg" : "text-muted")}>
                <th scope="row" className="py-1 pr-4 text-left font-[inherit]">
                  {t.weekdays[day]}
                  {day === today && <span className="sr-only"> ({t.discover.open.today})</span>}
                </th>
                <td className="py-1 text-right tabular-nums">{spans.length === 0 ? t.discover.open.closedDay : spans.map(([from, to]) => `${from}–${to}`).join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hint}
    </div>
  );
}

/** Karte erst nach Klick laden: vorher geht keine Anfrage an den Kartenanbieter. */
function MapBlock({ activity }: { activity: Activity }) {
  const [loaded, setLoaded] = useState(false);
  if (activity.latitude == null || activity.longitude == null) return <p className="text-[15px] text-muted">{t.discover.detail.noCoordinates}</p>;
  return (
    <div className="space-y-3">
      <div className="relative aspect-[16/9] overflow-hidden rounded-card border border-line bg-surface">
        {loaded ? (
          <iframe title={`${t.discover.detail.map}: ${activity.name}`} src={mapProvider.embedUrl(activity.latitude, activity.longitude)} className="size-full border-0 grayscale-[0.2]" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-5 text-center">
            <Button variant="secondary" onClick={() => setLoaded(true)} icon={<IconMap className="size-4" aria-hidden />}>
              {t.discover.detail.loadMap}
            </Button>
            <p className="max-w-xs text-[13px] leading-snug text-faint">{t.discover.detail.mapPrivacy}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-faint">
        <a href={mapProvider.linkUrl(activity.latitude, activity.longitude)} target="_blank" rel="noopener noreferrer" className={cn(externalLink, "text-sm")}>
          {t.discover.detail.openInMaps}
          <IconExternal className="size-3.5" aria-hidden />
        </a>
        <span>{loaded ? mapProvider.attribution : null}</span>
      </div>
      {activity.is_demo && <p className="text-[13px] text-amber">{t.discover.detail.mapDemo}</p>}
    </div>
  );
}

function ReportDialog({ activity, open, onClose }: { activity: Activity; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const report = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("report_entity", { p_entity_type: "activity", p_entity_id: activity.id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t.discover.detail.reportSent);
      setReason("");
      onClose();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    report.mutate();
  }
  return (
    <Dialog open={open} onClose={onClose} title={t.discover.detail.reportTitle} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <TextAreaField label={t.discover.detail.reportLabel} placeholder={t.discover.detail.reportPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required />
        {report.isError && <FormMessage>{errorMessage(report.error)}</FormMessage>}
        <Button type="submit" block loading={report.isPending} disabled={reason.trim().length < 5}>
          {t.discover.detail.reportSubmit}
        </Button>
      </form>
    </Dialog>
  );
}

export function ActivityDetailPage() {
  const { activityId } = useParams();
  const navigate = useNavigate();
  const activity = useActivity(activityId);
  // Entfernung ab der Mitte der Stadt, in der der Ort liegt (nicht der eigenen).
  const region = usePlaceRegion(activity.data?.city ?? null, { autoSync: false });
  const draft = usePollDraft();
  const toast = useToast();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  if (activity.isPending) return <PageSpinner />;
  if (activity.isError) return <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />;
  const a = activity.data;
  if (!a) {
    return (
      <EmptyState
        title={t.discover.detail.notFoundTitle}
        body={t.discover.detail.notFoundBody}
        action={
          <ButtonLink to="/discover" variant="secondary" size="sm">
            {t.discover.detail.back}
          </ButtonLink>
        }
      />
    );
  }

  const origin = region.center;
  const distance = origin && a.latitude != null && a.longitude != null ? distanceKm(origin, { latitude: a.latitude, longitude: a.longitude }) : null;
  const hasPrice = a.price_min_cents != null || a.price_max_cents != null;

  function addToPoll() {
    if (!a) return;
    if (!draft.add({ activityId: a.id, title: a.name, priceCents: typicalPriceCents(a) })) {
      toast.error(t.discover.draft.full);
      return;
    }
    navigate("/polls/new");
  }

  return (
    <>
      <PageHeader
        title={a.name}
        back={{ to: "/discover", label: t.discover.detail.back }}
        lead={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{t.enums.category[a.category]}</Badge>
            {a.is_demo && <DemoBadge />}
            {a.city && (
              <span className="inline-flex items-center gap-1 text-sm">
                <IconPin className="size-3.5" aria-hidden />
                {a.city}
                {distance != null && `, ${t.discover.distanceFromCenter(formatDistance(distance))}`}
              </span>
            )}
          </span>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <ActivityCover activity={a} className="aspect-[16/9] rounded-card sm:aspect-[2/1]" />

          {a.is_demo && (
            <Notice tone="amber" icon={<IconInfo aria-hidden />} title={t.discover.demoNotice.title} className="mt-5">
              {t.discover.demoNotice.body}
            </Notice>
          )}

          {a.description && (
            <Section title={t.discover.detail.about}>
              <p className="max-w-prose text-[15px] leading-relaxed text-fg">{a.description}</p>
            </Section>
          )}

          <Section title={t.discover.detail.facts}>
            <dl className="grid divide-y divide-line rounded-card border border-line bg-surface px-4 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
              <Fact icon={<IconEuro aria-hidden />} label={t.discover.detail.pricePerPerson}>
                {priceLabel(a)}
                {hasPrice && <span className="block text-[13px] text-muted">{a.is_demo ? t.discover.price.demoEstimate : t.discover.price.estimate}</span>}
              </Fact>
              <Fact icon={<IconTimer aria-hidden />} label={t.discover.detail.duration}>
                {a.duration_minutes != null ? `${t.approx} ${formatDuration(a.duration_minutes)}` : t.states.notSpecified}
              </Fact>
              <Fact icon={<IconCrews aria-hidden />} label={t.discover.detail.group}>
                {t.discover.detail.groupRange(a.group_min, a.group_max)}
              </Fact>
              <Fact icon={<IconUser aria-hidden />} label={t.discover.detail.age}>
                {a.min_age != null ? t.discover.detail.ageValue(a.min_age) : t.discover.detail.ageNone}
              </Fact>
              <Fact icon={<IconGlobe aria-hidden />} label={t.discover.detail.setting}>
                {a.setting ? t.enums.setting[a.setting] : t.states.notSpecified}
              </Fact>
              <Fact icon={<IconInfo aria-hidden />} label={t.discover.detail.rating}>
                {a.rating != null && a.rating_source ? t.discover.detail.ratingValue(String(a.rating).replace(".", ","), a.rating_count, a.rating_source) : t.discover.detail.ratingNone}
              </Fact>
            </dl>
          </Section>

          <Section title={t.discover.detail.hours}>
            <OpeningHours activity={a} />
          </Section>

          <Section title={t.discover.detail.address}>
            <p className="mb-4 text-[15px] text-fg">{a.address ?? t.states.notSpecified}</p>
            <MapBlock activity={a} />
          </Section>

          <Section title={t.discover.detail.contact}>
            <dl className="space-y-2 text-[15px]">
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">{t.discover.detail.phone}</dt>
                <dd>
                  {a.phone ? (
                    <a href={`tel:${a.phone.replace(/[^\d+]/g, "")}`} className={externalLink}>
                      <IconPhone className="size-4" aria-hidden />
                      {a.phone}
                    </a>
                  ) : (
                    <span className="text-muted">{t.states.notSpecified}</span>
                  )}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">{t.discover.detail.website}</dt>
                <dd className="min-w-0">
                  {a.website_url ? (
                    <a href={a.website_url} target="_blank" rel="noopener noreferrer" className={cn(externalLink, "break-all")}>
                      {new URL(a.website_url).hostname}
                      <IconExternal className="size-3.5 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-muted">{t.states.notSpecified}</span>
                  )}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">{t.discover.detail.availability}</dt>
                <dd className="text-muted">{t.discover.detail.availabilityUnknown}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">{t.discover.detail.source}</dt>
                <dd className="min-w-0 text-muted">
                  {a.provider_id === "osm" ? (
                    <>
                      {t.discover.detail.sourceOsm(formatDateWithYear(a.last_verified_at ?? a.updated_at))}
                      {a.source_url && (
                        <a href={a.source_url} target="_blank" rel="noopener noreferrer" className={cn(externalLink, "mt-1 flex w-fit text-sm")}>
                          {t.discover.detail.sourceOsmLink}
                          <IconExternal className="size-3.5" aria-hidden />
                        </a>
                      )}
                      <span className="mt-1 block text-[13px] leading-snug text-faint">{t.discover.detail.sourceOsmHint}</span>
                    </>
                  ) : a.is_demo ? (
                    t.discover.detail.sourceDemo
                  ) : a.last_verified_at ? (
                    t.discover.detail.sourceVerified(formatDateWithYear(a.last_verified_at))
                  ) : (
                    t.discover.detail.sourceUnverified
                  )}
                </dd>
              </div>
            </dl>
            <button type="button" onClick={() => setReportOpen(true)} className="mt-5 inline-flex h-10 items-center gap-2 text-sm font-semibold text-muted hover:text-fg">
              <IconFlag className="size-4" aria-hidden />
              {t.discover.detail.report}
            </button>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-10 lg:self-start">
          <div className="rounded-card border border-line bg-surface p-5">
            <p className="display text-[24px] text-fg">{priceLabel(a)}</p>
            {hasPrice && <p className="mt-1 text-sm text-muted">{t.perPerson}</p>}
            <p className="mt-3 flex items-center gap-2 text-sm text-muted">
              <IconClock className="size-4 shrink-0" aria-hidden />
              {openLabel(a).text}
            </p>
            <h2 className="mb-3 mt-6 text-sm font-bold text-fg">{t.discover.detail.actionsTitle}</h2>
            <div className="flex flex-col gap-2.5">
              <Button size="lg" block onClick={addToPoll} icon={<IconVote className="size-5" aria-hidden />}>
                {t.discover.detail.addToPoll}
              </Button>
              <ButtonLink to={`/plans/new?activity=${a.id}`} variant="secondary" size="lg" block icon={<IconCalendarPlus className="size-5" aria-hidden />}>
                {t.discover.detail.createPlan}
              </ButtonLink>
              <Button variant="ghost" block onClick={() => setBookingOpen(true)}>
                {t.discover.detail.prepareBooking}
              </Button>
            </div>
            {a.booking_url && (
              <a href={a.booking_url} target="_blank" rel="noopener noreferrer" className={cn(externalLink, "mt-4 text-sm")}>
                {t.discover.detail.bookingLink}
                <IconExternal className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        </aside>
      </div>

      <Dialog
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        title={t.discover.detail.bookingDialogTitle}
        description={t.discover.detail.bookingDialogBody}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBookingOpen(false)}>
              {t.actions.cancel}
            </Button>
            <ButtonLink to={`/plans/new?activity=${a.id}`}>{t.discover.detail.createPlan}</ButtonLink>
          </>
        }
      >
        {a.is_demo ? <Notice tone="amber">{t.discover.detail.bookingDialogDemo}</Notice> : undefined}
      </Dialog>
      <ReportDialog activity={a} open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}
