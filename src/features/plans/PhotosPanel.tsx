import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { IconBack, IconCamera, IconEye, IconFlag, IconForward, IconTrash } from "@/components/icons";
import type { Person } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { useNow } from "@/lib/hooks";
import { looksLikeImage, photosLeft, PLAN_PHOTO_LIMIT } from "@/lib/photo";
import { formatAgo } from "@/lib/time";
import { StatusPill } from "./PlanPanel";
import type { PlanWithParticipants } from "./api";
import { useDeletePlanPhoto, useKeepPlanPhoto, usePlanPhotoReports, usePlanPhotos, useReportPlanPhoto, useUploadPlanPhoto, type PlanPhotoWithUrl } from "./photosApi";

type ReasonKey = keyof typeof t.plans.photos.reportReasons;
const REASONS: ReasonKey[] = ["me", "inappropriate", "other"];
/** Ab so vielen Pixeln seitlich gilt ein Wischen in der Großansicht als Blättern. */
const SWIPE_THRESHOLD = 60;

interface PhotosPanelProps {
  plan: PlanWithParticipants;
  userId: string;
  /** Organisator:in, Owner oder Admin – darf jedes Foto löschen. */
  canManage: boolean;
  lookup: (id: string | null | undefined) => Person | null;
}

/**
 * P10 Etappe 1b · Fotos vom Abend. Ab Beginn des Plans teilt jede Person aus der Crew bis zu 10 Fotos
 * (zusammen höchstens 50). Der Browser verkleinert jedes Foto und speichert es neu – Ort, Kamera und
 * Uhrzeit aus den Metadaten gehen nicht mit. Nur die Crew sieht die Fotos.
 *
 * Etappe 2a: Wer ein fremdes Foto nicht sehen will, meldet es („Melden“ in der Großansicht). Für die
 * meldende Person ist es sofort weg, für die Crew ausgeblendet, bis Organisation oder Crew-Admins
 * entscheiden („Wieder zeigen“ oder löschen). Gemeldete Fotos tragen im Raster eine gelbe Pille.
 *
 * Etappe 2b: Ab zwei Fotos liegen sie oben als Stapel (neuestes Foto vorn). Ein Tipp öffnet die
 * Großansicht; dort blättert man mit Pfeilen, per Wischen oder mit den Pfeiltasten durch den Abend.
 */
