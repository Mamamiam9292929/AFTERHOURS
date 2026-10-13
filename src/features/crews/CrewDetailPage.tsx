import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { IconCalendarPlus, IconMore, IconSend, IconTrash, IconUserPlus, IconVote } from "@/components/icons";
import { PageHeader, PosterTitle, Section } from "@/components/layout/Page";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Controls";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Badge, EmptyState, ErrorState, ListSkeleton, Notice, PageSpinner } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { useUser } from "@/features/auth/AuthProvider";
import { isUpcoming, usePlans } from "@/features/plans/api";
import { FeatureTicket, PlanTicket } from "@/features/plans/PlanTicket";
import { usePolls } from "@/features/polls/api";
import { isPollOver } from "@/features/polls/logic";
import { PollCard } from "@/features/polls/PollCard";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { formatAgo, formatDateWithYear, formatRelative, formatTime } from "@/lib/time";
import type { CrewMember, CrewRole } from "@/lib/types";
import {
  canManageCrew, invitationState, myRole, useCrew, useCrewInvitations, useCrewMessages, useDeleteCrew, useDeleteMessage, useLeaveCrew,
  useRemoveMember, useRevokeInvitation, useSendMessage, useSetMemberRole, useUpdateCrew, type CrewWithMembers,
} from "./api";
import { CrewForm } from "./CrewForm";
import { InviteDialog } from "./InviteDialog";

type Tab = "overview" | "chat" | "members" | "settings";

