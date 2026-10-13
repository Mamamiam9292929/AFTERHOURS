import { useState } from "react";
import { IconShare } from "@/components/icons";
import { t } from "@/i18n";
import { type ShareContent, shareOrCopy } from "@/lib/share";
import { Button } from "./Button";
import { useToast } from "./Toast";

/** W8: Teilen-Knopf für Plan und Abstimmung (Web Share API, Rückfall: Text und Link kopieren). */
export function ShareButton({ label, content, className }: { label: string; content: () => ShareContent; className?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function share() {
    setBusy(true);
    const outcome = await shareOrCopy(content());
    setBusy(false);
    if (outcome === "copied") toast.success(t.share.copied);
    else if (outcome === "failed") toast.error(t.share.failed);
  }
  return (
    <Button variant="secondary" onClick={share} disabled={busy} icon={<IconShare className="size-4" aria-hidden />} className={className}>
      {label}
    </Button>
  );
}
