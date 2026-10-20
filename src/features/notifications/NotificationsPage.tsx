import { Link } from "react-router-dom";
import { IconBell, IconCheckAll, IconClose } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { formatAgo } from "@/lib/time";
import type { AppNotification } from "@/lib/types";
import { useDeleteNotification, useMarkNotificationsRead, useNotifications } from "./api";

/** Wohin eine Benachrichtigung führt. */
function targetOf(n: AppNotification): string | null {
  if (n.type === "reward_earned") return "/rewards";
  // S4: „Heute noch wer?“ wird auf Home beantwortet.
  if (n.type === "spontaneous_ask" || n.type === "spontaneous_answer" || n.type === "spontaneous_match") return "/";
  // P3 Etappe 3b: Die Erinnerung führt direkt zu „Kosten teilen“.
  if (n.type === "plan_expense_reminder" && n.related_entity_id) return `/plans/${n.related_entity_id}#kosten`;
  if (!n.related_entity_id) return n.crew_id ? `/crews/${n.crew_id}` : null;
  if (n.entity_type === "poll") return `/polls/${n.related_entity_id}`;
  if (n.entity_type === "plan") return `/plans/${n.related_entity_id}`;
  if (n.entity_type === "crew") return `/crews/${n.related_entity_id}`;
  return null;
}

export function NotificationsPage() {
  useDocumentTitle(t.notifications.title);
  const toast = useToast();
  const now = useNow(60_000);
  const notifications = useNotifications();
  const people = usePeople();
  const markRead = useMarkNotificationsRead();
  const remove = useDeleteNotification();
  const unread = notifications.data?.filter((n) => !n.read_at).length ?? 0;

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
          <ListSkeleton rows={5} height="h-16" />
        ) : notifications.isError ? (
          <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
        ) : notifications.data.length === 0 ? (
          <EmptyState icon={<IconBell aria-hidden />} title={t.notifications.empty.title} body={t.notifications.empty.body} />
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {notifications.data.map((n) => {
              const actor = people.lookup(n.actor_id);
              const text = t.notifications.text[n.type](actor?.display_name ?? t.notifications.someone, n.payload);
              const to = targetOf(n);
              const isUnread = !n.read_at;
              const content = (
                <>
                  <span className="relative mt-0.5 shrink-0">
                    {n.actor_id ? <Avatar person={actor} size="md" decorative /> : <span className="flex size-10 items-center justify-center rounded-full bg-raised text-muted"><IconBell className="size-[18px]" aria-hidden /></span>}
                    {isUnread && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-surface bg-lime" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[15px] leading-snug", isUnread ? "font-semibold text-fg" : "text-fg")}>
                      {isUnread && <span className="sr-only">{t.notifications.unread}: </span>}
                      {text.title}
                    </span>
                    {text.body && <span className="mt-0.5 block truncate text-sm text-muted">{text.body}</span>}
                    <time dateTime={n.created_at} className="mt-1 block text-[13px] text-faint">
                      {formatAgo(n.created_at, now)}
                    </time>
                  </span>
                </>
              );
              return (
                <li key={n.id} className="flex items-start gap-1 pr-1">
                  {to ? (
                    <Link to={to} onClick={() => isUnread && markRead.mutate([n.id])} className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3.5 hover:bg-raised/50">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3.5">{content}</div>
                  )}
                  <IconButton label={t.notifications.delete} className="mt-2 size-10" onClick={() => remove.mutate(n.id, { onError: (e) => toast.error(e) })}>
                    <IconClose className="size-4 text-faint" aria-hidden />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-[13px] leading-snug text-faint">
          {t.notifications.pushNote}{" "}
          <Link to="/settings#notifications" className="font-semibold text-muted underline underline-offset-2 hover:text-fg">
            {t.notifications.manage}
          </Link>
        </p>
      </div>
    </>
  );
}
