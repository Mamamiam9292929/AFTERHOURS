import { Link } from "react-router-dom";
import { IconHourglass, IconRepeat } from "@/components/icons";
import { Badge } from "@/components/ui/Feedback";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/time";
import type { Crew } from "@/lib/types";
import { summarizePoll, type PollWithDetails } from "./logic";

/** Balken für die Beteiligung an einer Abstimmung. */
export function ParticipationBar({ voted, total, className }: { voted: number; total: number; className?: string }) {
  const share = total > 0 ? Math.min(1, voted / total) : 0;
  return (
    <div className={className}>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={voted} aria-label={t.polls.participation(voted, total)}>
        <div className="bar-grow h-full rounded-full bg-lime" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] text-muted">{t.polls.participation(voted, total)}</p>
    </div>
  );
}

interface PollCardProps {
  poll: PollWithDetails;
  crew: Crew | undefined;
  memberIds: string[];
  userId: string;
  now: Date;
}

/** Abstimmung in Listen: Frage, Stand, Beteiligung – und ob die eigene Antwort noch fehlt. */
export function PollCard({ poll, crew, memberIds, userId, now }: PollCardProps) {
  const summary = summarizePoll(poll, memberIds, userId, now);
  const needsMyVote = !summary.isOver && !summary.iHaveVoted;
  const lead = summary.tallies.find((tally) => tally.leading);

  return (
    <Link
      to={`/polls/${poll.id}`}
      className={cn("block rounded-card border bg-surface p-4 transition-colors hover:border-line-strong", needsMyVote ? "border-lime/70" : "border-line")}
    >
      <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
        <span className="min-w-0 truncate">
          {crew ? `${crew.emoji} ${crew.name}` : ""}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <IconHourglass className="size-3.5" aria-hidden />
          {summary.isOver ? t.enums.pollStatus.closed : t.polls.status.endsIn(formatRelative(poll.ends_at, now))}
        </span>
      </div>
      <h3 className="mt-2 text-[17px] font-bold leading-tight text-fg">{poll.title}</h3>
      <p className="mt-1 text-sm text-muted">
        {summary.isTie ? t.polls.leadingTie(summary.leadingOptionIds.length) : lead ? t.polls.leading(lead.option.title, lead.yes.length) : t.polls.noCommitments}
      </p>
      <ParticipationBar voted={Math.round(summary.participation * Math.max(summary.memberCount, 1))} total={summary.memberCount} className="mt-3.5" />
      {(needsMyVote || poll.parent_poll_id) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {needsMyVote && <Badge tone="lime">{t.polls.voteNow}</Badge>}
          {poll.parent_poll_id && <Badge tone="outline">{t.polls.runoffBadge}</Badge>}
          {poll.series?.active && <Badge tone="outline" icon={<IconRepeat className="size-3.5" aria-hidden />}>{t.polls.detail.repeat.badge}</Badge>}
        </div>
      )}
    </Link>
  );
}