// ---- Übersicht ---------------------------------------------------------------------------------------
function Overview({ crew, onInvite, canInvite }: { crew: CrewWithMembers; onInvite: () => void; canInvite: boolean }) {
  const user = useUser();
  const now = useNow(60_000);
  const polls = usePolls();
  const plans = usePlans();
  const people = usePeople();
  const memberIds = crew.members.map((m) => m.user_id);
  const openPolls = (polls.data ?? []).filter((p) => p.crew_id === crew.id && !isPollOver(p, now));
  const crewPlans = (plans.data ?? []).filter((p) => p.crew_id === crew.id);
  const upcoming = crewPlans.filter((p) => isUpcoming(p, now));
  // D0 Etappe 5b: der nächste nicht abgesagte Plan als großes Ticket – der eine große Moment der Crew.
  const featured = upcoming.find((p) => p.status !== "cancelled");
  const rest = upcoming.filter((p) => p !== featured);
  const past = crewPlans.filter((p) => !isUpcoming(p, now)).reverse().slice(0, 4);

  return (
    <>
      {crew.members.length === 1 && (
        <Notice tone="lime" title={t.crews.detail.aloneTitle} className="mb-6">
          <p>{canInvite ? t.crews.detail.aloneBody : t.crews.invite.onlyAdmins}</p>
          {canInvite && (
            <Button size="sm" className="mt-3" onClick={onInvite} icon={<IconUserPlus className="size-4" aria-hidden />}>
              {t.crews.detail.invite}
            </Button>
          )}
        </Notice>
      )}
      {featured && (
        <Section title={t.crews.detail.nextUp}>
          <div className="max-w-2xl pb-2">
            <FeatureTicket plan={featured} userId={user.id} lookup={people.lookup} />
          </div>
        </Section>
      )}
      <Section title={t.crews.detail.activePolls}>
        {polls.isPending ? (
          <ListSkeleton rows={1} height="h-36" />
        ) : polls.isError ? (
          <ErrorState error={polls.error} onRetry={() => void polls.refetch()} />
        ) : openPolls.length === 0 ? (
          <EmptyState title={t.crews.detail.noPolls} body={t.crews.detail.noPollsBody} action={<ButtonLink to={`/polls/new?crew=${crew.id}`} size="sm">{t.crews.detail.startPoll}</ButtonLink>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {openPolls.map((poll) => (
              <PollCard key={poll.id} poll={poll} crew={crew} memberIds={memberIds} userId={user.id} now={now} />
            ))}
          </div>
        )}
      </Section>
      {(!featured || rest.length > 0) && (
        <Section title={featured ? t.crews.detail.morePlans : t.crews.detail.upcomingPlans}>
          {plans.isPending ? (
            <ListSkeleton rows={1} height="h-32" />
          ) : plans.isError ? (
            <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
          ) : upcoming.length === 0 ? (
            <EmptyState title={t.crews.detail.noPlans} body={t.crews.detail.noPlansBody} />
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {rest.map((plan) => (
                <PlanTicket key={plan.id} plan={plan} userId={user.id} lookup={people.lookup} />
              ))}
            </div>
          )}
        </Section>
      )}
      {past.length > 0 && (
        <Section title={t.crews.detail.pastPlans}>
          <div className="grid gap-5 lg:grid-cols-2">
            {past.map((plan) => (
              <PlanTicket key={plan.id} plan={plan} userId={user.id} lookup={people.lookup} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

// ---- Chat ---------------------------------------------------------------------------------------------
function Chat({ crew, role }: { crew: CrewWithMembers; role: CrewRole | null }) {
  const user = useUser();
  const toast = useToast();
  const people = usePeople();
  const messages = useCrewMessages(crew.id, true);
  const send = useSendMessage(crew.id);
  const remove = useDeleteMessage(crew.id);
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const count = messages.data?.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [count]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    send.mutate(text, { onSuccess: () => setBody(""), onError: (error) => toast.error(error) });
  }

  return (
    <div className="flex max-w-2xl flex-col">
      {messages.isPending ? (
        <ListSkeleton rows={4} height="h-12" />
      ) : messages.isError ? (
        <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />
      ) : messages.data.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-muted">{t.crews.chat.empty}</p>
      ) : (
        <ol className="space-y-4" aria-live="polite">
          {messages.data.map((message) => {
            const author = people.lookup(message.user_id);
            const own = message.user_id === user.id;
            return (
              <li key={message.id} className="group flex items-start gap-3">
                <Avatar person={author} size="sm" decorative className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-muted">
                    <span className="font-semibold text-fg">{own ? t.states.you : (author?.display_name ?? t.states.formerMember)}</span>
                    <time dateTime={message.created_at} className="ml-2">
                      {formatAgo(message.created_at)}, {formatTime(message.created_at)}
                    </time>
                  </p>
                  <p className="mt-0.5 whitespace-pre-line break-words text-[15px] leading-snug text-fg">{message.body}</p>
                </div>
                {(own || canManageCrew(role)) && (
                  <IconButton label={t.crews.chat.delete} className="size-9 opacity-60 hover:opacity-100" onClick={() => remove.mutate(message.id, { onSuccess: () => toast.success(t.crews.chat.deleted), onError: (error) => toast.error(error) })}>
                    <IconTrash className="size-4 text-muted" aria-hidden />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div ref={endRef} />
      <form onSubmit={submit} className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] mt-6 flex items-end gap-2 rounded-card border border-line bg-surface p-2 lg:bottom-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          maxLength={1000}
          aria-label={t.crews.chat.label}
          placeholder={t.crews.chat.placeholder}
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-fg placeholder:text-faint focus:outline-none"
        />
        <Button type="submit" loading={send.isPending} disabled={body.trim() === ""} icon={<IconSend className="size-4" aria-hidden />}>
          {t.crews.chat.send}
        </Button>
      </form>
    </div>
  );
}

// ---- Mitglieder -----------------------------------------------------------------------------------------
type MemberAction = { kind: "remove" | "transfer"; member: CrewMember; name: string };

function Members({ crew, role }: { crew: CrewWithMembers; role: CrewRole | null }) {
  const user = useUser();
  const toast = useToast();
  const people = usePeople();
  const setRole = useSetMemberRole(crew.id);
  const remove = useRemoveMember(crew.id);
  const [action, setAction] = useState<MemberAction | null>(null);

  const itemClass = "flex h-11 w-full items-center rounded-control px-3 text-left text-sm font-medium text-fg data-[focus]:bg-raised";
  const pending = setRole.isPending || remove.isPending;
  const failure = setRole.isError ? setRole.error : remove.isError ? remove.error : null;

  function confirm() {
    if (!action) return;
    const done = (message: string) => () => {
      setAction(null);
      toast.success(message);
    };
    if (action.kind === "remove") remove.mutate(action.member.user_id, { onSuccess: done(t.crews.members.removed) });
    else setRole.mutate({ userId: action.member.user_id, role: "owner" }, { onSuccess: done(t.crews.members.roleChanged) });
  }

  return (
    <div className="max-w-2xl">
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {crew.members.map((member) => {
          const person = people.lookup(member.user_id);
          const name = person?.display_name ?? t.states.formerMember;
          const isMe = member.user_id === user.id;
          const canRemove = !isMe && (role === "owner" || (role === "admin" && member.role === "member"));
          const canChangeRole = !isMe && role === "owner";
          return (
            <li key={member.user_id} className="flex items-center gap-3 px-4 py-3">
              <Avatar person={person} decorative />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-fg">
                  <span className="truncate">{name}</span>
                  {isMe && <span className="text-[13px] font-normal text-muted">({t.crews.members.you})</span>}
                  {member.role !== "member" && <Badge tone={member.role === "owner" ? "lime" : "outline"}>{t.enums.crewRole[member.role]}</Badge>}
                </p>
                <p className="text-[13px] text-muted">{t.crews.members.since(formatDateWithYear(member.joined_at))}</p>
              </div>
              {(canRemove || canChangeRole) && (
                <Menu>
                  <MenuButton aria-label={t.crews.members.actionsFor(name)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg">
                    <IconMore className="size-5" aria-hidden />
                  </MenuButton>
                  <MenuItems anchor="bottom end" className="z-40 w-60 rounded-card border border-line bg-base p-1.5 shadow-2xl shadow-black/60 focus:outline-none">
                    {canChangeRole && member.role === "member" && (
                      <MenuItem>
                        <button type="button" className={itemClass} onClick={() => setRole.mutate({ userId: member.user_id, role: "admin" }, { onSuccess: () => toast.success(t.crews.members.roleChanged), onError: (e) => toast.error(e) })}>
                          {t.crews.members.makeAdmin}
                        </button>
                      </MenuItem>
                    )}
                    {canChangeRole && member.role === "admin" && (
                      <MenuItem>
                        <button type="button" className={itemClass} onClick={() => setRole.mutate({ userId: member.user_id, role: "member" }, { onSuccess: () => toast.success(t.crews.members.roleChanged), onError: (e) => toast.error(e) })}>
                          {t.crews.members.makeMember}
                        </button>
                      </MenuItem>
                    )}
                    {canChangeRole && (
                      <MenuItem>
                        <button type="button" className={itemClass} onClick={() => { setRole.reset(); setAction({ kind: "transfer", member, name }); }}>
                          {t.crews.members.transfer}
                        </button>
                      </MenuItem>
                    )}
                    {canRemove && (
                      <MenuItem>
                        <button type="button" className={cn(itemClass, "text-danger")} onClick={() => { remove.reset(); setAction({ kind: "remove", member, name }); }}>
                          {t.crews.members.remove}
                        </button>
                      </MenuItem>
                    )}
                  </MenuItems>
                </Menu>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[13px] leading-snug text-faint">{t.crews.members.roleInfo}</p>

      <ConfirmDialog
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title={action?.kind === "remove" ? t.crews.members.removeTitle(action.name) : t.crews.members.transferTitle(action?.name ?? "")}
        description={action?.kind === "remove" ? t.crews.members.removeBody : t.crews.members.transferBody}
        confirmLabel={action?.kind === "remove" ? t.crews.members.removeConfirm : t.crews.members.transferConfirm}
        destructive={action?.kind === "remove"}
        loading={pending}
        error={failure ? errorMessage(failure) : null}
        onConfirm={confirm}
      />
    </div>
  );
}

// ---- Einstellungen ------------------------------------------------------------------------------------------
function Settings({ crew, role, onInvite }: { crew: CrewWithMembers; role: CrewRole | null; onInvite: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const people = usePeople();
  const manage = canManageCrew(role);
  // Echte Zahl: abgeschlossene Pläne dieser Crew. Erscheint erst ab dem ersten gemeinsamen Abend.
  const evenings = (plans.data ?? []).filter((p) => p.crew_id === crew.id && p.status === "completed").length;
  const invitations = useCrewInvitations(crew.id, manage);
  const revoke = useRevokeInvitation(crew.id);
  const update = useUpdateCrew(crew.id);
  const leave = useLeaveCrew(crew.id);
  const remove = useDeleteCrew(crew.id);
  const [confirming, setConfirming] = useState<"leave" | "delete" | null>(null);
  const now = useNow(60_000);

  return (
    <div className="max-w-2xl">
      {manage && (
        <Section title={t.crews.settings.editTitle}>
          <CrewForm
            key={crew.updated_at}
            initial={{ name: crew.name, emoji: crew.emoji }}
            submitLabel={t.actions.saveChanges}
            pending={update.isPending}
            error={update.isError ? errorMessage(update.error) : null}
            onSubmit={(values) => update.mutate(values, { onSuccess: () => toast.success(t.crews.settings.saved) })}
          />
        </Section>
      )}

      <Section
        title={t.crews.invite.listTitle}
        action={
          manage ? (
            <Button size="sm" onClick={onInvite} icon={<IconUserPlus className="size-4" aria-hidden />}>
              {t.crews.detail.invite}
            </Button>
          ) : undefined
        }
      >
        {!manage ? (
          <p className="text-[15px] text-muted">{t.crews.invite.onlyAdmins}</p>
        ) : invitations.isPending ? (
          <ListSkeleton rows={2} height="h-16" />
        ) : invitations.isError ? (
          <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
        ) : invitations.data.length === 0 ? (
          <p className="text-[15px] text-muted">{t.crews.invite.listEmpty}</p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {invitations.data.map((inv) => {
              const state = invitationState(inv, now);
              return (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                      <Badge tone={state === "active" ? "lime" : "neutral"}>{t.crews.invite.state[state]}</Badge>
                      {t.crews.invite.uses(inv.use_count, inv.max_uses)}
                    </p>
                    <p className="mt-1 text-[13px] text-muted">
                      {state === "active" ? t.crews.invite.expires(formatRelative(inv.expires_at, now)) : formatDateWithYear(inv.created_at)}
                      {inv.invited_by && `, ${t.crews.invite.createdBy(people.lookup(inv.invited_by)?.display_name ?? t.states.formerMember)}`}
                    </p>
                  </div>
                  {state === "active" && (
                    <Button variant="secondary" size="sm" loading={revoke.isPending && revoke.variables === inv.id} onClick={() => revoke.mutate(inv.id, { onSuccess: () => toast.success(t.crews.invite.revoked), onError: (e) => toast.error(e) })}>
                      {t.crews.invite.revoke}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={t.crews.settings.dangerTitle}>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" onClick={() => { leave.reset(); setConfirming("leave"); }}>
            {t.crews.settings.leave}
          </Button>
          {role === "owner" && (
            <Button variant="danger" onClick={() => { remove.reset(); setConfirming("delete"); }}>
              {t.crews.settings.delete}
            </Button>
          )}
        </div>
      </Section>

      <ConfirmDialog
        open={confirming === "leave"}
        onClose={() => setConfirming(null)}
        title={t.crews.settings.leaveTitle}
        description={role === "owner" ? t.crews.settings.leaveBodyOwner : t.crews.settings.leaveBody}
        confirmLabel={t.crews.settings.leave}
        destructive
        loading={leave.isPending}
        error={leave.isError ? errorMessage(leave.error) : null}
        onConfirm={() =>
          leave.mutate(undefined, {
            onSuccess: () => {
              toast.success(t.crews.settings.left);
              navigate("/crews", { replace: true });
            },
          })
        }
      />
      <ConfirmDialog
        open={confirming === "delete"}
        onClose={() => setConfirming(null)}
        title={t.crews.settings.deleteTitle}
        description={t.crews.settings.deleteBody}
        confirmLabel={t.crews.settings.delete}
        destructive
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast.success(t.crews.settings.deleted);
              navigate("/crews", { replace: true });
            },
          })
        }
      />
    </div>
  );
}

// ---- Seite -----------------------------------------------------------------------------------------------------
export function CrewDetailPage() {
  const { crewId } = useParams();
  const user = useUser();
  const people = usePeople();
  const crewQuery = useCrew(crewId);
  const plans = usePlans();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("overview");
  const [inviteOpen, setInviteOpen] = useState(false);
  const crew = crewQuery.data;
  useDocumentTitle(crew?.name);

  // Direkt nach dem Anlegen: Einladungsdialog öffnen.
  useEffect(() => {
    if (params.get("invite") === "1" && crew) {
      setInviteOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams, crew]);

  if (crewQuery.isPending) return <PageSpinner />;
  if (crewQuery.isError) return <ErrorState error={crewQuery.error} onRetry={() => void crewQuery.refetch()} />;
  if (!crew) {
    return (
      <EmptyState
        title={t.crews.detail.notFoundTitle}
        body={t.crews.detail.notFoundBody}
        action={
          <ButtonLink to="/crews" variant="secondary" size="sm">
            {t.crews.detail.back}
          </ButtonLink>
        }
      />
    );
  }

  const role = myRole(crew, user.id);
  const manage = canManageCrew(role);

  return (
    <>
      <PageHeader
        poster
        title={<PosterTitle text={`${crew.emoji} ${crew.name}`} />}
        back={{ to: "/crews", label: t.crews.detail.back }}
        lead={
          <span className="flex items-center gap-2.5">
            <AvatarStack people={crew.members.map((m) => people.lookup(m.user_id))} max={6} ringColor="var(--color-base)" />
            <span>
              {t.members(crew.members.length)}
              {evenings > 0 && ` · ${t.crews.detail.evenings(evenings)}`}
            </span>
          </span>
        }
        actions={
          <>
            <ButtonLink to={`/polls/new?crew=${crew.id}`} icon={<IconVote className="size-4" aria-hidden />}>
              {t.crews.detail.startPoll}
            </ButtonLink>
            <ButtonLink to={`/plans/new?crew=${crew.id}`} variant="secondary" icon={<IconCalendarPlus className="size-4" aria-hidden />}>
              {t.crews.detail.createPlan}
            </ButtonLink>
            {manage && (
              <Button variant="secondary" onClick={() => setInviteOpen(true)} icon={<IconUserPlus className="size-4" aria-hidden />}>
                {t.crews.detail.invite}
              </Button>
            )}
          </>
        }
      />
      <Segmented<Tab>
        label={t.crews.detail.tabs.label}
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: t.crews.detail.tabs.overview },
          { value: "chat", label: t.crews.detail.tabs.chat },
          { value: "members", label: t.crews.detail.tabs.members, count: crew.members.length },
          { value: "settings", label: t.crews.detail.tabs.settings },
        ]}
      />
      <div className="mt-6" role="tabpanel">
        {tab === "overview" && <Overview crew={crew} onInvite={() => setInviteOpen(true)} canInvite={manage} />}
        {tab === "chat" && <Chat crew={crew} role={role} />}
        {tab === "members" && <Members crew={crew} role={role} />}
        {tab === "settings" && <Settings crew={crew} role={role} onInvite={() => setInviteOpen(true)} />}
      </div>
      <InviteDialog crew={crew} open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}
