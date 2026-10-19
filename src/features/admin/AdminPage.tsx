import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { IconInfo, IconWarning } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Controls";
import { Badge, DemoBadge, EmptyState, ErrorState, ListSkeleton, Notice, PageSpinner } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { useUser } from "@/features/auth/AuthProvider";
import { useIsAdmin } from "@/features/profile/api";
import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatDateWithYear } from "@/lib/time";
import type { Activity, AuditLogEntry, Report, ReportStatus } from "@/lib/types";

type Tab = "overview" | "activities" | "reports" | "audit";

function Overview() {
  const overview = useQuery({
    queryKey: [...qk.admin, "overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_overview");
      if (error) throw error;
      return data as Record<keyof typeof t.admin.metrics, number>;
    },
  });
  if (overview.isPending) return <ListSkeleton rows={2} height="h-24" />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(Object.keys(t.admin.metrics) as (keyof typeof t.admin.metrics)[]).map((key) => (
        <div key={key} className="rounded-card border border-line bg-surface p-4">
          <dd className="font-display text-[29px] font-extrabold leading-none text-fg">{formatNumber(overview.data[key] ?? 0)}</dd>
          <dt className="mt-2 text-[13px] text-muted">{t.admin.metrics[key]}</dt>
        </div>
      ))}
    </dl>
  );
}

interface PlaceSyncHealth {
  days: number;
  runs: number;
  failed: number;
  failure_rate: number | null;
  threshold: number;
  over_threshold: boolean;
  fallback_runs: number;
  last_failure_at: string | null;
  errors: Record<string, number>;
  endpoints: { host: string; attempts: number; ok: number }[];
  /** O2 – fehlen, solange die Migration noch nicht eingespielt ist. */
  stages?: { geocode: number; overpass: number };
  geocode_fallback_runs?: number;
  geocoders?: { host: string; attempts: number; ok: number }[];
}

const percentFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Roadmap O1: Wie oft scheitert der Import neuer Städte, und springt der Ersatzserver ein? */
function PlaceSyncHealthCard() {
  const health = useQuery({
    queryKey: [...qk.admin, "place-sync-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_place_sync_health", { p_days: 7 });
      if (error) throw error;
      return data as PlaceSyncHealth;
    },
  });
  const tx = t.admin.placeSync;
  return (
    <section aria-labelledby="place-sync-title" className="mt-6 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="place-sync-title" className="font-display text-[16px] font-extrabold uppercase leading-none text-fg">{tx.title}</h2>
        <p className="text-[13px] text-muted">{tx.period(health.data?.days ?? 7)}</p>
      </div>
      <div className="mt-4">
        {health.isPending && <ListSkeleton rows={1} height="h-16" />}
        {health.isError && <ErrorState error={health.error} onRetry={() => void health.refetch()} />}
        {health.data && health.data.runs === 0 && <p className="text-[15px] text-muted">{tx.empty}</p>}
        {health.data && health.data.runs > 0 && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: tx.runs, value: formatNumber(health.data.runs) },
                { label: tx.failed, value: formatNumber(health.data.failed) },
                { label: tx.rate, value: tx.rateValue(percentFormat.format(health.data.failure_rate ?? 0)) },
                { label: tx.fallback, value: formatNumber(health.data.fallback_runs) },
                ...(health.data.geocode_fallback_runs === undefined ? [] : [{ label: tx.geocodeFallback, value: formatNumber(health.data.geocode_fallback_runs) }]),
              ].map((item) => (
                <div key={item.label}>
                  <dd className="font-display text-[23px] font-extrabold leading-none text-fg">{item.value}</dd>
                  <dt className="mt-1 text-[13px] text-muted">{item.label}</dt>
                </div>
              ))}
            </dl>
            {health.data.over_threshold && (
              <Notice tone="amber" icon={<IconWarning aria-hidden />} className="mt-4">
                {tx.overThreshold(health.data.threshold)}
              </Notice>
            )}
            {health.data.last_failure_at && <p className="mt-3 text-[13px] text-muted">{tx.lastFailure(formatDateTime(health.data.last_failure_at))}</p>}
            {health.data.stages && <p className="mt-3 text-[13px] text-muted">{tx.stages(health.data.stages.geocode, health.data.stages.overpass)}</p>}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {Object.keys(health.data.errors).length > 0 && (
                <div>
                  <h3 className="text-[13px] font-semibold text-fg">{tx.errorsTitle}</h3>
                  <ul className="mt-1 space-y-1 text-[13px] text-muted">
                    {Object.entries(health.data.errors).map(([code, n]) => (
                      <li key={code}>{tx.errors[code] ?? code}: {formatNumber(n)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {health.data.endpoints.length > 0 && (
                <div>
                  <h3 className="text-[13px] font-semibold text-fg">{tx.endpointsTitle}</h3>
                  <ul className="mt-1 space-y-1 text-[13px] text-muted">
                    {health.data.endpoints.map((endpoint) => (
                      <li key={endpoint.host}>
                        <span className="font-mono text-fg">{endpoint.host}</span> – {tx.endpointLine(endpoint.ok, endpoint.attempts)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {health.data.geocoders && health.data.geocoders.length > 0 && (
                <div>
                  <h3 className="text-[13px] font-semibold text-fg">{tx.geocodersTitle}</h3>
                  <ul className="mt-1 space-y-1 text-[13px] text-muted">
                    {health.data.geocoders.map((geocoder) => (
                      <li key={geocoder.host}>
                        <span className="font-mono text-fg">{geocoder.host === "db" ? tx.geocoderDb : geocoder.host}</span> – {tx.endpointLine(geocoder.ok, geocoder.attempts)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Activities() {
  const client = useQueryClient();
  const toast = useToast();
  const activities = useQuery({
    queryKey: [...qk.admin, "activities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("activities").select("*").neq("provider_id", "osm").order("city").order("name").limit(1000);
      if (error) throw error;
      return data as Activity[];
    },
  });
  const update = useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Pick<Activity, "is_active" | "last_verified_at">> }) => {
      const { error } = await supabase.from("activities").update(input.patch).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t.admin.activities.saved);
      void client.invalidateQueries({ queryKey: qk.admin });
      void client.invalidateQueries({ queryKey: qk.activities });
    },
    onError: (error) => toast.error(error),
  });

  if (activities.isPending) return <ListSkeleton rows={5} height="h-16" />;
  if (activities.isError) return <ErrorState error={activities.error} onRetry={() => void activities.refetch()} />;
  return (
    <>
      <Notice icon={<IconInfo aria-hidden />} className="mb-4">
        {t.admin.activities.demoHint} {t.admin.activities.osmNote} {t.admin.activities.partnerNote}
      </Notice>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {activities.data.map((activity) => (
          <li key={activity.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
                <span className="truncate">{activity.name}</span>
                {activity.is_demo && <DemoBadge />}
                <Badge tone={activity.is_active ? "lime" : "neutral"}>{activity.is_active ? t.admin.activities.active : t.admin.activities.inactive}</Badge>
              </p>
              <p className="text-[13px] text-muted">
                {t.enums.category[activity.category]}
                {activity.city ? `, ${activity.city}` : ""} – {activity.last_verified_at ? t.admin.activities.verified(formatDateWithYear(activity.last_verified_at)) : t.admin.activities.unverified}
              </p>
            </div>
            <div className="flex gap-2">
              {!activity.is_demo && (
                <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: activity.id, patch: { last_verified_at: new Date().toISOString() } })}>
                  {t.admin.activities.verify}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: activity.id, patch: { is_active: !activity.is_active } })}>
                {activity.is_active ? t.admin.activities.deactivate : t.admin.activities.activate}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Reports() {
  const user = useUser();
  const client = useQueryClient();
  const toast = useToast();
  const reports = useQuery({
    queryKey: [...qk.admin, "reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as Report[];
    },
  });
  const update = useMutation({
    mutationFn: async (input: { id: string; status: ReportStatus }) => {
      const { error } = await supabase.from("reports").update({ status: input.status, resolved_by: user.id, resolved_at: new Date().toISOString() }).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t.admin.reports.saved);
      void client.invalidateQueries({ queryKey: qk.admin });
    },
    onError: (error) => toast.error(error),
  });

  if (reports.isPending) return <ListSkeleton rows={3} height="h-20" />;
  if (reports.isError) return <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />;
  if (reports.data.length === 0) return <EmptyState title={t.admin.reports.empty} />;
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-surface">
      {reports.data.map((report) => (
        <li key={report.id} className="px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Badge tone={report.status === "open" ? "amber" : "neutral"}>{t.admin.reports.status[report.status]}</Badge>
            <span>{t.admin.reports.target(report.entity_type)}</span>
            <time dateTime={report.created_at}>{formatDateTime(report.created_at)}</time>
          </div>
          <p className="mt-2 whitespace-pre-line break-words text-[15px] text-fg">{report.reason}</p>
          {report.status === "open" && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => update.mutate({ id: report.id, status: "resolved" })}>
                {t.admin.reports.resolve}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: report.id, status: "dismissed" })}>
                {t.admin.reports.dismiss}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function AuditLog() {
  const audit = useQuery({
    queryKey: [...qk.admin, "audit"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as AuditLogEntry[];
    },
  });
  if (audit.isPending) return <ListSkeleton rows={5} height="h-12" />;
  if (audit.isError) return <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />;
  if (audit.data.length === 0) return <EmptyState title={t.admin.audit.empty} />;
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[560px] text-left text-sm">
        <tbody className="divide-y divide-line">
          {audit.data.map((entry) => (
            <tr key={entry.id}>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatDateTime(entry.created_at)}</td>
              <td className="px-4 py-2.5 font-mono text-[13px] text-fg">{entry.action}</td>
              <td className="px-4 py-2.5 font-mono text-[12px] text-faint">{entry.actor_id ? entry.actor_id.slice(0, 8) : t.admin.audit.system}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Admin-Bereich. Die Oberfläche fragt die Rolle über die RPC is_admin() ab; maßgeblich ist aber
 * die Datenbank: Ohne Eintrag in app_admins liefern alle Abfragen hier nichts bzw. einen 403.
 */
export function AdminPage() {
  useDocumentTitle(t.admin.title);
  const admin = useIsAdmin();
  const [tab, setTab] = useState<Tab>("overview");

  if (admin.isPending) return <PageSpinner />;
  if (admin.isError) return <ErrorState error={admin.error} onRetry={() => void admin.refetch()} />;
  if (!admin.data) return <EmptyState title={t.admin.denied.title} body={t.admin.denied.body} />;

  return (
    <>
      <PageHeader title={t.admin.title} lead={t.admin.lead} />
      <Segmented<Tab>
        label={t.admin.tabs.label}
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: t.admin.tabs.overview },
          { value: "activities", label: t.admin.tabs.activities },
          { value: "reports", label: t.admin.tabs.reports },
          { value: "audit", label: t.admin.tabs.audit },
        ]}
      />
      <div className="mt-6" role="tabpanel">
        {tab === "overview" && (
          <>
            <Overview />
            <PlaceSyncHealthCard />
          </>
        )}
        {tab === "activities" && <Activities />}
        {tab === "reports" && <Reports />}
        {tab === "audit" && <AuditLog />}
      </div>
    </>
  );
}
