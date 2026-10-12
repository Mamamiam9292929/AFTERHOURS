import { useEffect, useState } from "react";
import { IconCopy, IconLink, IconShare } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FormMessage, SelectField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { copyText } from "@/lib/hooks";
import { siteUrl } from "@/lib/supabase";
import { formatDateTime } from "@/lib/time";
import type { Crew } from "@/lib/types";
import { useCreateInvitation, type CreatedInvitation } from "./api";

/** Einladungslink erzeugen. Der Link wird genau einmal angezeigt – gespeichert ist nur sein Hash. */
export function InviteDialog({ crew, open, onClose }: { crew: Crew; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateInvitation(crew.id);
  const [hours, setHours] = useState("168");
  const [maxUses, setMaxUses] = useState("20");
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const link = created ? `${siteUrl()}/join/${created.token}` : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (open) {
      setCreated(null);
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function copy() {
    if (await copyText(link)) toast.success(t.crews.invite.copied);
    else toast.error(t.crews.invite.copyFailed);
  }

  async function share() {
    try {
      await navigator.share({ title: "AFTERHOURS", text: t.crews.invite.shareText(crew.name), url: link });
    } catch {
      /* Teilen abgebrochen – kein Fehler */
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t.crews.invite.title} description={created ? undefined : t.crews.invite.body} size="sm">
      {created ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="invite-link" className="mb-1.5 block text-sm font-medium text-fg">
              {t.crews.invite.linkReady}
            </label>
            <input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-12 w-full rounded-control border border-lime/60 bg-surface px-3.5 font-mono text-[13px] text-fg focus:outline-none" />
            <p className="mt-2 text-[13px] leading-snug text-muted">{t.crews.invite.linkOnce}</p>
            <p className="mt-1 text-[13px] text-faint">
              {t.crews.invite.uses(0, created.max_uses)}, {t.crews.invite.expires(formatDateTime(created.expires_at))}
            </p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Button block onClick={copy} icon={<IconCopy className="size-4" aria-hidden />}>
              {t.crews.invite.copy}
            </Button>
            {canShare && (
              <Button variant="secondary" block onClick={share} icon={<IconShare className="size-4" aria-hidden />}>
                {t.crews.invite.share}
              </Button>
            )}
          </div>
          <Button variant="ghost" block onClick={() => setCreated(null)}>
            {t.crews.invite.another}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ expiresInHours: Number(hours), maxUses: Number(maxUses) }, { onSuccess: setCreated });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t.crews.invite.validity} value={hours} onChange={(e) => setHours(e.target.value)}>
              <option value="24">{t.crews.invite.validityOptions.day}</option>
              <option value="168">{t.crews.invite.validityOptions.week}</option>
              <option value="720">{t.crews.invite.validityOptions.month}</option>
            </SelectField>
            <SelectField label={t.crews.invite.maxUses} value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
              {[1, 5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {t.crews.invite.maxUsesOption(n)}
                </option>
              ))}
            </SelectField>
          </div>
          {create.isError && <FormMessage>{errorMessage(create.error)}</FormMessage>}
          <Button type="submit" size="lg" block loading={create.isPending} icon={<IconLink className="size-4" aria-hidden />}>
            {t.crews.invite.createLink}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
