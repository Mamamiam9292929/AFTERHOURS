import { useRef, useState, type ChangeEvent } from "react";
import { IconCamera, IconTrash } from "@/components/icons";
import type { Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { useNow } from "@/lib/hooks";
import { looksLikeImage, photosLeft, PLAN_PHOTO_LIMIT } from "@/lib/photo";
import { formatAgo } from "@/lib/time";
import { StatusPill } from "./PlanPanel";
import type { PlanWithParticipants } from "./api";
import { useDeletePlanPhoto, usePlanPhotos, useUploadPlanPhoto, type PlanPhotoWithUrl } from "./photosApi";

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
 */
export function PhotosPanel({ plan, userId, canManage, lookup }: PhotosPanelProps) {
  const toast = useToast();
  const now = useNow(60_000);
  const photos = usePlanPhotos(plan.id);
  const upload = useUploadPlanPhoto(plan.id);
  const remove = useDeletePlanPhoto(plan.id);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (photos.isPending) return <Skeleton className="h-28" />;
  if (photos.isError) return <ErrorState error={photos.error} onRetry={() => void photos.refetch()} />;

  const list = photos.data;
  const mine = list.filter((p) => p.uploaded_by === userId).length;
  const left = photosLeft(list.length, mine);
  const open = list.find((p) => p.id === openId) ?? null;
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

  const busy = progress !== null;
  const canDelete = open != null && (open.uploaded_by === userId || canManage);

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
            <li key={photo.id} data-testid="plan-photo">
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
        onClose={() => {
          setOpenId(null);
          setConfirmDelete(false);
          remove.reset();
        }}
        title={open ? t.plans.photos.by(nameOf(open)) : t.plans.photos.title}
        description={open?.uploaded_at ? formatAgo(open.uploaded_at, now) : undefined}
        size="lg"
        footer={
          canDelete ? (
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
              <Button variant="danger" icon={<IconTrash className="size-4" aria-hidden />} onClick={() => setConfirmDelete(true)}>
                {t.plans.photos.delete}
              </Button>
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
            {confirmDelete && <p className="text-sm text-muted">{t.plans.photos.deleteHint}</p>}
            {remove.isError && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(remove.error)}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
