import { lazy, Suspense, useState } from "react";
import { IconQr, IconShare } from "@/components/icons";
import { t } from "@/i18n";
import { type ShareContent, shareOrCopy } from "@/lib/share";
import { Button, IconButton } from "./Button";
import { Dialog } from "./Dialog";
import { FormMessage } from "./Field";
import { Skeleton } from "./Feedback";
import { useToast } from "./Toast";

// W9 Etappe 2: QR-Encoder nur laden, wenn jemand den Code sehen will (eigener Chunk wie im Einladungsdialog).
const QrCode = lazy(() => import("./QrCode"));

/**
 * W8: Teilen-Knopf für Plan und Abstimmung (Web Share API, Rückfall: Text und Link kopieren).
 * W9 Etappe 2: Mit `qr` steht daneben ein runder Knopf, der denselben Link als QR-Code zeigt – für Freunde am
 * selben Tisch. Nur, wenn der Link eine Vorschau-Seite ist (`/s/…`, `/v/…`), also auch ohne Konto etwas zeigt.
 */
export function ShareButton({ label, content, className, qr = false }: { label: string; content: () => ShareContent; className?: string; qr?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [qrContent, setQrContent] = useState<ShareContent | null>(null);
  async function share() {
    setBusy(true);
    const outcome = await shareOrCopy(content());
    setBusy(false);
    if (outcome === "copied") toast.success(t.share.copied);
    else if (outcome === "failed") toast.error(t.share.failed);
  }
  const button = (
    <Button variant="secondary" onClick={share} disabled={busy} icon={<IconShare className="size-4" aria-hidden />} className={qr ? undefined : className}>
      {label}
    </Button>
  );
  if (!qr) return button;
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {button}
      <IconButton
        label={t.share.qr.show}
        aria-haspopup="dialog"
        onClick={() => setQrContent(content())}
        // Gleiche Glas-Optik wie der Teilen-Knopf (Klassen aus `secondary`, kein neues CSS).
        className="border border-white/15 bg-white/[0.07] backdrop-blur-md hover:border-white/30 hover:bg-white/[0.11]"
      >
        <IconQr className="size-5" aria-hidden />
      </IconButton>
      <Dialog open={qrContent !== null} onClose={() => setQrContent(null)} title={t.share.qr.title} size="sm">
        {qrContent && (
          <div className="space-y-3">
            <div className="mx-auto w-full" style={{ maxWidth: 280 }}>
              <Suspense fallback={<Skeleton className="aspect-square w-full" />}>
                <QrCode value={qrContent.url} label={t.share.qr.label(qrContent.title)} fallback={<FormMessage>{t.share.qr.tooLong}</FormMessage>} />
              </Suspense>
            </div>
            <p className="text-center text-sm font-semibold text-fg">{qrContent.title}</p>
            <p className="text-center text-[13px] leading-snug text-muted">{t.share.qr.hint}</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
