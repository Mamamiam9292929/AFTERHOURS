import { useRef, useState, type ChangeEvent } from "react";
import { IconCamera, IconEye, IconFlag, IconTrash } from "@/components/icons";
import type { Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
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

  if (photos.isPending) return <Skeleton className="h-28" />;
  if (photos.isError) return <ErrorState error={photos.error} onRetry={() => void photos.refetch()} />;

  const list = photos.data;
  const mine = list.filter((p) => p.uploaded_by === userId).length;
  const left = photosLeft(list.length, mine);
  const open = list.find((p) => p.id === openId) ?? null;
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

  function closeDialog() {
    setOpenId(null);
    setConfirmDelete(false);
    setReporting(false);
    setReason(null);
    setOtherText("");
    remove.reset();
    report.reset();
    keep.reset();
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

      {list.length === 0 ? (
        <p className="text-[15px] text-muted">{t.plans.photos.empty}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" aria-label={t.plans.photos.title}>
          {list.map((photo) => (
            <li key={photo.id} data-testid="plan-photo" data-flagged={flags.has(photo.id) || undefined} className="relative">
              <button
                type="button"
                onClick={() => setOpenId(photo.id)}
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
            {open.url ? (
              <img src={open.url} alt={t.plans.photos.alt(nameOf(open))} width={open.width} height={open.height} className={cn("mx-auto max-h-[62dvh] w-auto max-w-full rounded-[16px] object-contain")} />
            ) : (
              <p className="text-[15px] text-muted">{t.plans.photos.missing}</p>
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
