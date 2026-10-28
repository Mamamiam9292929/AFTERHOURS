import { useEffect, useRef, useState } from "react";
import { IconAlert, IconMap, IconMinus, IconPlus } from "@/components/icons";
import { t } from "@/i18n";
import { mapProvider, mapTilesAllowed, setMapTilesAllowed } from "@/lib/maps";
import { clampZoom, FIT_MAX_ZOOM, MAX_ZOOM, visibleTiles, type GeoPoint } from "@/lib/tiles";

/**
 * P6 Etappe 3 · Kleiner Stadtplan für genau einen Ort (Planseite): Wo ist das, was ist drumherum?
 * Gleiche Einwilligung wie die Karte in Discover („Stadtplan laden“, gilt für dieses Gerät) – vorher geht
 * keine Anfrage an OpenStreetMap, stattdessen steht ein Knopf da. Ohne Ziehen, nur näher/weiter.
 */
export function SpotMap({ point, name, demo = false }: { point: GeoPoint; name: string; demo?: boolean }) {
  const [allowed, setAllowed] = useState(mapTilesAllowed);
  const [zoom, setZoom] = useState(FIT_MAX_ZOOM);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tiles, setTiles] = useState({ loaded: 0, failed: 0 });

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [allowed]);

  if (!allowed) {
    return (
      <div className="mt-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3" data-testid="spot-map-offer">
        <button
          type="button"
          onClick={() => {
            setMapTilesAllowed(true);
            setAllowed(true);
          }}
          className="flex min-h-11 w-full items-center gap-2 rounded-full text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
        >
          <IconMap className="size-4 shrink-0 text-lime" aria-hidden />
          {t.discover.spot.show}
        </button>
        <p className="mt-1 text-[13px] leading-snug text-faint">{t.discover.map.tilesPrivacy}</p>
      </div>
    );
  }

  const view = { center: point, zoom };
  const visible = size.width > 0 ? visibleTiles(view, size.width, size.height) : [];
  const down = tiles.failed > 0 && tiles.loaded === 0;
  const change = (step: number) => {
    setTiles({ loaded: 0, failed: 0 });
    setZoom((z) => Math.min(MAX_ZOOM, clampZoom(z + step)));
  };

  return (
    <div className="mt-3 space-y-2" data-testid="spot-map">
      <div
        ref={frame}
        role="group"
        aria-label={t.discover.spot.label(name)}
        data-zoom={zoom}
        className="map-frame relative overflow-hidden rounded-card border border-white/[0.08]"
        style={{ height: 176 }}
      >
        <div className="map-tiles pointer-events-none absolute inset-0" aria-hidden>
          {visible.map((tile) => (
            <img
              key={tile.key}
              src={mapProvider.tileUrl(tile.z, tile.x, tile.y)}
              alt=""
              width={256}
              height={256}
              draggable={false}
              decoding="async"
              data-map-tile=""
              className="absolute size-64 max-w-none"
              style={{ left: Math.round(tile.left), top: Math.round(tile.top) }}
              onLoad={() => setTiles((s) => ({ ...s, loaded: s.loaded + 1 }))}
              onError={() => setTiles((s) => ({ ...s, failed: s.failed + 1 }))}
            />
          ))}
        </div>
        {/* Der Ort: Lime-Punkt mit Schein in der Mitte. */}
        {/* Stile inline, damit das Start-CSS nicht wächst. */}
        <span
          aria-hidden
          className="pointer-events-none absolute z-10 block size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base bg-lime"
          style={{ left: "50%", top: "50%", boxShadow: "0 0 0 2px var(--color-lime), 0 0 18px 8px color-mix(in srgb, var(--color-lime) 35%, transparent)" }}
        />
        <div className="absolute right-3 top-3 z-40 flex flex-col gap-2">
          <SpotButton label={t.discover.map.zoomIn} disabled={zoom >= MAX_ZOOM} onClick={() => change(1)}>
            <IconPlus className="size-4" aria-hidden />
          </SpotButton>
          <SpotButton label={t.discover.map.zoomOut} disabled={zoom <= 11} onClick={() => change(-1)}>
            <IconMinus className="size-4" aria-hidden />
          </SpotButton>
        </div>
        {down && (
          <p className="glass absolute left-3 top-3 z-40 mr-16 flex items-center gap-2 rounded-2xl border border-amber/40 px-3 py-2 text-[13px] leading-snug text-fg" role="status">
            <IconAlert className="size-4 shrink-0 text-amber" aria-hidden />
            {t.discover.spot.failed}
          </p>
        )}
        <a
          href={mapProvider.copyrightUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="glass absolute bottom-2 right-2 z-40 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-fg hover:border-lime"
        >
          {mapProvider.attribution}
        </a>
      </div>
      {demo && <p className="text-[13px] text-amber">{t.discover.detail.mapDemo}</p>}
      <p className="text-[13px] leading-snug text-faint">
        {t.discover.map.tilesOn}{" "}
        <button
          type="button"
          onClick={() => {
            setMapTilesAllowed(false);
            setAllowed(false);
          }}
          className="underline decoration-line-strong underline-offset-4 hover:text-fg"
        >
          {t.discover.map.tilesOff}
        </button>
      </p>
    </div>
  );
}

function SpotButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="glass inline-flex size-11 items-center justify-center rounded-full border border-white/15 text-fg transition-colors hover:border-lime focus-visible:outline-2 focus-visible:outline-lime disabled:opacity-45"
    >
      {children}
    </button>
  );
}