export function PhotosPanel({ plan, userId, canManage, lookup }: PhotosPanelProps) {
  const toast = useToast();
  const now = useNow(60_000);
  const photos = usePlanPhotos(plan.id);
  const upload = useUploadPlanPhoto(plan.id);
  const remove = useDeletePlanPhoto(plan.id);
  const reports = usePlanPhotoReports(plan.id);
  const report = useReportPlanPhoto(plan.id);
  const keep = useKeepPlanPhoto(plan.id);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReasonKey | null>(null);
  const [otherText, setOtherText] = useState("");
  const [entering, setEntering] = useState<"next" | "prev" | null>(null);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  // Pfeiltasten blättern in der Großansicht – nicht beim Melden oder Löschen und nicht in Eingabefeldern.
  const keyStep = useRef<(dir: 1 | -1) => void>(() => undefined);
  useEffect(() => {
    if (openId == null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      keyStep.current(event.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  if (photos.isPending) return <Skeleton className="h-28" />;
  if (photos.isError) return <ErrorState error={photos.error} onRetry={() => void photos.refetch()} />;

  const list = photos.data;
  const mine = list.filter((p) => p.uploaded_by === userId).length;
  const left = photosLeft(list.length, mine);
  const openIndex = list.findIndex((p) => p.id === openId);
  const open = openIndex >= 0 ? list[openIndex]! : null;
  // Stapel: das neueste Foto vorn, dahinter die zwei davor.
  const pile = list.length >= 2 ? list.slice(-3).reverse() : [];
  const flags = new Map((reports.data ?? []).map((r) => [r.photo_id, r]));
  const openFlag = open ? flags.get(open.id) : undefined;
  const nameOf = (photo: PlanPhotoWithUrl) => (photo.uploaded_by === userId ? t.plans.photos.you : (lookup(photo.uploaded_by)?.display_name ?? t.states.formerMember));

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError(null);
    const images = files.filter(looksLikeImage);
    if (images.length < files.length) setError(t.errors.codes.invalid_plan_photo);
    const batch = images.slice(0, left);
    if (images.length > left) setError(t.plans.photos.tooMany(left));
    if (batch.length === 0) return;
    let done = 0;
    setProgress({ done, total: batch.length });
    for (const file of batch) {
      try {
        await upload.mutateAsync(file);
        done += 1;
        setProgress({ done, total: batch.length });
      } catch (e) {
        setError(errorMessage(e));
        break;
      }
    }
    setProgress(null);
    if (done > 0) toast.success(t.plans.photos.uploaded(done));
  }

  function deleteOpen() {
    if (!open) return;
    remove.mutate(open, {
      onSuccess: () => {
        setConfirmDelete(false);
        setOpenId(null);
        toast.success(t.plans.photos.deleted);
      },
    });
  }

  function resetActions() {
    setConfirmDelete(false);
    setReporting(false);
    setReason(null);
    setOtherText("");
    remove.reset();
    report.reset();
    keep.reset();
  }

  function openPhoto(id: string) {
    setEntering(null);
    setOpenId(id);
  }

  function step(dir: 1 | -1) {
    if (openIndex < 0 || reporting || confirmDelete) return;
    const target = list[openIndex + dir];
    if (!target) return;
    resetActions();
    setEntering(dir === 1 ? "next" : "prev");
    setOpenId(target.id);
  }
  keyStep.current = step;

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (list.length < 2 || reporting || (e.pointerType === "mouse" && e.button !== 0)) return;
    dragStart.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragStart.current != null) setDrag(e.clientX - dragStart.current);
  }
  // Die Strecke kommt aus dem Ereignis selbst – der letzte Stand von `drag` kann beim Loslassen noch fehlen.
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (dragStart.current == null) return;
    const moved = e.type === "pointercancel" ? 0 : e.clientX - dragStart.current;
    dragStart.current = null;
    setDrag(0);
    if (moved < -SWIPE_THRESHOLD) step(1);
    else if (moved > SWIPE_THRESHOLD) step(-1);
  }

  function closeDialog() {
    setOpenId(null);
    setEntering(null);
    resetActions();
  }

  const reasonText = reason === "other" ? otherText.trim() : reason ? t.plans.photos.reportReasons[reason] : "";
  function sendReport() {
    if (!open || reasonText.length < 5) return;
    report.mutate(
      { photoId: open.id, reason: reasonText },
      {
        onSuccess: () => {
          closeDialog();
          toast.success(t.plans.photos.reported);
        },
      },
    );
  }

  function keepOpen() {
    if (!open) return;
    keep.mutate(open.id, {
      onSuccess: () => {
        closeDialog();
        toast.success(t.plans.photos.kept);
      },
    });
  }

  const busy = progress !== null;
  const own = open != null && open.uploaded_by === userId;
  const canDelete = open != null && (own || canManage);
  // Melden: fremde Fotos, für alle ohne Verwaltungsrecht (Verwaltende löschen direkt).
  const canReport = open != null && !own && !canManage;
  const actionError = remove.error ?? report.error ?? keep.error;

  return (
    <div className="space-y-3">
      <p className="text-[15px] leading-snug text-muted">{t.plans.photos.intro}</p>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={list.length > 0 ? "lime" : "glass"} testId="photos-count">
          {t.plans.photos.count(list.length)}
        </StatusPill>
        {list.length >= PLAN_PHOTO_LIMIT ? (
          <span className="text-sm text-muted">{t.plans.photos.full}</span>
        ) : (
          mine > 0 && <span className="text-sm text-muted">{t.plans.photos.left(left)}</span>
        )}
      </div>

      {pile.length > 0 && (
        <div className="overflow-x-clip px-[16%] pt-2 pb-4 sm:px-[22%]">
          <button
            type="button"
            onClick={() => openPhoto(pile[0]!.id)}
            aria-label={t.plans.photos.stack(list.length)}
            data-testid="photo-stack"
            className="photo-stack relative block aspect-[4/3] w-full rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
          >
            {pile
              .map((photo, layer) => (
                <span
                  key={photo.id}
                  aria-hidden
                  data-layer={layer}
                  className={cn(
                    "photo-layer absolute inset-0 overflow-hidden rounded-[22px] border bg-raised",
                    layer === 0 ? "border-white/20 shadow-[0_24px_50px_-24px_rgb(0_0_0/0.9)]" : "border-white/10 shadow-[0_16px_34px_-20px_rgb(0_0_0/0.8)]",
                  )}
                >
                  {photo.url ? (
                    <img src={photo.url} alt="" loading="lazy" decoding="async" width={photo.width} height={photo.height} className={cn("size-full object-cover", layer > 0 && "opacity-60")} />
                  ) : (
                    <span className="grid size-full place-items-center text-xs text-faint">{t.plans.photos.missing}</span>
                  )}
                  {layer === 0 && (
                    <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/75 via-black/30 to-transparent px-3.5 pt-10 pb-3 text-left">
                      <span className="display shrink-0 whitespace-nowrap text-[17px] leading-none text-fg">{t.plans.photos.count(list.length)}</span>
                      <span className="min-w-0 text-right text-[12px] font-semibold leading-tight text-fg/80">{t.plans.photos.stackHint}</span>
                    </span>
                  )}
                </span>
              ))
              .reverse()}
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-[15px] text-muted">{t.plans.photos.empty}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" aria-label={t.plans.photos.title}>
          {list.map((photo) => (
            <li key={photo.id} data-testid="plan-photo" data-flagged={flags.has(photo.id) || undefined} className="relative">
              <button
                type="button"
                onClick={() => openPhoto(photo.id)}
                aria-label={t.plans.photos.open(nameOf(photo))}
                className="block aspect-square w-full overflow-hidden rounded-[14px] border border-white/10 bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
              >
                {photo.url ? (
                  <img src={photo.url} alt="" loading="lazy" decoding="async" width={photo.width} height={photo.height} className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center px-1 text-center text-xs text-faint">{t.plans.photos.missing}</span>
                )}
              </button>
              {flags.has(photo.id) && (
                <StatusPill tone="amber" className="pointer-events-none absolute bottom-1.5 left-1.5 h-6 bg-bg/80 px-2 text-[11px] backdrop-blur-sm">
                  <IconFlag className="size-3" aria-hidden />
                  {t.plans.photos.flagged}
                </StatusPill>
              )}
            </li>
          ))}
        </ul>
      )}

      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void pick(e)} data-testid="photos-input" aria-label={t.plans.photos.add} />
      {left > 0 && (
        <Button variant="secondary" size="sm" icon={<IconCamera className="size-4" aria-hidden />} onClick={() => input.current?.click()} loading={busy}>
          {progress ? t.plans.photos.uploading(progress.done + 1, progress.total) : t.plans.photos.add}
        </Button>
      )}
      {progress && (
        <p className="sr-only" role="status">
          {t.plans.photos.uploading(progress.done + 1, progress.total)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-[13px] leading-snug text-faint">{t.plans.photos.privacy}</p>

      <Dialog
        open={open != null}
        onClose={closeDialog}
        title={open ? t.plans.photos.by(nameOf(open)) : t.plans.photos.title}
        description={open?.uploaded_at ? formatAgo(open.uploaded_at, now) : undefined}
        size="lg"
        footer={
          reporting ? (
            <>
              <Button variant="ghost" onClick={() => setReporting(false)} disabled={report.isPending}>
                {t.actions.cancel}
              </Button>
              <Button variant="danger" icon={<IconFlag className="size-4" aria-hidden />} onClick={sendReport} loading={report.isPending} disabled={reasonText.length < 5}>
                {t.plans.photos.reportSend}
              </Button>
            </>
          ) : canReport ? (
            <Button variant="ghost" icon={<IconFlag className="size-4" aria-hidden />} onClick={() => setReporting(true)}>
              {t.plans.photos.report}
            </Button>
          ) : canDelete ? (
            confirmDelete ? (
              <>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
                  {t.actions.cancel}
                </Button>
                <Button variant="danger" onClick={deleteOpen} loading={remove.isPending}>
                  {t.plans.photos.deleteConfirm}
                </Button>
              </>
            ) : (
              <>
                {openFlag?.can_review && (
                  <Button variant="secondary" icon={<IconEye className="size-4" aria-hidden />} onClick={keepOpen} loading={keep.isPending}>
                    {t.plans.photos.keep}
                  </Button>
                )}
                <Button variant="danger" icon={<IconTrash className="size-4" aria-hidden />} onClick={() => setConfirmDelete(true)}>
                  {t.plans.photos.delete}
                </Button>
              </>
            )
          ) : undefined
        }
      >
        {open && (
          <div className="space-y-3">
            <div
              key={open.id}
              data-testid="photo-view"
              className={cn("photo-view select-none", entering && `is-entering-${entering}`)}
              style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 40}deg)` } : undefined}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {open.url ? (
                <img
                  src={open.url}
                  alt={t.plans.photos.alt(nameOf(open))}
                  width={open.width}
                  height={open.height}
                  draggable={false}
                  className="mx-auto max-h-[56dvh] w-auto max-w-full rounded-[16px] object-contain"
                />
              ) : (
                <p className="text-[15px] text-muted">{t.plans.photos.missing}</p>
              )}
            </div>
            {list.length > 1 && !reporting && (
              <div className="flex items-center justify-between gap-3">
                <IconButton label={t.plans.photos.previous} variant="secondary" onClick={() => step(-1)} disabled={openIndex <= 0 || confirmDelete}>
                  <IconBack className="size-5" aria-hidden />
                </IconButton>
                <p className="text-center text-[13px] text-muted">
                  <span className="font-display text-[15px] font-bold text-fg" data-testid="photo-position">
                    {t.plans.photos.position(openIndex + 1, list.length)}
                  </span>
                  <span className="ml-2 hidden sm:inline">{t.plans.photos.swipeHint}</span>
                  <span className="sr-only" aria-live="polite">
                    {t.plans.photos.positionLabel(openIndex + 1, list.length, nameOf(open))}
                  </span>
                </p>
                <IconButton label={t.plans.photos.next} variant="secondary" onClick={() => step(1)} disabled={openIndex >= list.length - 1 || confirmDelete}>
                  <IconForward className="size-5" aria-hidden />
                </IconButton>
              </div>
            )}
            {openFlag && !reporting && (
              <div data-testid="photo-flag" className="rounded-[16px] border border-amber/40 bg-amber/[0.08] px-4 py-3 text-[14px] leading-snug text-fg">
                {openFlag.can_review ? (
                  <>
                    <p>{t.plans.photos.flaggedReview(openFlag.count)}</p>
                    <ul className="mt-1.5 space-y-1 text-muted">
                      {openFlag.reasons.map((r, i) => (
                        <li key={i} className="break-words">„{r}“</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>{canManage ? t.plans.photos.flaggedOwnManager : t.plans.photos.flaggedOwn}</p>
                )}
              </div>
            )}
            {reporting && (
              <fieldset className="space-y-3">
                <legend className="text-[15px] font-semibold text-fg">{t.plans.photos.reportTitle}</legend>
                <div className="flex flex-wrap gap-2">
                  {REASONS.map((key) => (
                    <Chip key={key} selected={reason === key} onToggle={() => setReason(key)} className="h-auto min-h-10 py-2 whitespace-normal text-left">
                      {t.plans.photos.reportReasons[key]}
                    </Chip>
                  ))}
                </div>
                {reason === "other" && (
                  <TextField label={t.plans.photos.reportOther} value={otherText} onChange={(e) => setOtherText(e.target.value)} maxLength={300} />
                )}
                <p className="text-[13px] leading-snug text-muted">{t.plans.photos.reportHint}</p>
              </fieldset>
            )}
            {confirmDelete && <p className="text-sm text-muted">{t.plans.photos.deleteHint}</p>}
            {actionError && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(actionError)}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
