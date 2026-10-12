import { Switch as HeadlessSwitch } from "@headlessui/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SwitchRowProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Schalter mit Beschriftung; die ganze Zeile ist die Trefferfläche. */
export function SwitchRow({ label, description, checked, onChange, disabled }: SwitchRowProps) {
  return (
    <label className={cn("flex min-h-13 cursor-pointer items-center justify-between gap-4 py-2.5", disabled && "cursor-not-allowed opacity-50")}>
      <span className="min-w-0">
        <span className="block font-medium text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{description}</span>}
      </span>
      <HeadlessSwitch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="group relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-line-strong transition-colors data-[checked]:bg-lime"
      >
        <span className="inline-block size-5 translate-x-1 rounded-full bg-fg transition-transform group-data-[checked]:translate-x-6 group-data-[checked]:bg-lime-ink" />
      </HeadlessSwitch>
    </label>
  );
}

interface ChipProps {
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Auswahl-Chip (Mehrfachauswahl). */
export function Chip({ selected, onToggle, children, icon, className }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "inline-flex h-10 shrink-0 snap-start items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors",
        selected ? "border-lime bg-lime text-lime-ink" : "border-line-strong bg-transparent text-fg hover:border-faint",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
  className?: string;
}

/** Umschalter zwischen Ansichten derselben Liste. */
export function Segmented<T extends string>({ label, value, onChange, options, className }: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1", className)}
      onKeyDown={(event) => {
        // Pfeiltasten wechseln den Reiter (übliches Tastaturmuster für Tabs).
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const index = options.findIndex((option) => option.value === value);
        const next = options[(index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
        if (!next) return;
        event.preventDefault();
        onChange(next.value);
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons[options.indexOf(next)]?.focus();
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors",
              active ? "bg-fg text-nav" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
            {option.count != null && option.count > 0 && (
              <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-nav/15" : "bg-raised")}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
