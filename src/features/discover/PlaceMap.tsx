import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { IconAlert, IconFit, IconMap, IconMinus, IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Feedback";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import type { PlacePhoto } from "@/lib/commons";
import type { LatLng } from "@/lib/geo";
import { mapProvider, mapTilesAllowed, setMapTilesAllowed } from "@/lib/maps";
import { categoryWorld, type CategoryWorld } from "@/lib/stage";
import { fitView, isGeoPoint, panBy, toScreen, visibleTiles, zoomBy, type GeoPoint, type MapView } from "@/lib/tiles";
import { ActivityCard } from "./ActivityCard";
import type { RankedActivity } from "./api";

/** Punktfarbe je Farbwelt der Kategorie – dieselben vier Lichter wie die Karten in Discover. */
const PIN: Record<CategoryWorld, string> = {
  food: "bg-amber",
  night: "bg-pink",
  play: "bg-violet",
  outside: "bg-lime",
};

/** Rand um die Punkte beim Einpassen, damit kein Punkt unter den Knöpfen am Rand liegt. */
const PADDING = 44;
/** Ein Tipp, der weniger als so viele Pixel wandert, ist ein Tipp und kein Ziehen. */
const DRAG_THRESHOLD = 5;
const PAN_STEP = 96;
const GRID = 48;

interface Placed {
  ranked: RankedActivity;
  point: GeoPoint;
}

/**
 * P6 · Karte in Discover. Ohne Einwilligung zeichnet sie nur die Punkte der Orte auf dunklem Raster – dafür geht
 * keine Anfrage an Dritte. „Stadtplan laden“ legt die Kacheln von OpenStreetMap darunter (gilt für dieses Gerät).
 * Ziehen verschiebt, Plus/Minus zoomt; ein Tipp auf einen Punkt zeigt den Ort als Karte darunter.
 */
export function PlaceMap({ results, cityName, fallback, photos }: { results: RankedActivity[]; cityName: string; fallback: LatLng | null; photos: ReadonlyMap<string, PlacePhoto> }) {
  const placed = useMemo<Placed[]>(
    () => results.flatMap((ranked) => (isGeoPoint(ranked.activity) ? [{ ranked, point: { latitude: ranked.activity.latitude, longitude: ranked.activity.longitude } }] : [])),
    [results],
  );
  const missing = results.length - placed.length;
  const pointsKey = useMemo(() => placed.map((p) => p.ranked.activity.id).join(","), [placed]);

  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const noneWithLocation = results.length > 0 && placed.length === 0;
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [noneWithLocation]);

  // Eingepasster Ausschnitt; verschiebt oder zoomt man, gilt der eigene – bis sich die Auswahl der Orte ändert.
  const fitted = useMemo(
    () => (size.width > 0 ? fitView(placed.map((p) => p.point), size.width, size.height, PADDING, fallback) : null),
    // Neu einpassen nur bei anderer Auswahl (pointsKey) oder Größe – nicht bei jedem neuen Ergebnis-Objekt.
    [pointsKey, size.width, size.height],
  );
  const [manual, setManual] = useState<{ key: string; view: MapView } | null>(null);
  const view = manual && manual.key === pointsKey ? manual.view : fitted;
  const move = (change: (current: MapView) => MapView) =>
    setManual((prev) => {
      const current = prev && prev.key === pointsKey ? prev.view : fitted;
      return current ? { key: pointsKey, view: change(current) } : prev;
    });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = placed.find((p) => p.ranked.activity.id === selectedId) ?? null;

  const [tilesOn, setTilesOn] = useState(mapTilesAllowed);
  const [tileState, setTileState] = useState({ loaded: 0, failed: 0 });
  const toggleTiles = (on: boolean) => {
    setMapTilesAllowed(on);
    setTilesOn(on);
    setTileState({ loaded: 0, failed: 0 });
  };

  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      dragged.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    d.x = e.clientX;
    d.y = e.clientY;
    move((current) => panBy(current, -dx, -dy));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const pan: Record<string, [number, number]> = { ArrowLeft: [-PAN_STEP, 0], ArrowRight: [PAN_STEP, 0], ArrowUp: [0, -PAN_STEP], ArrowDown: [0, PAN_STEP] };
    const step = pan[e.key];
    if (step) move((current) => panBy(current, step[0], step[1]));
    else if (e.key === "+" || e.key === "=") move((current) => zoomBy(current, 1));
    else if (e.key === "-") move((current) => zoomBy(current, -1));
    else return;
    e.preventDefault();
  };

  if (noneWithLocation) {
    return <EmptyState icon={<IconMap className="size-6" aria-hidden />} title={t.discover.map.noneTitle} body={t.discover.map.noneBody} />;
  }

  const tiles = view && tilesOn ? visibleTiles(view, size.width, size.height) : [];
  const tilesDown = tilesOn && tileState.failed > 0 && tileState.loaded === 0;
  // Raster ohne Stadtplan wandert beim Ziehen mit – so fühlt sich die Karte auch ohne Kacheln wie eine Karte an.
  const gridOffset = view ? toScreen({ latitude: 0, longitude: 0 }, view, size.width, size.height) : { x: 0, y: 0 };
  const pins = view
    ? placed
        .map((p) => ({ ...p, at: toScreen(p.point, view, size.width, size.height) }))
        .filter(({ at }) => at.x > -20 && at.y > -20 && at.x < size.width + 20 && at.y < size.height + 20)
        // Der gewählte Punkt liegt obenauf.
        .sort((a, b) => Number(a.ranked.activity.id === selectedId) - Number(b.ranked.activity.id === selectedId))
    : [];

  return (
    <div className="space-y-4" data-testid="place-map">
      <div
        ref={frame}
        role="region"
        aria-label={t.discover.map.label(cityName)}
        aria-describedby="place-map-keys"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="map-frame relative h-[440px] touch-none select-none overflow-hidden rounded-card border border-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime sm:h-[520px]"
        style={{ "--grid-x": `${(((gridOffset.x % GRID) + GRID) % GRID).toFixed(1)}px`, "--grid-y": `${(((gridOffset.y % GRID) + GRID) % GRID).toFixed(1)}px` } as CSSProperties}
      >
        <p id="place-map-keys" className="sr-only">
          {t.discover.map.keys}
        </p>
        {tiles.length > 0 && (
          <div className="map-tiles pointer-events-none absolute inset-0" aria-hidden>
            {tiles.map((tile) => (
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
                onLoad={() => setTileState((s) => ({ ...s, loaded: s.loaded + 1 }))}
                onError={() => setTileState((s) => ({ ...s, failed: s.failed + 1 }))}
              />
            ))}
          </div>
        )}

        {pins.map(({ ranked, at }) => {
          const { activity } = ranked;
          const active = activity.id === selectedId;
          return (
            <button
              key={activity.id}
              type="button"
              tabIndex={-1}
              aria-pressed={active}
              aria-label={t.discover.map.pin(activity.name, t.enums.category[activity.category])}
              data-map-pin={activity.name}
              onClick={() => {
                if (dragged.current) return;
                setSelectedId(active ? null : activity.id);
              }}
              className="absolute z-10 inline-flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
              style={{ left: at.x, top: at.y, zIndex: active ? 20 : undefined }}
            >
              <span
                className={cn(
                  "block rounded-full border-2 border-base transition-transform duration-200",
                  PIN[categoryWorld(activity.category)],
                  active ? "size-5 ring-2 ring-fg" : "size-3.5 hover:scale-125",
                )}
                aria-hidden
              />
            </button>
          );
        })}
        {selected &&
          view &&
          (() => {
            const at = toScreen(selected.point, view, size.width, size.height);
            return (
              <span
                className="glass pointer-events-none absolute z-30 max-w-[60%] -translate-x-1/2 truncate rounded-full border border-white/15 px-3 py-1 text-[13px] font-semibold text-fg"
                style={{ left: at.x, top: at.y - 34 }}
                aria-hidden
              >
                {selected.ranked.activity.name}
              </span>
            );
          })()}

        <div className="absolute right-3 top-3 z-40 flex flex-col gap-2">
          <MapButton label={t.discover.map.zoomIn} onClick={() => move((current) => zoomBy(current, 1))}>
            <IconPlus className="size-5" aria-hidden />
          </MapButton>
          <MapButton label={t.discover.map.zoomOut} onClick={() => move((current) => zoomBy(current, -1))}>
            <IconMinus className="size-5" aria-hidden />
          </MapButton>
          <MapButton label={t.discover.map.fit} onClick={() => setManual(null)}>
            <IconFit className="size-5" aria-hidden />
          </MapButton>
        </div>

        {tilesDown && (
          <p className="glass absolute left-3 top-3 z-40 mr-16 flex items-center gap-2 rounded-2xl border border-amber/40 px-3 py-2 text-[13px] leading-snug text-fg" role="status">
            <IconAlert className="size-4 shrink-0 text-amber" aria-hidden />
            {t.discover.map.tilesFailed}
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

      {!tilesOn && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] leading-snug text-muted" data-testid="map-tiles-offer">
          <IconMap className="size-4 shrink-0 text-lime" aria-hidden />
          <p className="min-w-0 flex-1 basis-56">
            {t.discover.map.tilesOffer} {t.discover.map.tilesPrivacy}
          </p>
          <Button variant="secondary" size="sm" onClick={() => toggleTiles(true)} icon={<IconMap className="size-4" aria-hidden />}>
            {t.discover.map.tilesLoad}
          </Button>
        </div>
      )}

      {selected ? (
        <div className="max-w-sm">
          <ActivityCard activity={selected.ranked.activity} distanceKm={selected.ranked.distanceKm} photo={photos.get(selected.ranked.activity.id)} compact />
        </div>
      ) : (
        <p className="text-sm text-muted">{t.discover.map.pick}</p>
      )}
      {missing > 0 && <p className="text-[13px] leading-snug text-faint">{t.discover.map.missing(missing)}</p>}
      {tilesOn && (
        <p className="text-[13px] leading-snug text-faint">
          {t.discover.map.tilesOn}{" "}
          <button type="button" onClick={() => toggleTiles(false)} className="underline decoration-line-strong underline-offset-4 hover:text-fg">
            {t.discover.map.tilesOff}
          </button>
        </p>
      )}
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="glass inline-flex size-11 items-center justify-center rounded-full border border-white/15 text-fg transition-colors hover:border-lime focus-visible:outline-2 focus-visible:outline-lime"
    >
      {children}
    </button>
  );
}
