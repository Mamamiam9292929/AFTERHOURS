import { useMemo, type ReactNode } from "react";
import { qrMatrix, qrPath } from "@/lib/qr";

/**
 * W9 · QR-Code als SVG, im Browser erzeugt (`src/lib/qr.ts`) – kein Bild von einem Dienst, niemand außer dem
 * Gerät sieht den Inhalt. Immer dunkel auf Weiß mit Ruhezone von 4 Modulen, damit jede Kamera ihn liest –
 * unabhängig vom dunklen Design. Ist der Text zu lang, rendert die Komponente nichts (`fallback`). Eigener
 * Chunk: Der Einladungsdialog lädt sie erst beim Tipp auf „Als QR-Code zeigen“ (default-Export für `lazy`).
 */
export function QrCode({ value, label, fallback = null }: { value: string; label: string; fallback?: ReactNode }) {
  const matrix = useMemo(() => qrMatrix(value), [value]);
  if (!matrix) return <>{fallback}</>;
  const size = matrix.length + 8;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="qr-code"
      data-modules={matrix.length}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      // Inline statt Tailwind-Klassen: Der Baustein lädt nur bei Bedarf, das Start-CSS wächst nicht.
      style={{ display: "block", width: "100%", aspectRatio: "1", borderRadius: 16, background: "#fff" }}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(matrix)} fill="#000" />
    </svg>
  );
}

export default QrCode;
