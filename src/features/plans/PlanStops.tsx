import { useState, type FormEvent } from "react";
import { IconClose, IconMap, IconPlus } from "@/components/icons";
import { Fact } from "@/components/layout/Page";
import { Button, IconButton } from "@/components/ui/Button";
import { FormMessage, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { STOP_MAX, sortStops, stopTimeFromClock } from "@/lib/stops";
import { formatTime } from "@/lib/time";
import { Directions } from "./Directions";
import { PANEL_ITEM, StatusPill } from "./PlanPanel";
import { useAddPlanStop, usePlanStops, useRemovePlanStop } from "./stopsApi";

/** F10 · Texte der Planseiten-Karten kommen erst mit der Planseite. */
await loadTexts("planCards");

interface PlanStopsProps {
  planId: string;
  startsAt: string;
  /** Organisator:in, Owner oder Admin – darf Stationen anhängen und herausnehmen. */
  canManage: boolean;
  locked: boolean;
}

/**
 * P50 · „Danach noch wohin?“ – weitere Stationen des Abends unter „Wo“: erst Essen, dann Bar, danach tanzen.
 * Wer den Plan bearbeiten darf, hängt bis zu vier Stationen an (Name, auf Wunsch Uhrzeit und Adresse); die Crew
 * sieht sie in der Reihenfolge des Abends, mit Route in die Karten-App. Ohne Stationen sehen Mitglieder nichts.
 */
export function PlanStopsFact({ planId, startsAt, canManage, locked }: PlanStopsProps) {
  const toast = useToast();
  const stops = usePlanStops(planId);
  const add = useAddPlanStop(planId);
  const remove = useRemovePlanStop(planId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [clock, setClock] = useState("");
  const [address, setAddress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const editable = canManage && !locked;

  if (stops.isPending) return null;
  if (stops.isError) {
    if (!editable) return null;
    return (
      <Fact icon={<IconMap aria-hidden />} label={t.planCards.stops.label}>
        <span className="text-muted">{t.planCards.stops.loadError}</span>
      </Fact>
    );
  }
  const list = sortStops(stops.data);
  if (list.length === 0 && !editable) return null;
  const full = list.length >= STOP_MAX;

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = title.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      setFormError(t.errors.codes.invalid_plan_stop);
      return;
    }
    let at: string | null = null;
    if (clock.trim()) {
      at = stopTimeFromClock(startsAt, clock);
      if (!at) {
        setFormError(t.errors.codes.plan_stop_time);
        return;
      }
    }
    setFormError(null);
    add.mutate(
      { title: name, at, address: address.trim() || null },
      {
        onSuccess: () => {
          setTitle("");
          setClock("");
          setAddress("");
          setOpen(false);
          toast.success(t.planCards.stops.added(name));
        },
        onError: (error) => setFormError(errorMessage(error)),
      },
    );
  }

  return (
    <Fact icon={<IconMap aria-hidden />} label={t.planCards.stops.label}>
      {list.length === 0 ? (
        <span className="block text-muted">{t.planCards.stops.empty}</span>
      ) : (
        <ol className="mt-1 space-y-2" aria-label={t.planCards.stops.label} data-testid="plan-stops">
          {list.map((stop) => (
            <li key={stop.id} data-testid="plan-stop" className={cn(PANEL_ITEM, "flex items-start gap-3 py-2.5 pr-2 pl-3.5")}>
              <StatusPill tone={stop.at ? "lime" : "glass"} className="mt-0.5 shrink-0">
                {stop.at ? formatTime(stop.at) : t.planCards.stops.later}
              </StatusPill>
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-words text-fg">{stop.title}</p>
                {stop.address && <p className="mt-0.5 text-sm break-words text-muted">{stop.address}</p>}
                {!locked && stop.address && <Directions target={{ name: stop.title, address: stop.address }} />}
              </div>
              {editable && (
                <IconButton
                  label={t.planCards.stops.remove(stop.title)}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(stop.id, { onSuccess: () => toast.success(t.planCards.stops.removed), onError: (error) => toast.error(error) })}
                >
                  <IconClose className="size-4" aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ol>
      )}

      {editable &&
        (full ? (
          <span className="mt-2 block text-[13px] text-faint">{t.planCards.stops.full}</span>
        ) : open ? (
          <form onSubmit={submit} noValidate className={cn(PANEL_ITEM, "mt-2 space-y-3 p-3.5")} data-testid="plan-stop-form">
            <TextField
              label={t.planCards.stops.name}
              name="plan_stop_title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.planCards.stops.namePlaceholder}
              maxLength={60}
              autoComplete="off"
              required
            />
            <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <TextField label={t.planCards.stops.time} name="plan_stop_time" type="time" value={clock} onChange={(e) => setClock(e.target.value)} optional />
              <TextField
                label={t.planCards.stops.address}
                name="plan_stop_address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t.planCards.stops.addressPlaceholder}
                maxLength={200}
                autoComplete="off"
                optional
              />
            </div>
            <p className="text-[13px] text-muted">{t.planCards.stops.timeHint}</p>
            {formError && <FormMessage>{formError}</FormMessage>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => {
                  setOpen(false);
                  setFormError(null);
                }}>
                {t.planCards.stops.cancel}
              </Button>
              <Button type="submit" size="sm" loading={add.isPending} icon={<IconPlus className="size-4" aria-hidden />}>
                {t.planCards.stops.save}
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-testid="plan-stop-open"
            className="mt-1 flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
          >
            <IconPlus className="size-4 text-lime" aria-hidden />
            {list.length === 0 ? t.planCards.stops.addFirst : t.planCards.stops.addMore}
          </button>
        ))}
    </Fact>
  );
}
