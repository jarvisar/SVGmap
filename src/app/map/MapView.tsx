import { type GeoJSONSource, Map as MapLibre, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { metresPerPixel, zoomForMetres } from '../../engine/geo/mercator.ts';
import type { AreaSpec } from '../../engine/geo/transform.ts';
import { type Layout, computeLayout } from '../../engine/layout/layout.ts';
import { bandPathD, shapePathD } from '../../engine/layout/shapes.ts';
import type { LabelArtwork, LabelSettings } from '../../engine/text/label.ts';
import { LockIcon } from '../components/controls.tsx';
import { type HandleSpot, type TitleDrag, type TitleGrip, canDrag, dragTitle, droppedLabel, handleAt, resizeCursor, spacedHandles, titleAt, titleHandles } from '../labelDrag.ts';
import { routesGeoJson } from '../routes.ts';
import { scaleOf, useApp } from '../store.ts';
import { BREAK_MASK, BorderBreakMask, TitleOverlay } from './TitleOverlay.tsx';
import { useLabelArtwork } from './useLabelArtwork.ts';

const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';

// MapLibre cannot find its own worker inside a bundle.
setWorkerUrl(maplibreWorker);

const COARSE = matchMedia('(pointer: coarse)').matches;
const HINT = COARSE ? 'Drag to move, pinch to zoom, twist to rotate' : 'Drag to move, scroll to zoom, right-drag to rotate';
const LOCKED_HINT = COARSE ? 'Drag to move, twist to rotate' : 'Drag to move, right-drag to rotate';

// Title handles in screen pixels: their size, how far apart they're kept, and
// how far from one a press still takes it. Fingers get further.
const HANDLE_SIZE = 9;
const HANDLE_GAP = 18;
const HANDLE_REACH = COARSE ? 16 : 9;
// How far a press on the title moves before it drags it.
const DRAG_START_PX = 4;

type Point = [number, number];

const MIN_ZOOM = 0;
const MAX_ZOOM = 24;

// Locking sets both zoom limits to the zoom for the locked scale, which stops
// every way of zooming and greys out the zoom buttons. null opens them again.
function pinZoom(map: MapLibre, zoom: number | null) {
  const min = zoom === null ? MIN_ZOOM : Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const max = zoom === null ? MAX_ZOOM : min;
  if (map.getMinZoom() === min && map.getMaxZoom() === max) return;
  // MapLibre throws if min would end up above max, so widen the range first.
  map.setMinZoom(MIN_ZOOM);
  map.setMaxZoom(max);
  map.setMinZoom(min);
}

interface Frame {
  // px per mm
  scale: number;
  ox: number;
  oy: number;
  window: { x: number; y: number; w: number; h: number };
  padding: { top: number; right: number; bottom: number; left: number };
}

function fitFrame(layout: Layout, width: number, height: number): Frame {
  const hint = 36;
  const pad = Math.max(20, Math.min(width, height) * 0.06);
  const { canvas, window } = layout;
  const scale = Math.max(0.01, Math.min((width - 2 * pad) / canvas.w, (height - 2 * pad - hint) / canvas.h));
  const ox = (width - canvas.w * scale) / 2;
  const oy = (height - hint - canvas.h * scale) / 2;
  const x = ox + window.x * scale;
  const y = oy + window.y * scale;
  const w = window.w * scale;
  const h = window.h * scale;
  return {
    scale,
    ox,
    oy,
    window: { x, y, w, h },
    // MapLibre throws on negative padding.
    padding: { left: Math.max(0, x), top: Math.max(0, y), right: Math.max(0, width - x - w), bottom: Math.max(0, height - y - h) },
  };
}

const sameArea = (a: AreaSpec | null, b: AreaSpec) =>
  a !== null &&
  Math.abs(a.lon - b.lon) < 1e-9 &&
  Math.abs(a.lat - b.lat) < 1e-9 &&
  Math.abs(a.bearing - b.bearing) < 1e-6 &&
  Math.abs(a.widthM / b.widthM - 1) < 1e-6;

export function MapView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const fromMap = useRef<AreaSpec | null>(null);
  const programmatic = useRef(false);
  // Sources can only be added once the style has loaded.
  const styleLoaded = useRef(false);
  const showRoutes = useRef(() => {});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [nudged, setNudged] = useState(false);

  const area = useApp((s) => s.area);
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);
  const label = useApp((s) => s.label);
  const customFontId = useApp((s) => s.customFontId);
  const setArea = useApp((s) => s.setArea);
  const scaleLocked = useApp((s) => s.scaleLocked);
  const setScaleLocked = useApp((s) => s.setScaleLocked);
  const scale = Math.round(useApp(scaleOf));
  const routeItems = useApp((s) => s.routes.items);
  const routeColor = useApp((s) => s.styles[s.mode].colors.route);
  const routeData = useMemo(() => routesGeoJson(routeItems), [routeItems]);

  const layout = useMemo(() => {
    try {
      return computeLayout(product, border);
    } catch {
      return null;
    }
  }, [product, border]);
  const frame = useMemo(() => (layout && size.w > 0 ? fitFrame(layout, size.w, size.h) : null), [layout, size]);
  frameRef.current = frame;
  // The scale bar and north arrows follow the map. Other titles don't need
  // it, so they aren't laid out again every time the map moves.
  const needsMap = label.style === 'legend' || label.style === 'badge';
  const metresPerMm = layout ? area.widthM / layout.window.w : 0;
  const mapInfo = useMemo(
    () => (needsMap && metresPerMm > 0 ? { metresPerMm, bearing: area.bearing } : null),
    [needsMap, metresPerMm, area.bearing],
  );
  // The title while it's dragged on the map. It's only stored when let go.
  // Pressing it selects it, which shows its handles.
  const [dragged, setDragged] = useState<LabelSettings | null>(null);
  const [titleSelected, setTitleSelected] = useState(false);
  const [titleHover, setTitleHover] = useState(false);
  const shownLabel = dragged ?? label;
  const { artwork, error: labelError, layoutWith } = useLabelArtwork(true, layout, shownLabel, customFontId, mapInfo);
  // Handles only on a title big enough on screen to grab them apart from it.
  const handles = useMemo(() => {
    if (!titleSelected || !artwork || !layout || !frame) return [];
    if (Math.max(artwork.knockout[2], artwork.knockout[3]) * frame.scale < 24) return [];
    return spacedHandles(titleHandles(layout, shownLabel, artwork), (x, y) => [x * frame.scale, y * frame.scale], HANDLE_GAP);
  }, [titleSelected, artwork, layout, frame, shownLabel]);
  const latest = useRef({ layout, label, artwork, layoutWith, frame, handles });
  latest.current = { layout, label, artwork, layoutWith, frame, handles };
  useEffect(() => {
    if (!artwork) setTitleSelected(false);
  }, [artwork]);

  // Dragging the title, or one of its handles. MapLibre listens for mouse and
  // touch events on its canvas, so a press on the title stops those here,
  // before they reach it, and the map doesn't pan under the title.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let grab: { pointerId: number; start: Point; screen: Point; moved: boolean; drag: TitleDrag; to: LabelSettings | null } | null = null;
    const onCanvas = (e: Event) => {
      const map = mapRef.current;
      return Boolean(map && e.target instanceof Node && map.getCanvasContainer().contains(e.target));
    };
    const toPiece = (e: { clientX: number; clientY: number }): Point | null => {
      const f = latest.current.frame;
      if (!f) return null;
      const r = wrap.getBoundingClientRect();
      return [(e.clientX - r.left - f.ox) / f.scale, (e.clientY - r.top - f.oy) / f.scale];
    };
    const gripAt = (e: { clientX: number; clientY: number }): TitleGrip | null => {
      const { artwork: shown, label: stored, handles: spots, frame: f } = latest.current;
      const p = toPiece(e);
      if (!p || !shown || !f) return null;
      return handleAt(spots, p[0], p[1], HANDLE_REACH / f.scale) ?? (titleAt(stored, shown, p[0], p[1]) ? 'move' : null);
    };
    const setCursor = (cursor: string) => {
      const container = mapRef.current?.getCanvasContainer();
      if (container) container.style.cursor = cursor;
    };
    const finish = (keep: boolean) => {
      const g = grab;
      grab = null;
      const relayout = latest.current.layoutWith;
      const placed = keep && g?.to && relayout ? relayout(g.to) : null;
      if (g?.to && placed) useApp.getState().setLabel(droppedLabel(g.to, placed));
      setDragged(null);
    };
    const onDown = (e: PointerEvent) => {
      if (grab) {
        // A second finger puts the title back and pinches the map instead.
        // MapLibre finds both fingers on this one's touchstart.
        finish(false);
        setCursor('');
        return;
      }
      if (!onCanvas(e) || e.button !== 0) return;
      const grip = gripAt(e);
      const { artwork: shown, label: stored } = latest.current;
      const start = toPiece(e);
      if (!grip || !shown || !start) {
        setTitleSelected(false);
        return;
      }
      e.stopPropagation();
      // Also keeps the browser from sending MapLibre the mouse events.
      e.preventDefault();
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        // Best effort. The drag still works while the pointer stays over the map.
      }
      grab = { pointerId: e.pointerId, start, screen: [e.clientX, e.clientY], moved: false, drag: { grip, label: stored, artwork: shown }, to: null };
      setTitleSelected(true);
      setCursor(grip === 'move' ? 'move' : (cursorOf(grip) ?? 'move'));
    };
    const cursorOf = (grip: TitleGrip) => {
      const spot = latest.current.handles.find((h) => h.id === grip);
      return spot ? resizeCursor(spot.dx, spot.dy) : null;
    };
    const onMove = (e: PointerEvent) => {
      if (grab && e.pointerId === grab.pointerId) {
        e.stopPropagation();
        // A click that wobbles a pixel or two only selects it.
        if (!grab.moved && Math.hypot(e.clientX - grab.screen[0], e.clientY - grab.screen[1]) < DRAG_START_PX) return;
        grab.moved = true;
        const { layout: at, layoutWith: relayout } = latest.current;
        const p = toPiece(e);
        if (!at || !relayout || !p) return;
        grab.to = dragTitle(at, grab.drag, p[0] - grab.start[0], p[1] - grab.start[1], relayout);
        setDragged(grab.to);
        return;
      }
      if (grab || e.buttons || !onCanvas(e)) return;
      const grip = gripAt(e);
      setTitleHover(grip !== null);
      setCursor(grip ? (cursorOf(grip) ?? 'move') : '');
    };
    const onUp = (e: PointerEvent) => {
      if (!grab || e.pointerId !== grab.pointerId) return;
      e.stopPropagation();
      finish(e.type === 'pointerup');
      setCursor('');
    };
    // What MapLibre itself listens to, kept from it while the title is held.
    const swallow = (e: Event) => {
      if (grab) e.stopPropagation();
    };
    const onDoubleClick = (e: MouseEvent) => {
      // Not a zoom on the title.
      if (onCanvas(e) && gripAt(e)) e.stopPropagation();
    };
    const onLeave = () => {
      if (grab) return;
      setTitleHover(false);
      setCursor('');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (grab) finish(false);
      else setTitleSelected(false);
    };
    const swallowed = ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
    wrap.addEventListener('pointerdown', onDown, true);
    wrap.addEventListener('pointermove', onMove, true);
    wrap.addEventListener('pointerup', onUp, true);
    wrap.addEventListener('pointercancel', onUp, true);
    wrap.addEventListener('dblclick', onDoubleClick, true);
    wrap.addEventListener('pointerleave', onLeave);
    for (const type of swallowed) wrap.addEventListener(type, swallow, true);
    window.addEventListener('keydown', onKey);
    return () => {
      wrap.removeEventListener('pointerdown', onDown, true);
      wrap.removeEventListener('pointermove', onMove, true);
      wrap.removeEventListener('pointerup', onUp, true);
      wrap.removeEventListener('pointercancel', onUp, true);
      wrap.removeEventListener('dblclick', onDoubleClick, true);
      wrap.removeEventListener('pointerleave', onLeave);
      for (const type of swallowed) wrap.removeEventListener(type, swallow, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = useApp.getState().area;
    const map = new MapLibre({
      container,
      style: BASEMAP,
      center: [initial.lon, initial.lat],
      zoom: 13,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      bearing: initial.bearing,
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
    map.on('load', () => {
      styleLoaded.current = true;
      showRoutes.current();
    });
    let pending = 0;
    map.on('move', () => {
      const f = frameRef.current;
      if (programmatic.current || !f) return;
      const c = map.getCenter().wrap();
      const { area, scaleLocked } = useApp.getState();
      const next: AreaSpec = {
        lon: c.lng,
        lat: c.lat,
        bearing: map.getBearing(),
        // While locked the stored width is exact. Metres per pixel drift a little
        // as the map pans north or south, until the zoom is pinned again.
        widthM: scaleLocked ? area.widthM : f.window.w * metresPerPixel(c.lat, map.getZoom()),
      };
      fromMap.current = next;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setArea(next));
    });
    // Zooming does nothing while locked, so point at the lock instead.
    let nudgeTimer = 0;
    const nudge = () => {
      if (!useApp.getState().scaleLocked) return;
      setNudged(true);
      clearTimeout(nudgeTimer);
      nudgeTimer = window.setTimeout(() => setNudged(false), 2500);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '-' || e.key === '=') nudge();
    };
    container.addEventListener('wheel', nudge, { passive: true });
    container.addEventListener('keydown', onKey);
    map.on('dblclick', nudge);
    mapRef.current = map;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
      clearTimeout(nudgeTimer);
      container.removeEventListener('wheel', nudge);
      container.removeEventListener('keydown', onKey);
      map.remove();
      mapRef.current = null;
      styleLoaded.current = false;
    };
  }, [setArea]);

  // Imported routes on the map, in the route colour on a white casing.
  useEffect(() => {
    const show = () => {
      const map = mapRef.current;
      if (!map || !styleLoaded.current) return;
      const source = map.getSource<GeoJSONSource>('routes');
      if (source) {
        void source.setData(routeData);
      } else {
        map.addSource('routes', { type: 'geojson', data: routeData });
        const layout = { 'line-join': 'round', 'line-cap': 'round' } as const;
        map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', layout, paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 } });
        map.addLayer({ id: 'route-line', type: 'line', source: 'routes', layout, paint: { 'line-width': 3 } });
        map.addLayer({
          id: 'route-ends',
          type: 'circle',
          source: 'routes',
          filter: ['==', '$type', 'Point'],
          paint: { 'circle-radius': 4.5, 'circle-stroke-width': 2 },
        });
      }
      map.setPaintProperty('route-line', 'line-color', routeColor);
      // Filled at the start, open at the finish.
      map.setPaintProperty('route-ends', 'circle-color', ['match', ['get', 'end'], 'start', routeColor, '#ffffff']);
      map.setPaintProperty('route-ends', 'circle-stroke-color', routeColor);
    };
    showRoutes.current = show;
    show();
  }, [routeData, routeColor]);

  // Move the map when the frame changes or the area was set somewhere else
  // (search, presets, typed values). Areas the map reported itself are on screen.
  const lastFrame = useRef<Frame | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frame) return;
    const frameChanged = frame !== lastFrame.current;
    const moved = frameChanged || !sameArea(fromMap.current, area);
    lastFrame.current = frame;
    const zoom = zoomForMetres(area.lat, area.widthM, frame.window.w);
    programmatic.current = true;
    try {
      if (frameChanged) map.resize();
      pinZoom(map, scaleLocked && Number.isFinite(zoom) ? zoom : null);
      if (moved) {
        map.jumpTo({
          center: [area.lon, area.lat],
          zoom: Number.isFinite(zoom) ? zoom : map.getZoom(),
          bearing: area.bearing,
          padding: frame.padding,
        });
      }
    } finally {
      programmatic.current = false;
    }
    fromMap.current = area;
  }, [frame, area, scaleLocked]);

  const hint = titleSelected
    ? `Drag the title or its handles. ${COARSE ? 'Tap' : 'Click'} the map to let go.`
    : scaleLocked
      ? LOCKED_HINT
      : HINT;
  return (
    <div className="map-wrap" ref={wrapRef}>
      <div ref={containerRef} className="map" />
      {layout && frame ? (
        <Overlay
          layout={layout}
          frame={frame}
          width={size.w}
          height={size.h}
          artwork={artwork}
          outline={artwork && (titleSelected || titleHover) && canDrag(shownLabel.style) ? (titleSelected ? 'selected' : 'hover') : null}
          handles={handles}
        />
      ) : null}
      <div className="map-footer">
        <button
          type="button"
          className={scaleLocked ? 'map-scale locked' : 'map-scale'}
          aria-pressed={scaleLocked}
          title={scaleLocked ? 'Unlock the scale to zoom again' : 'Lock the scale'}
          onClick={() => setScaleLocked(!scaleLocked)}
        >
          <LockIcon locked={scaleLocked} />
          1:{scale.toLocaleString()}
          {scaleLocked && nudged ? <span className="map-scale-note">Scale is locked. Click to unlock</span> : null}
        </button>
        <div className="map-hint">{hint}</div>
      </div>
      {labelError ? <div className="map-notice notice">{labelError}</div> : null}
    </div>
  );
}

