import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

const controlClass =
  "block w-full rounded-control border border-line bg-surface px-3.5 text-fg placeholder:text-faint " +
  "transition-colors hover:border-line-strong focus:border-lime focus:outline-none focus-visible:outline-none " +
  "aria-[invalid=true]:border-danger disabled:opacity-50";

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  /** Erhält id und aria-Attribute für das eigentliche Bedienelement. */
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}

/** Beschriftung, Hinweis und Fehlermeldung – korrekt mit dem Feld verknüpft. */
export function Field({ label, hint, error, optional, className, children }: FieldShellProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-sm font-medium text-fg">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-faint">{t.states.optional}</span>}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[13px] leading-snug text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[13px] leading-snug text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  fieldClassName?: string;
  trailing?: ReactNode;
};

export function TextField({ label, hint, error, optional, className, fieldClassName, trailing, ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={fieldClassName}>
      {(a11y) => (
        <div className="relative">
          <input className={cn(controlClass, "h-12", trailing && "pr-12", className)} {...a11y} {...rest} />
          {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
        </div>
      )}
    </Field>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  fieldClassName?: string;
};

export function TextAreaField({ label, hint, error, optional, className, fieldClassName, rows = 3, ...rest }: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={fieldClassName}>
      {(a11y) => <textarea rows={rows} className={cn(controlClass, "resize-y py-3 leading-snug", className)} {...a11y} {...rest} />}
    </Field>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  fieldClassName?: string;
};

export function SelectField({ label, hint, error, optional, className, fieldClassName, children, ...rest }: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={fieldClassName}>
      {(a11y) => (
        <select
          className={cn(
            controlClass,
            "h-12 appearance-none bg-[length:16px] bg-[right_0.9rem_center] bg-no-repeat pr-10",
            "bg-[url('data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23a9aeaa%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')]",
            className,
          )}
          {...a11y}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

/** Fehler- oder Hinweiszeile für ganze Formulare. */
export function FormMessage({ tone = "error", children }: { tone?: "error" | "info" | "success"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-control border px-3.5 py-3 text-sm leading-snug",
        tone === "error" && "border-danger/40 bg-danger/10 text-danger",
        tone === "info" && "border-line bg-surface text-muted",
        tone === "success" && "border-lime/40 bg-lime/10 text-lime",
      )}
    >
      {children}
    </p>
  );
}
