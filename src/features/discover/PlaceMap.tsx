import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { IconAlert, IconFit, IconMap, IconMinus, IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Feedback";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import type { PlacePhoto } from "@/lib/commons";
import type { LatLng } from "@/lib/geo";
import { mapProvider, mapTilesAllowed, setMapTilesAllowed } from "@/lib/maps";
import { categoryWorld, type CategoryWorld } from "@/lib/stage";
import { clusterAction, clusterPoints, fitView, isGeoPoint, markerSize, panBy, toScreen, visibleTiles, zoomAround, zoomBy, type GeoPoint, type MapView, type Pixel } from "@/lib/tiles";
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
/** Zwei Finger: so viel Spreizen (log2 des Abstands, 0,5 ≈ 1,4-fach) ist eine Zoomstufe. */
const PINCH_STEP = 0.5;
/** Strg + Mausrad bzw. Pinch auf dem Trackpad: so viel `deltaY` ist eine Zoomstufe. */
const WHEEL_STEP = 60;

/** Rand eines Bündels in der Farbwelt seines besten Ortes (als Stil, damit das Start-CSS nicht wächst). */
const CLUSTER_RING: Record<CategoryWorld, string> = {
  food: "var(--color-amber)",
  night: "var(--color-pink)",
  play: "var(--color-violet)",
  outside: "var(--color-lime)",
};

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
  // Orte an derselben Stelle (Bündel, das auch ganz nah nicht auseinandergeht) – als Liste unter der Karte.
  const [stackIds, setStackIds] = useState<string[] | null>(null);
  const stack = stackIds ? placed.filter((p) => stackIds.includes(p.ranked.activity.id)) : [];

  // P6 Etappe 2: nahe Orte als Bündel („12“). Gerechnet je Zoomstufe über alle Orte, nicht nur die sichtbaren –
  // so bleiben die Bündel beim Ziehen stehen. Der gewählte Ort steht immer einzeln.
  const clusters = useMemo(
    () => (view ? clusterPoints(placed.filter((p) => p.ranked.activity.id !== selectedId), (p) => p.point, view.zoom) : []),
    [pointsKey, view?.zoom, selectedId],
  );

  const [tilesOn, setTilesOn] = useState(mapTilesAllowed);
  const [tileState, setTileState] = useState({ loaded: 0, failed: 0 });
  const toggleTiles = (on: boolean) => {
    setMapTilesAllowed(on);
    setTilesOn(on);
    setTileState({ loaded: 0, failed: 0 });
  };

  // Ein Finger (oder Maus) zieht, zwei Finger zoomen um die Mitte zwischen ihnen und verschieben zugleich.
  const pointers = useRef(new Map<number, Pixel>());
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; mid: Pixel } | null>(null);
  const dragged = useRef(false);
  const local = (x: number, y: number): Pixel => {
    const rect = frame.current?.getBoundingClientRect();
    return rect ? { x: x - rect.left, y: y - rect.top } : { x, y };
  };
  const capture = (el: Element, id: number) => {
    try {
      el.setPointerCapture(id);
    } catch {
      // Zeiger schon weg (z. B. Finger abgehoben) – dann gibt es nichts festzuhalten.
    }
  };
  const twoFingers = () => {
    const [a = { x: 0, y: 0 }, b = a] = [...pointers.current.values()];
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Erster Finger bzw. Maus: Reste eines Zeigers, der außerhalb der Karte losgelassen wurde, vergessen.
    if (e.isPrimary) pointers.current.clear();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Zweiter Finger: aus dem Ziehen wird Zoomen; kein Tipp auf einen Punkt mehr.
      drag.current = null;
      dragged.current = true;
      pinch.current = twoFingers();
      for (const id of pointers.current.keys()) capture(e.currentTarget, id);
      return;
    }
    if (pointers.current.size > 2) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && pointers.current.size === 2) {
      const now = twoFingers();
      const dx = now.mid.x - p.mid.x;
      const dy = now.mid.y - p.mid.y;
      const scale = Math.log2(now.distance / p.distance);
      const step = scale >= PINCH_STEP ? 1 : scale <= -PINCH_STEP ? -1 : 0;
      const at = local(now.mid.x, now.mid.y);
      move((current) => {
        const panned = dx || dy ? panBy(current, -dx, -dy) : current;
        return step ? zoomAround(panned, step, at, size.width, size.height) : panned;
      });
      pinch.current = { distance: step ? now.distance : p.distance, mid: now.mid };
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      dragged.current = true;
      capture(e.currentTarget, e.pointerId);
    }
    d.x = e.clientX;
    d.y = e.clientY;
    move((current) => panBy(current, -dx, -dy));
  };
  const endPointer = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // Bleibt nach dem Zoomen ein Finger liegen, zieht er erst nach erneutem Aufsetzen – sonst springt die Karte.
    drag.current = null;
  };
  // Doppeltipp (oder Doppelklick) auf freie Fläche: eine Stufe näher, dort, wo getippt wurde.
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("button, a")) return;
    const at = local(e.clientX, e.clientY);
    move((current) => zoomAround(current, 1, at, size.width, size.height));
  };
  // Strg + Mausrad und Pinch auf dem Trackpad (kommt als Rad mit Strg). Ohne Strg scrollt die Seite wie gewohnt.
  // Als eigener Listener, weil React Rad-Ereignisse nur passiv anmeldet und der Browser sonst die Seite zoomt.
  const wheel = useRef({ total: 0, handle: (_e: WheelEvent) => {} });
  wheel.current.handle = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    wheel.current.total += e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    const step = wheel.current.total <= -WHEEL_STEP ? 1 : wheel.current.total >= WHEEL_STEP ? -1 : 0;
    if (!step) return;
    wheel.current.total = 0;
    const at = local(e.clientX, e.clientY);
    move((current) => zoomAround(current, step, at, size.width, size.height));
  };
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const listener = (e: WheelEvent) => wheel.current.handle(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, [noneWithLocation]);

  const openCluster = (members: Placed[]) => {
    if (!view) return;
    const action = clusterAction(members.map((m) => m.point), view, size.width, size.height, PADDING);
    if (action.kind === "zoom") {
      setStackIds(null);
      move(() => action.view);
    } else {
      setSelectedId(null);
      setStackIds(members.map((m) => m.ranked.activity.id));
    }
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
  const onScreen = ({ x, y }: Pixel) => x > -28 && y > -28 && x < size.width + 28 && y < size.height + 28;
  const pins = view
    ? [...clusters.flatMap((c) => (c.members.length === 1 ? c.members : [])), ...(selected ? [selected] : [])]
        .map((p) => ({ ...p, at: toScreen(p.point, view, size.width, size.height) }))
        // Der gewählte Punkt liegt obenauf (steht als letzter in der Liste).
        .filter(({ at }) => onScreen(at))
    : [];
  const bundles = view
    ? clusters.filter((c) => c.members.length > 1).map((c) => ({ ...c, at: toScreen(c.point, view, size.width, size.height) })).filter(({ at }) => onScreen(at))
    : [];

  return (
    <div className="space-y-4" data-testid="place-map">
      <div
        ref={frame}
        role="region"
        aria-label={t.discover.map.label(cityName)}
        aria-describedby="place-map-keys"
        data-zoom={view?.zoom}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={onDoubleClick}
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
                setStackIds(null);
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
        {bundles.map(({ members, at }) => {
          const best = members[0]!.ranked.activity;
          const count = members.length;
          // Größer, je mehr Orte drin sind; clusterPoints hält mit dieser Größe Abstand zu den Nachbarn (Etappe 3).
          const diameter = markerSize(count);
          return (
            <button
              key={`c-${best.id}`}
              type="button"
              tabIndex={-1}
              aria-label={t.discover.map.cluster(count)}
              data-map-cluster={count}
              onClick={() => {
                if (dragged.current) return;
                openCluster(members);
              }}
              className="glass absolute z-10 inline-flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 font-display text-[12px] font-bold tabular-nums text-fg transition-transform duration-200 hover:scale-125"
              style={{ left: at.x, top: at.y, width: diameter, height: diameter, borderColor: CLUSTER_RING[categoryWorld(best.category)] }}
            >
              {count}
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

      {stack.length > 1 ? (
        <div className="space-y-2" data-testid="map-stack">
          <p className="text-sm text-muted">{t.discover.map.stack(stack.length)}</p>
          <ul className="flex flex-wrap gap-2">
            {stack.map(({ ranked }) => (
              <li key={ranked.activity.id}>
                <button
                  type="button"
                  onClick={() => {
                    setStackIds(null);
                    setSelectedId(ranked.activity.id);
                  }}
                  className="glass inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-semibold text-fg"
                  style={{ borderColor: CLUSTER_RING[categoryWorld(ranked.activity.category)] }}
                >
                  {ranked.activity.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : selected ? (
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
