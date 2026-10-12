import { Dialog as HeadlessDialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from "@headlessui/react";
import type { ReactNode } from "react";
import { IconClose } from "@/components/icons";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "./Button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

/**
 * Modaler Dialog: auf dem Smartphone ein Sheet vom unteren Rand, ab Tablet mittig.
 * Fokusfalle, Escape und Rückgabe des Fokus übernimmt Headless UI.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: DialogProps) {
  return (
    <HeadlessDialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/70 motion-safe:animate-[fade-in_150ms_ease-out]" />
      <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-6">
        <DialogPanel
          className={cn(
            "flex max-h-[92dvh] w-full flex-col rounded-t-[24px] border border-line bg-base shadow-2xl shadow-black/60 sm:rounded-[24px]",
            "motion-safe:animate-[sheet-in_220ms_var(--ease-out-soft)]",
            size === "sm" && "sm:max-w-sm",
            size === "md" && "sm:max-w-lg",
            size === "lg" && "sm:max-w-2xl",
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div className="min-w-0 pt-1.5">
              <DialogTitle className="display text-[28px] text-fg">{title}</DialogTitle>
              {description && <Description className="mt-2 text-sm leading-snug text-muted">{description}</Description>}
            </div>
            <IconButton label={t.actions.close} onClick={onClose} className="-mr-2 -mt-1">
              <IconClose className="size-5" aria-hidden />
            </IconButton>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>}
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6">{footer}</div>}
        </DialogPanel>
      </div>
    </HeadlessDialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  error?: string | null;
}

/** Rückfrage vor Aktionen, die sich nicht rückgängig machen lassen. Der Button benennt die Aktion. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, destructive, loading, error }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {t.actions.cancel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : undefined}
    </Dialog>
  );
}
