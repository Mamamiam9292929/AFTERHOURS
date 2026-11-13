import { useEffect, useState, type FormEvent } from "react";
import { IconCheck, IconClose, IconPlus } from "@/components/icons";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { FormMessage, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { BRING_TEMPLATES, guessTemplate, isOpenItem, sameLabel, templateSuggestions, type BringTemplate } from "@/lib/bring";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { PANEL_ITEM, StatusPill } from "./PlanPanel";
import type { PlanWithParticipants } from "./api";
import { useAddPlanItem, useClaimPlanItem, usePlanItems, useRemovePlanItem } from "./itemsApi";

/** F10 · Texte der Planseiten-Karten kommen erst mit der Planseite. */
await loadTexts("planCards");

interface BringPanelProps {
  plan: PlanWithParticipants;
  userId: string;
  /** Organisator:in, Owner oder Admin – darf alles von der Liste nehmen. */
  canManage: boolean;
  locked: boolean;
  lookup: (id: string | null | undefined) => Person | null;
}

const MAX_ITEMS = 40;

/**
 * P14 · Wer bringt was? Die Crew schreibt auf, was gebraucht wird; jede Person tippt an, was sie mitbringt.
 * Eine Sache bringt genau eine Person mit (prüft der Server). Offene Sachen stehen oben, damit der Blick
 * dort landet, wo noch jemand gebraucht wird.
 */
export function BringPanel({ plan, userId, canManage, locked, lookup }: BringPanelProps) {
  const toast = useToast();
  const items = usePlanItems(plan.id);
  const add = useAddPlanItem(plan.id);
  const claim = useClaimPlanItem(plan.id);
  const remove = useRemovePlanItem(plan.id);
  const [label, setLabel] = useState("");
  const [mineToo, setMineToo] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Etappe 2: Vorlage nach dem Plantitel vorwählen („Grillen am See“ → Grillen), sonst keine.
  const [template, setTemplate] = useState<BringTemplate | null>(() => guessTemplate(plan.title));
  const [suggesting, setSuggesting] = useState<string | null>(null);

  // Von „Mitbringen“ auf Home kommt man mit #mitbringen – nach dem Laden dorthin springen.
  const loaded = items.isSuccess;
  useEffect(() => {
    if (loaded && window.location.hash === "#mitbringen") document.getElementById("mitbringen")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  if (items.isPending) return <Skeleton className="h-24" />;
  if (items.isError) return <ErrorState error={items.error} onRetry={() => void items.refetch()} />;

  const list = items.data;
  const sorted = [...list].sort((a, b) => Number(!isOpenItem(a)) - Number(!isOpenItem(b)));
  const claimedCount = list.filter((i) => !isOpenItem(i)).length;
  // P52: Gäste über den Teilen-Link bringen auch etwas mit – die Crew sieht „Dana (Gast) bringt es“.
  const guestName = (id: string) => plan.guests?.find((g) => g.id === id)?.display_name ?? null;
  const mineCount = list.filter((i) => i.claimed_by === userId).length;
  const full = list.length >= MAX_ITEMS;

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = label.trim().replace(/\s+/g, " ");
    if (clean.length < 2) {
      setFormError(t.errors.codes.invalid_plan_item);
      return;
    }
    if (list.some((i) => sameLabel(i.label, clean))) {
      setFormError(t.errors.codes.plan_item_exists);
      return;
    }
    setFormError(null);
    add.mutate(
      { label: clean, claim: mineToo },
      {
        onSuccess: () => {
          setLabel("");
          setMineToo(false);
          toast.success(mineToo ? t.planCards.items.addedMine : t.planCards.items.added);
        },
        onError: (error) => setFormError(errorMessage(error)),
      },
    );
  }

  function addSuggestion(suggestion: string) {
    setSuggesting(suggestion);
    add.mutate(
      { label: suggestion, claim: false },
      {
        onSuccess: () => toast.success(t.planCards.items.suggestionAdded(suggestion)),
        onError: (error) => toast.error(error),
        onSettled: () => setSuggesting(null),
      },
    );
  }

  function toggle(itemId: string, value: boolean) {
    setBusyId(itemId);
    claim.mutate(
      { itemId, claim: value },
      {
        onSuccess: () => toast.success(value ? t.planCards.items.claimed : t.planCards.items.unclaimed),
        onError: (error) => toast.error(error),
        onSettled: () => setBusyId(null),
      },
    );
  }

  if (locked && list.length === 0) return <p className="text-[15px] text-muted">{t.planCards.items.lockedEmpty}</p>;

  return (
    <div className="space-y-3">
      {!locked && <p className="text-[15px] leading-snug text-muted">{t.planCards.items.intro}</p>}
      {!locked && plan.guests_allowed && (
        <p className="text-[13px] leading-snug text-faint" data-testid="items-guests-hint">
          {t.planCards.items.guestsHint}
        </p>
      )}

      {list.length === 0 ? (
        <p className="text-[15px] text-muted">{t.planCards.items.empty}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={claimedCount === list.length ? "lime" : "amber"} testId="items-progress">
              {t.planCards.items.progress(claimedCount, list.length)}
            </StatusPill>
            {mineCount > 0 && <span className="text-sm text-muted">{t.planCards.items.mine(mineCount)}</span>}
          </div>
          <ul className="space-y-2" aria-label={t.planCards.items.title}>
            {sorted.map((item) => {
              const mine = item.claimed_by === userId;
              const bringer = item.claimed_by ? lookup(item.claimed_by) : null;
              const guest = item.claimed_by_guest ? guestName(item.claimed_by_guest) : null;
              const canRemove = !locked && (item.created_by === userId || canManage);
              const state = isOpenItem(item) ? "open" : mine ? "mine" : "taken";
              return (
                <li
                  key={item.id}
                  data-testid="plan-item"
                  data-state={state}
                  className={cn(PANEL_ITEM, "flex min-h-14 items-center gap-3 py-2 pr-2 pl-3.5", mine && "border-lime/45 bg-lime/[0.07]")}
                >
                  <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-full", state === "open" ? "border-2 border-dashed border-white/25" : "bg-lime text-lime-ink")}>
                    {state !== "open" && <IconCheck className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-semibold break-words text-fg", state === "taken" && "text-muted")}>{item.label}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
                      {state === "open" ? (
                        <span className="font-semibold text-amber">{t.planCards.items.open}</span>
                      ) : (
                        <>
                          {/* Eigene Sachen ohne Profilbild: der Lime-Haken sagt es schon, und bei 390 px passt „Du bringst es“ neben „Doch nicht“. */}
                          {!mine && !item.claimed_by_guest && <Avatar person={bringer} size="xs" decorative />}
                          <span className={mine ? "break-words" : "truncate"} data-guest={item.claimed_by_guest ? true : undefined}>
                            {mine
                              ? t.planCards.items.you
                              : item.claimed_by_guest
                                ? t.planCards.items.bringer(guest ? t.plans.detail.guest(guest) : t.planCards.items.someGuest)
                                : t.planCards.items.bringer(bringer?.display_name ?? t.states.formerMember)}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  {!locked && state === "open" && (
                    <Button size="sm" variant="secondary" loading={busyId === item.id} onClick={() => toggle(item.id, true)}>
                      {t.planCards.items.claim}
                    </Button>
                  )}
                  {!locked && mine && (
                    <Button size="sm" variant="ghost" loading={busyId === item.id} onClick={() => toggle(item.id, false)}>
                      {t.planCards.items.unclaim}
                    </Button>
                  )}
                  {canRemove && (
                    <IconButton
                      label={t.planCards.items.remove(item.label)}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(item.id, { onSuccess: () => toast.success(t.planCards.items.removed), onError: (error) => toast.error(error) })}
                    >
                      <IconClose className="size-4" aria-hidden />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!locked &&
        (full ? (
          <p className="text-[13px] text-faint">{t.planCards.items.full}</p>
        ) : (
          <>
            <BringTemplates
              template={template}
              onTemplate={setTemplate}
              existing={list.map((i) => i.label)}
              room={MAX_ITEMS - list.length}
              busy={add.isPending}
              suggesting={suggesting}
              onAdd={addSuggestion}
            />
            <form onSubmit={submit} noValidate className={cn(PANEL_ITEM, "space-y-3 p-3.5")}>
              <TextField
                label={t.planCards.items.label}
                name="plan_item"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t.planCards.items.placeholder}
                maxLength={60}
                autoComplete="off"
                enterKeyHint="done"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-fg">
                  <input type="checkbox" checked={mineToo} onChange={(e) => setMineToo(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-lime)]" />
                  {t.planCards.items.claimSelf}
                </label>
                <Button type="submit" size="sm" loading={add.isPending} icon={<IconPlus className="size-4" aria-hidden />}>
                  {t.planCards.items.add}
                </Button>
              </div>
              {formError && <FormMessage>{formError}</FormMessage>}
            </form>
          </>
        ))}
    </div>
  );
}

interface BringTemplatesProps {
  template: BringTemplate | null;
  onTemplate: (template: BringTemplate | null) => void;
  existing: string[];
  room: number;
  busy: boolean;
  suggesting: string | null;
  onAdd: (label: string) => void;
}

/**
 * P14 Etappe 2 · Vorlagen je Anlass: Anlass als Chip wählen, dann die Sachen antippen, die noch nicht auf der
 * Liste stehen – jede landet als offene Sache auf der Liste (gleiche RPC wie das Formular).
 */
function BringTemplates({ template, onTemplate, existing, room, busy, suggesting, onAdd }: BringTemplatesProps) {
  const chosen = template ? t.planCards.items.templates[template] : null;
  const suggestions = chosen ? templateSuggestions(chosen.items, existing, room) : [];
  return (
    <div className={cn(PANEL_ITEM, "space-y-3 p-3.5")} data-testid="bring-templates">
      <p className="text-[12px] font-bold uppercase tracking-wide text-muted">{t.planCards.items.templatesTitle}</p>
      <div role="group" aria-label={t.planCards.items.templatesLabel} className="flex flex-wrap gap-2">
        {BRING_TEMPLATES.map((id) => (
          <Chip key={id} selected={template === id} onToggle={() => onTemplate(template === id ? null : id)}>
            {t.planCards.items.templates[id].name}
          </Chip>
        ))}
      </div>
      {chosen &&
        (suggestions.length === 0 ? (
          <p className="text-sm text-muted">{t.planCards.items.allSuggested}</p>
        ) : (
          <ul aria-label={t.planCards.items.suggestionsLabel(chosen.name)} className="flex flex-wrap gap-2">
            {suggestions.map((label) => (
              <li key={label}>
                <button
                  type="button"
                  aria-label={t.planCards.items.suggest(label)}
                  aria-busy={suggesting === label}
                  disabled={busy}
                  onClick={() => onAdd(label)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-dashed border-white/25 bg-white/[0.04] px-3.5 text-sm font-semibold text-fg transition-colors hover:border-lime hover:text-lime disabled:cursor-wait disabled:opacity-60"
                >
                  <IconPlus className="size-4" aria-hidden />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
