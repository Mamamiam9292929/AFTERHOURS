import { Link } from "react-router-dom";
import { IconAward, IconBell, IconCalendar, IconCalendarCheck, IconCar, IconCheckAll, IconCircleX, IconClose, IconCrews, IconCrown, IconSparkles, IconUserMinus, IconUserPlus, IconVote, IconWallet } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { StatusPill } from "@/features/plans/PlanPanel";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { groupInbox, inboxArea, inboxTone } from "@/lib/inbox";
import { notificationTarget } from "@/lib/pushview";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { formatAgo } from "@/lib/time";
import type { NotificationType } from "@/lib/types";
import { useDeleteNotification, useMarkNotificationsRead, useNotifications } from "./api";

/** Symbol je Art – zeigt auf einen Blick, worum es geht (Bereichsfarbe kommt aus `inboxTone`). */
function NotificationIcon({ type, className }: { type: NotificationType; className?: string }) {
  const props = { className, "aria-hidden": true as const };
  switch (type) {
    case "crew_member_joined":
      return <IconUserPlus {...props} />;
    case "crew_member_removed":
      return <IconUserMinus {...props} />;
    case "crew_role_changed":
      return <IconCrown {...props} />;
    case "poll_created":
    case "poll_reminder":
    case "poll_vote":
    case "poll_result":
      return <IconVote {...props} />;
    case "plan_cancelled":
      return <IconCircleX {...props} />;
    case "booking_status":
      return <IconCalendarCheck {...props} />;
    case "ride_request":
    case "ride_confirmed":
      return <IconCar {...props} />;
    case "reward_earned":
      return <IconAward {...props} />;
    case "plan_expense":
    case "plan_settlement":
    case "plan_expense_reminder":
      return <IconWallet {...props} />;
    case "spontaneous_ask":
    case "spontaneous_answer":
    case "spontaneous_match":
      return <IconSparkles {...props} />;
    case "plan_created":
    case "plan_changed":
    case "plan_attendance":
      return <IconCalendar {...props} />;
    default:
      return <IconCrews {...props} />;
  }
}

/**
 * V2 Etappe 3l · Benachrichtigungen als Stapel aus Glas-Karten, nach Tagen gruppiert (Berliner Zeit).
 * Jede Karte trägt den Farbschein ihres Bereichs (Abstimmung Violett, Plan Lime, Crew Pink, Kosten Gelb,
 * schlechte Nachrichten Rot), ungelesene leuchten stärker und haben eine Lime-Kante. Verhalten unverändert:
 * Antippen öffnet das Ziel und markiert als gelesen, ✕ löscht.
 */
export function NotificationsPage() {
  useDocumentTitle(t.notifications.title);
  const toast = useToast();
  const now = useNow(60_000);
  const notifications = useNotifications();
  const people = usePeople();
  const markRead = useMarkNotificationsRead();
  const remove = useDeleteNotification();
  const unread = notifications.data?.filter((n) => !n.read_at).length ?? 0;
  const groups = notifications.data ? groupInbox(notifications.data, now) : [];

  return (
    <>
      <PageHeader
        title={t.notifications.title}
        actions={
          <>
            {unread > 0 && (
              <Button variant="secondary" onClick={() => markRead.mutate(null, { onError: (e) => toast.error(e) })} icon={<IconCheckAll className="size-4" aria-hidden />}>
                {t.notifications.markAllRead}
              </Button>
            )}
          </>
        }
      />
      <div className="max-w-2xl">
        {notifications.isPending ? (
          <ListSkeleton rows={5} height="h-20" />
        ) : notifications.isError ? (
          <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
        ) : notifications.data.length === 0 ? (
          <EmptyState art={<IconBell aria-hidden />} title={t.notifications.empty.title} body={t.notifications.empty.body} />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-2" aria-live="polite">
              {unread > 0 ? (
                <StatusPill tone="lime" testId="inbox-status">
                  <span aria-hidden className="size-2 animate-pulse rounded-full bg-lime-ink motion-reduce:animate-none" />
                  {t.notifications.statusUnread(unread)}
                </StatusPill>
              ) : (
                <StatusPill testId="inbox-status">
                  <IconCheckAll className="size-4" aria-hidden />
                  {t.notifications.statusAllRead}
                </StatusPill>
              )}
              <StatusPill>{t.notifications.statusTotal(notifications.data.length)}</StatusPill>
            </div>
            <div className="space-y-7">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`inbox-${group.key}`} data-testid="inbox-group" data-group={group.key}>
                  <h2 id={`inbox-${group.key}`} className="display mb-3 text-[13px] uppercase tracking-wide text-muted">
                    {t.notifications.groups[group.key]}
                  </h2>
                  <ul className="space-y-2.5">
                    {group.items.map((n) => {
                      const actor = people.lookup(n.actor_id);
                      const text = t.notifications.text[n.type](actor?.display_name ?? t.notifications.someone, n.payload);
                      const to = notificationTarget(n);
                      const isUnread = !n.read_at;
                      const area = inboxArea(n.type);
                      const tone = inboxTone(n.type, n.payload);
                      const content = (
                        <>
                          <span className="relative mt-0.5 shrink-0">
                            {n.actor_id ? (
                              <>
                                <Avatar person={actor} size="md" decorative />
                                <span aria-hidden className="inbox-tile absolute -right-1 top-5 grid size-6 place-items-center rounded-full text-fg">
                                  <NotificationIcon type={n.type} className="size-3.5" />
                                </span>
                              </>
                            ) : (
                              <span aria-hidden className="inbox-tile grid size-10 place-items-center rounded-full text-fg">
                                <NotificationIcon type={n.type} className="size-[18px]" />
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] leading-tight">
                              <span className="font-bold uppercase tracking-wide text-muted">{t.notifications.areas[area]}</span>
                              <time dateTime={n.created_at} className="text-faint">
                                {formatAgo(n.created_at, now)}
                              </time>
                            </span>
                            <span className={cn("mt-1 block text-[15px] leading-snug text-fg", isUnread && "font-semibold")}>
                              {isUnread && <span className="sr-only">{t.notifications.unread}: </span>}
                              {text.title}
                            </span>
                            {text.body && <span className="mt-0.5 block truncate text-sm text-muted">{text.body}</span>}
                          </span>
                        </>
                      );
                      return (
                        <li key={n.id} className="inbox-card flex items-start gap-1 rounded-[28px] border border-white/[0.08] pr-1" data-testid="inbox-card" data-area={area} data-tone={tone} data-unread={isUnread ? "true" : "false"}>
                          {to ? (
                            <Link to={to} onClick={() => isUnread && markRead.mutate([n.id])} className="flex min-w-0 flex-1 items-start gap-3 rounded-[28px] px-3.5 py-3.5 sm:px-4">
                              {content}
                            </Link>
                          ) : (
                            <div className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3.5 sm:px-4">{content}</div>
                          )}
                          <IconButton label={t.notifications.delete} className="mt-2 size-11" onClick={() => remove.mutate(n.id, { onError: (e) => toast.error(e) })}>
                            <IconClose className="size-4 text-faint" aria-hidden />
                          </IconButton>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
        <p className="mt-6 text-[13px] leading-snug text-faint">
          {t.notifications.pushNote}{" "}
          <Link to="/settings#notifications" className="font-semibold text-muted underline underline-offset-2 hover:text-fg">
            {t.notifications.manage}
          </Link>
        </p>
      </div>
    </>
  );
}
