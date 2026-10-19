import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { IconSpinner } from "@/components/icons";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold leading-none select-none " +
  "transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const variants: Record<Variant, string> = {
  primary: "bg-lime text-lime-ink shadow-[0_14px_30px_-14px_var(--color-lime)] hover:bg-lime-press active:bg-lime-press",
  secondary: "border border-white/15 bg-white/[0.07] text-fg backdrop-blur-md hover:border-white/30 hover:bg-white/[0.11] active:bg-white/[0.05]",
  ghost: "text-fg hover:bg-raised active:bg-raised",
  danger: "border border-danger/45 bg-danger/10 text-danger hover:bg-danger/20 active:bg-danger/20",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-13 px-6 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Zeigt einen Spinner und sperrt den Button, ohne dass sich seine Breite ändert. */
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({ variant = "primary", size = "md", loading = false, icon, block, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, cn(block && "w-full", className))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <IconSpinner className="size-[1.1em] animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

export function ButtonLink({ variant = "primary", size = "md", icon, block, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, cn(block && "w-full", className))} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Pflicht: Icon-Buttons brauchen einen zugänglichen Namen. */
  label: string;
  variant?: "ghost" | "secondary";
}

export function IconButton({ label, variant = "ghost", className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg transition-colors disabled:opacity-45",
        variant === "ghost" ? "hover:bg-raised" : "border border-line-strong bg-raised hover:border-faint",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
