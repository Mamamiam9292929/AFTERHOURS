import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ActivityCategory } from "@/lib/types";

/**
 * Piktogramm-Cover pro Kategorie. Solange ein Ort kein eigenes Foto mitbringt (image_url), steht
 * statt eines beliebigen Stockfotos eine klare, einheitliche Grafik: graue Linien, ein Lime-Akzent.
 */
const L = "var(--art-line)";
const A = "var(--color-lime)";
const stroke = { fill: "none", stroke: L, strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const accent = { fill: "none", stroke: A, strokeWidth: 3.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ART: Record<ActivityCategory, ReactNode> = {
  restaurant: (
    <>
      <circle cx="160" cy="100" r="56" {...stroke} />
      <circle cx="160" cy="100" r="36" {...stroke} />
      <path d="M72 52v36c0 8 5 12 10 12v48M62 52v30M82 52v30" {...stroke} />
      <path d="M250 148V52c-12 8-16 28-16 46h16" {...stroke} />
      <circle cx="172" cy="90" r="9" fill={A} />
    </>
  ),
  cafe: (
    <>
      <path d="M104 92h96v34a34 34 0 0 1-34 34h-28a34 34 0 0 1-34-34z" {...stroke} />
      <path d="M200 102h12a16 16 0 0 1 0 32h-12" {...stroke} />
      <path d="M88 172h128" {...stroke} />
      <path d="M130 72c-8-10 8-16 0-28M152 72c-8-10 8-16 0-28M174 72c-8-10 8-16 0-28" {...accent} />
    </>
  ),
  bar: (
    <>
      <path d="M104 52h112l-56 62z" {...stroke} />
      <path d="M160 114v48M128 164h64" {...stroke} />
      <path d="M124 74h72" {...stroke} />
      <circle cx="212" cy="50" r="15" {...accent} />
      <path d="M212 35v30M197 50h30" {...accent} strokeWidth={2} />
    </>
  ),
  cinema: (
    <>
      <path d="M78 100 246 48v104z" fill={A} opacity="0.16" />
      <path d="M78 100 246 48M78 100l168 52" {...stroke} />
      <rect x="246" y="40" width="12" height="120" rx="4" {...stroke} />
      <circle cx="66" cy="100" r="18" {...stroke} />
      <circle cx="66" cy="100" r="5" fill={A} />
    </>
  ),
  bowling: (
    <>
      <circle cx="118" cy="110" r="48" {...stroke} />
      <circle cx="104" cy="92" r="6" fill={A} />
      <circle cx="126" cy="86" r="6" fill={A} />
      <circle cx="122" cy="110" r="6" fill={A} />
      <path d="M214 54c-8 0-10 8-8 16 2 8-10 20-10 44 0 20 6 38 10 44h16c4-6 10-24 10-44 0-24-12-36-10-44 2-8 0-16-8-16z" {...stroke} />
      <path d="M204 84h20" {...stroke} />
    </>
  ),
  minigolf: (
    <>
      <path d="M52 152c50-22 166-22 216 0" {...stroke} />
      <ellipse cx="196" cy="146" rx="20" ry="7" {...stroke} />
      <path d="M196 144V50" {...stroke} />
      <path d="M196 52l44 15-44 15z" fill={A} />
      <circle cx="112" cy="140" r="9" {...stroke} />
    </>
  ),
  swimming: (
    <>
      <path d="M48 84c18-14 36-14 54 0s36 14 54 0 36-14 54 0 36 14 54 0" {...stroke} />
      <path d="M48 116c18-14 36-14 54 0s36 14 54 0 36-14 54 0 36 14 54 0" {...accent} />
      <path d="M48 148c18-14 36-14 54 0s36 14 54 0 36-14 54 0 36 14 54 0" {...stroke} />
      <circle cx="232" cy="52" r="14" {...stroke} />
    </>
  ),
  lasertag: (
    <>
      <path d="M44 150 276 60M44 60l232 76" {...stroke} />
      <path d="M52 104h216" {...accent} />
      <circle cx="160" cy="104" r="30" {...stroke} />
      <circle cx="160" cy="104" r="8" fill={A} />
    </>
  ),
  escape_room: (
    <>
      <rect x="104" y="36" width="112" height="136" rx="8" {...stroke} />
      <circle cx="160" cy="92" r="16" fill={A} />
      <path d="M152 100h16l6 34h-28z" fill={A} />
      <path d="M88 172h144" {...stroke} />
    </>
  ),
  karting: (
    <>
      <path d="M48 150c40 0 44-62 96-62s52 44 128 44" {...accent} />
      <path d="M48 124c30 0 36-62 96-62s62 44 128 44" {...stroke} strokeDasharray="2 12" />
      <path d="M214 36v60" {...stroke} />
      <path d="M214 38h44v28h-44z" {...stroke} />
      <path d="M214 38h15v14h-15zM229 52h15v14h-15zM244 38h14v14h-14z" fill={L} />
    </>
  ),
  sport: (
    <>
      <rect x="56" y="44" width="208" height="112" rx="6" {...stroke} />
      <path d="M160 44v112" {...stroke} />
      <circle cx="160" cy="100" r="26" {...stroke} />
      <path d="M56 76h26v48H56M264 76h-26v48h26" {...stroke} />
      <circle cx="204" cy="82" r="9" fill={A} />
    </>
  ),
  outdoor: (
    <>
      <path d="M40 156 116 60l42 54 24-30 98 72z" {...stroke} />
      <path d="M100 80l16-20 16 20" {...stroke} />
      <circle cx="232" cy="56" r="17" fill={A} />
    </>
  ),
  concert: (
    <>
      {[60, 88, 116, 144, 172, 200, 228, 256].map((x, i) => {
        const h = [48, 86, 62, 118, 94, 136, 70, 40][i] ?? 60;
        return <rect key={x} x={x - 8} y={164 - h} width="16" height={h} rx="8" fill={i === 5 ? A : "none"} stroke={i === 5 ? A : L} strokeWidth="3" />;
      })}
    </>
  ),
  event: (
    <>
      <path d="M76 148l34-74 40 40z" {...stroke} />
      <path d="M134 74c0-16 12-28 28-28M150 96c14-18 40-22 60-10M160 122c22-8 46 0 60 18" {...stroke} />
      <circle cx="232" cy="64" r="7" fill={A} />
      <circle cx="196" cy="42" r="5" fill={A} />
      <path d="M244 110l10 6M226 150l4 10" {...accent} />
      <circle cx="252" cy="140" r="5" {...stroke} />
    </>
  ),
  trip: (
    <>
      <path d="M78 148c20-50 70-10 92-52s54-20 72-44" {...stroke} strokeDasharray="3 13" />
      <path d="M78 150c-14-16-20-26-20-36a20 20 0 0 1 40 0c0 10-6 20-20 36z" {...stroke} />
      <circle cx="78" cy="114" r="6" {...stroke} />
      <path d="M242 62c-15-17-22-28-22-39a22 22 0 0 1 44 0c0 11-7 22-22 39z" fill={A} />
      <circle cx="242" cy="23" r="7" fill="var(--color-surface)" />
    </>
  ),
  other: (
    <>
      <rect x="86" y="62" width="84" height="84" rx="16" {...stroke} transform="rotate(-10 128 104)" />
      <circle cx="110" cy="88" r="6" fill={L} />
      <circle cx="146" cy="120" r="6" fill={L} />
      <circle cx="128" cy="104" r="6" fill={A} />
      <rect x="174" y="78" width="68" height="68" rx="14" {...stroke} transform="rotate(14 208 112)" />
      <circle cx="196" cy="100" r="5" fill={L} />
      <circle cx="220" cy="124" r="5" fill={L} />
    </>
  ),
};

export function CategoryArt({ category, className }: { category: ActivityCategory; className?: string }) {
  return (
    <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" className={cn("size-full bg-raised [--art-line:#5d646b]", className)} aria-hidden focusable="false">
      {ART[category]}
    </svg>
  );
}
