import { useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

/** Gedeckte Töne, die neben Lime bestehen, ohne mit ihm zu konkurrieren. */
const TINTS = ["#3d4a2c", "#2c4a4a", "#4a3a55", "#56432e", "#2e3f5e", "#54353b", "#3f4a3f", "#4b3f2f"];

function tintFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length] ?? "#3d4a2c";
}

const sizes = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
  xl: "size-24 text-3xl",
} as const;

export interface Person {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

interface AvatarProps {
  person: Person | null | undefined;
  size?: keyof typeof sizes;
  className?: string;
  /** Dekorativ, wenn der Name direkt daneben steht. */
  decorative?: boolean;
}

export function Avatar({ person, size = "md", className, decorative = false }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const name = person?.display_name ?? t.states.formerMember;
  const showImage = Boolean(person?.avatar_url) && !broken;
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-fg ring-2 ring-[var(--avatar-ring,transparent)]",
        sizes[size],
        className,
      )}
      style={showImage ? undefined : { backgroundColor: tintFor(person?.id ?? "none") }}
    >
      {showImage ? (
        <img src={person?.avatar_url ?? undefined} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span aria-hidden>{person ? initials(name) : "?"}</span>
      )}
    </span>
  );
}

interface AvatarStackProps {
  people: (Person | null | undefined)[];
  max?: number;
  size?: "xs" | "sm" | "md";
  /** Hintergrund hinter dem Stapel – als Trennring zwischen den Avataren. */
  ringColor?: string;
  className?: string;
}

/** Überlappende Avatare mit "+n". Der Stapel hat einen gemeinsamen zugänglichen Namen. */
export function AvatarStack({ people, max = 5, size = "sm", ringColor = "var(--color-surface)", className }: AvatarStackProps) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const names = people.map((p) => p?.display_name ?? t.states.formerMember).join(", ");
  return (
    <span role="img" aria-label={names} title={names} className={cn("inline-flex items-center", className)} style={{ ["--avatar-ring" as string]: ringColor }}>
      {shown.map((person, index) => (
        <Avatar key={person?.id ?? `former-${index}`} person={person} size={size} decorative className={cn(index > 0 && (size === "xs" ? "-ml-1.5" : "-ml-2"))} />
      ))}
      {rest > 0 && (
        <span className={cn("-ml-2 inline-flex items-center justify-center rounded-full bg-raised font-semibold text-muted ring-2 ring-[var(--avatar-ring)]", sizes[size])} aria-hidden>
          +{rest}
        </span>
      )}
    </span>
  );
}
