import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { IconChevronRight, IconPlus } from "@/components/icons";
import { PageHeader, PosterLine, Section } from "@/components/layout/Page";
import { AvatarStack } from "@/components/ui/Avatar";
import { GLASS_PILL, LivePill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/Feedback";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useUser } from "@/features/auth/AuthProvider";
import { isUpcoming, usePlans } from "@/features/plans/api";
import { usePolls } from "@/features/polls/api";
import { isPollOver } from "@/features/polls/logic";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { crewPulse, crewWorld, type CrewPulse } from "@/lib/crewWorld";
import { errorMessage } from "@/lib/errors";
import { useDocumentTitle } from "@/lib/hooks";
import { extractInviteToken, useCreateCrew, useCrews, type CrewWithMembers } from "./api";
import { CrewForm } from "./CrewForm";

/** Hervorhebung auf der Crew-Zeile (nur Crews-Übersicht): laufende Abstimmung leuchtet Lime, Plan als Glas-Pille. */
export type CrewRowStatus = { pulse: CrewPulse; label: string };

/**
 * V2 Etappe 3i: Die Crew-Zeile ist eine Glas-Karte in der Farbwelt der Crew (fest aus der ID), das Symbol
 * auf einer Kachel im selben Licht, der Name in Unbounded. Was gerade läuft, steht als Pille daneben.
 */
export function CrewRow({ crew, status }: { crew: CrewWithMembers; status?: CrewRowStatus }) {
  const people = usePeople();
  return (
    <Link
      to={`/crews/${crew.id}`}
      data-testid="crew-row"
      data-world={crewWorld(crew.id)}
      data-pulse={status?.pulse}
      className="crew-world flex items-center gap-4 rounded-[28px] border border-white/10 p-4 hover:border-white/20"
    >
      <span className="crew-world-tile flex size-14 shrink-0 items-center justify-center rounded-[20px] text-[28px]" aria-hidden>
        {crew.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[16px] font-extrabold uppercase leading-tight tracking-[-0.01em] text-fg sm:text-[17px]">{crew.name}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[13px] text-muted">
          <span className="flex items-center gap-2">
            <AvatarStack people={crew.members.map((m) => people.lookup(m.user_id))} max={4} size="xs" />
            <span className="whitespace-nowrap">{t.members(crew.members.length)}</span>
          </span>
          {status ? (
            status.pulse === "polls" ? (
              <LivePill className="h-7 px-3 text-[12px]" testId="crew-row-status">
                {status.label}
              </LivePill>
            ) : status.pulse === "plans" ? (
              <span className={cn(GLASS_PILL, "h-7 px-3 text-[12px] text-fg")} data-testid="crew-row-status">
                {status.label}
              </span>
            ) : (
              <span className="text-faint" data-testid="crew-row-status">
                {status.label}
              </span>
            )
          ) : null}
        </span>
      </span>
      <IconChevronRight className="size-5 shrink-0 text-faint" aria-hidden />
    </Link>
  );
}

export function CrewsPage() {
  useDocumentTitle(t.crews.title);
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const crews = useCrews();
  const polls = usePolls();
  const plans = usePlans();
  const create = useCreateCrew();
  const user = useUser();
  const [createOpen, setCreateOpen] = useState(params.get("new") === "1");
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (params.get("new") === "1") setParams({}, { replace: true });
  }, [params, setParams]);

  const status = useMemo(() => {
    const now = new Date();
    const map = new Map<string, CrewRowStatus>();
    for (const crew of crews.data ?? []) {
      const openPolls = (polls.data ?? []).filter((p) => p.crew_id === crew.id && !isPollOver(p, now)).length;
      const upcoming = (plans.data ?? []).filter((p) => p.crew_id === crew.id && isUpcoming(p, now)).length;
      const pulse = crewPulse(openPolls, upcoming);
      map.set(crew.id, { pulse, label: pulse === "polls" ? t.crews.card.openPolls(openPolls) : pulse === "plans" ? t.crews.card.upcomingPlans(upcoming) : t.crews.card.quiet });
    }
    return map;
  }, [crews.data, polls.data, plans.data]);

  // Freunde = verschiedene Mitglieder aller Crews ohne dich selbst.
  const friends = useMemo(() => new Set((crews.data ?? []).flatMap((c) => c.members.map((m) => m.user_id)).filter((id) => id !== user.id)).size, [crews.data, user.id]);
  const crewCount = crews.data?.length ?? 0;
  const poster = crewCount > 0 && friends > 0 ? t.crews.poster.friends(friends, crewCount) : t.crews.poster.none;

  function openInvite(event: FormEvent) {
    event.preventDefault();
    const token = extractInviteToken(invite);
    if (!token) {
      setInviteError(t.crews.joinInvalid);
      return;
    }
    navigate(`/join/${token}`);
  }

  return (
    <>
      <PageHeader
        poster
        title={<PosterLine lead={poster.lead} keyword={poster.key} tail={poster.tail} />}
        lead={t.crews.lead}
        actions={
          <Button onClick={() => setCreateOpen(true)} icon={<IconPlus className="size-4" aria-hidden />}>
            {t.crews.create}
          </Button>
        }
      />

      {crews.isPending ? (
        <ListSkeleton rows={3} height="h-[88px]" />
      ) : crews.isError ? (
        <ErrorState error={crews.error} onRetry={() => void crews.refetch()} />
      ) : crews.data.length === 0 ? (
        <EmptyState title={t.crews.empty.title} body={t.crews.empty.body} action={<Button onClick={() => setCreateOpen(true)}>{t.crews.create}</Button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {crews.data.map((crew) => (
            <CrewRow key={crew.id} crew={crew} status={status.get(crew.id)} />
          ))}
        </div>
      )}

      <Section title={t.crews.joinTitle} className="max-w-xl">
        <form onSubmit={openInvite} noValidate data-testid="crew-join" className="flex flex-col gap-3 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-start sm:p-5">
          <TextField
            fieldClassName="flex-1"
            label={t.crews.joinLabel}
            name="invite"
            value={invite}
            onChange={(e) => {
              setInvite(e.target.value);
              setInviteError(null);
            }}
            hint={t.crews.joinBody}
            error={inviteError}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <Button type="submit" variant="secondary" className="h-12 sm:mt-[26px]">
            {t.crews.joinSubmit}
          </Button>
        </form>
      </Section>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t.crews.createTitle} description={t.crews.createBody} size="sm">
        <CrewForm
          submitLabel={t.crews.create}
          pending={create.isPending}
          error={create.isError ? errorMessage(create.error) : null}
          onSubmit={(values) =>
            create.mutate(values, {
              onSuccess: (crewId) => {
                setCreateOpen(false);
                toast.success(t.crews.created);
                navigate(`/crews/${crewId}?invite=1`);
              },
            })
          }
        />
      </Dialog>
    </>
  );
}