function Overlay(props: {
  layout: Layout;
  frame: Frame;
  width: number;
  height: number;
  artwork: LabelArtwork | null;
  outline: 'hover' | 'selected' | null;
  handles: HandleSpot[];
}) {
  const { layout, frame, width, height, artwork, outline, handles } = props;
  const handle = HANDLE_SIZE / frame.scale;
  const s = frame.scale;
  const outside = `M${-frame.ox / s},${-frame.oy / s}h${width / s}v${height / s}h${-width / s}Z`;
  const broken = artwork?.borderBreaks.length ? `url(#${BREAK_MASK})` : undefined;
  return (
    <svg className="map-overlay" width={width} height={height}>
      <g transform={`translate(${frame.ox} ${frame.oy}) scale(${s})`}>
        <BorderBreakMask artwork={artwork} canvas={layout.canvas} />
        <path d={outside + shapePathD(layout.canvas, true)} fill="rgba(40,40,40,0.35)" />
        <path d={bandPathD(layout.canvas, layout.window)} fill="rgba(255,255,255,0.82)" />
        <g mask={broken}>
          {layout.thickBand ? (
            <path d={bandPathD(layout.thickBand.outer, layout.thickBand.inner)} fill="rgba(0,0,0,0.45)" />
          ) : null}
          {layout.thinLine ? (
            <path d={shapePathD(layout.thinLine)} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ) : null}
        </g>
        <path d={shapePathD(layout.canvas)} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {artwork ? <TitleOverlay artwork={artwork} windowD={shapePathD(layout.window)} /> : null}
        {artwork && outline ? (
          <rect
            className={outline === 'selected' ? 'title-frame' : 'title-grab'}
            x={artwork.knockout[0]}
            y={artwork.knockout[1]}
            width={artwork.knockout[2]}
            height={artwork.knockout[3]}
          />
        ) : null}
        {handles.map((spot) => (
          <rect key={spot.id} className="title-handle" x={spot.x - handle / 2} y={spot.y - handle / 2} width={handle} height={handle} />
        ))}
      </g>
    </svg>
  );
}
