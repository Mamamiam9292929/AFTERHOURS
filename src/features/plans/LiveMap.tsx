import { useEffect, useRef, useState } from "react";
import { IconMap, IconMinus, IconPlus } from "@/components/icons";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { spreadMarkers, type LivePoint } from "@/lib/live";
import { mapProvider, mapTilesAllowed, setMapTilesAllowed } from "@/lib/maps";
import { clampZoom, fitView, MAX_ZOOM, MIN_ZOOM, toScreen, visibleTiles } from "@/lib/tiles";

export interface LiveMapPerson {
  userId: string;
  point: LivePoint;
  person: Person | null;
  mine: boolean;
  stale: boolean;
}

const HEIGHT = 208;
const PADDING = 36;

/**
 * P13 Etappe 2a · „Wo seid ihr?“ auf einem kleinen Stadtplan: der Ort als Lime-Punkt, alle, die teilen, als
 * Profilbild. Ohne Einwilligung „Stadtplan laden“ (dieselbe wie in Discover und beim Ort) nur auf dem Raster –
 * so geht keine Anfrage an OpenStreetMap, die Lage zueinander ist trotzdem zu sehen. Die Namen stehen in der
 * Liste darunter; hier sind die Marker nur Bild (Screenreader bekommen eine Zusammenfassung).
 */
export function LiveMap({ place, placeName, people }: { place: LivePoint | null; placeName: string | null; people: LiveMapPerson[] }) {
  const [tilesOn, setTilesOn] = useState(mapTilesAllowed);
  const [zoomStep, setZoomStep] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tiles, setTiles] = useState({ loaded: 0, failed: 0 });

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const points = [...(place ? [place] : []), ...people.map((p) => p.point)];
  const fit = width > 0 ? fitView(points, width, HEIGHT, PADDING) : null;
  const view = fit ? { center: fit.center, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, clampZoom(fit.zoom + zoomStep))) } : null;
  const visible = view && tilesOn ? visibleTiles(view, width, HEIGHT) : [];
  const placePixel = view && place ? toScreen(place, view, width, HEIGHT) : null;
  const spread = view ? spreadMarkers(people.map((p) => toScreen(p.point, view, width, HEIGHT))) : [];
  const down = tilesOn && tiles.failed > 0 && tiles.loaded === 0;

  const change = (step: number) => {
    setTiles({ loaded: 0, failed: 0 });
    setZoomStep((s) => s + step);
  };
  const toggleTiles = (on: boolean) => {
    setMapTilesAllowed(on);
    setTiles({ loaded: 0, failed: 0 });
    setTilesOn(on);
  };

  return (
    <div className="space-y-2" data-testid="live-map">
      <div
        ref={frame}
        role="group"
        aria-label={t.plans.live.map.label(people.length, placeName)}
        data-zoom={view?.zoom}
        data-tiles={tilesOn || undefined}
        className="map-frame relative overflow-hidden rounded-card border border-white/[0.08]"
        style={{ height: HEIGHT }}
      >
        {tilesOn && (
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
        )}
        {placePixel && (
          <span
            aria-hidden
            data-testid="live-map-place"
            className="pointer-events-none absolute z-10 block size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base bg-lime"
            style={{ left: placePixel.x, top: placePixel.y, boxShadow: "0 0 0 2px var(--color-lime), 0 0 16px 6px color-mix(in srgb, var(--color-lime) 35%, transparent)" }}
          />
        )}
        {people.map((p, i) => {
          const at = spread[i];
          if (!at) return null;
          return (
            <span
              key={p.userId}
              aria-hidden
              data-testid="live-marker"
              data-mine={p.mine || undefined}
              data-stale={p.stale || undefined}
              className={cn(
                "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full p-[2px] shadow-[0_4px_14px_rgba(0,0,0,0.55)]",
                p.mine ? "z-30 bg-lime" : "z-20 bg-violet",
                p.stale && "opacity-55 grayscale",
              )}
              style={{ left: at.x, top: at.y }}
            >
              <Avatar person={p.person} size="sm" decorative className="ring-0" />
            </span>
          );
        })}
        <div className="absolute right-3 top-3 z-40 flex flex-col gap-2">
          <MapButton label={t.discover.map.zoomIn} disabled={!view || view.zoom >= MAX_ZOOM} onClick={() => change(1)}>
            <IconPlus className="size-4" aria-hidden />
          </MapButton>
          <MapButton label={t.discover.map.zoomOut} disabled={!view || !fit || view.zoom <= Math.min(11, fit.zoom)} onClick={() => change(-1)}>
            <IconMinus className="size-4" aria-hidden />
          </MapButton>
        </div>
        {down && (
          <p className="glass absolute left-3 top-3 z-40 mr-16 rounded-2xl border border-amber/40 px-3 py-2 text-[13px] leading-snug text-fg" role="status">
            {t.discover.spot.failed}
          </p>
        )}
        {tilesOn && (
          <a
            href={mapProvider.copyrightUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="glass absolute bottom-2 right-2 z-40 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-fg hover:border-lime"
          >
            {mapProvider.attribution}
          </a>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted" aria-hidden>
        {place && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-lime" />
            {t.plans.live.map.legendPlace}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-lime" />
          {t.plans.live.map.legendYou}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-violet" />
          {t.plans.live.map.legendOthers}
        </span>
      </div>
      {tilesOn ? (
        <p className="text-[13px] leading-snug text-faint">
          {t.discover.map.tilesOn}{" "}
          <button type="button" onClick={() => toggleTiles(false)} className="underline decoration-line-strong underline-offset-4 hover:text-fg">
            {t.discover.map.tilesOff}
          </button>
        </p>
      ) : (
        <div data-testid="live-map-offer">
          <button
            type="button"
            onClick={() => toggleTiles(true)}
            className="flex min-h-11 items-center gap-2 rounded-full text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
          >
            <IconMap className="size-4 shrink-0 text-lime" aria-hidden />
            {t.plans.live.map.loadTiles}
          </button>
          <p className="text-[13px] leading-snug text-faint">{t.discover.map.tilesPrivacy}</p>
        </div>
      )}
    </div>
  );
}

function MapButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
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
