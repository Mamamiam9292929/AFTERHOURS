import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { IconChevronRight, IconPlus } from "@/components/icons";
import { PageHeader, PosterLine, Section } from "@/components/layout/Page";
import { AvatarStack } from "@/components/ui/Avatar";
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
import { errorMessage } from "@/lib/errors";
import { useDocumentTitle } from "@/lib/hooks";
import { extractInviteToken, useCreateCrew, useCrews, type CrewWithMembers } from "./api";
import { CrewForm } from "./CrewForm";

export function CrewRow({ crew, status }: { crew: CrewWithMembers; status?: string }) {
  const people = usePeople();
  return (
    <Link to={`/crews/${crew.id}`} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-raised text-[28px]" aria-hidden>
        {crew.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold text-fg">{crew.name}</span>
        <span className="mt-1 flex items-center gap-2 text-[13px] text-muted">
          <AvatarStack people={crew.members.map((m) => people.lookup(m.user_id))} max={4} size="xs" />
          <span className="truncate">
            {t.members(crew.members.length)}
            {status ? `, ${status}` : ""}
          </span>
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
    const map = new Map<string, string>();
    for (const crew of crews.data ?? []) {
      const openPolls = (polls.data ?? []).filter((p) => p.crew_id === crew.id && !isPollOver(p, now)).length;
      const upcoming = (plans.data ?? []).filter((p) => p.crew_id === crew.id && isUpcoming(p, now)).length;
      map.set(crew.id, openPolls > 0 ? t.crews.card.openPolls(openPolls) : upcoming > 0 ? t.crews.card.upcomingPlans(upcoming) : t.crews.card.quiet);
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
        <form onSubmit={openInvite} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
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
