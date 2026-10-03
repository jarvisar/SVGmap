import { type GeoJSONSource, Map as MapLibre, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { zoomForMetres } from '../../engine/geo/mercator.ts';
import type { AreaSpec } from '../../engine/geo/transform.ts';
import { type BorderSettings, type Layout, type ProductSettings, computeLayout } from '../../engine/layout/layout.ts';
import { bandPathD, shapePathD } from '../../engine/layout/shapes.ts';
import { type MapMark, markPlacedAt, markPoint } from '../../engine/marks/marks.ts';
import type { LabelArtwork, LabelSettings } from '../../engine/text/label.ts';
import { LockIcon } from '../components/controls.tsx';
import { type HandleSpot, type TitleDrag, type TitleGrip, canDrag, dragTitle, droppedLabel, handleAt, resizeCursor, spacedHandles, titleAt, titleHandles } from '../labelDrag.ts';
import { MARK_REACH_PX, type PlacedMark, markAt, markCorners } from '../markDrag.ts';
import { markTransform, removeMark, selectMark, updateMark, useMarkUi } from '../marks.ts';
import { usePlaceholderValues } from '../placeholders.ts';
import { MarkDrawing, MarkFrames } from '../preview/MarkTools.tsx';
import { routesGeoJson } from '../routes.ts';
import { scaleOf, useApp } from '../store.ts';
import { asChange } from '../undo.ts';
import { CaptureControls } from './CaptureControls.tsx';
import { type CaptureChange, type CaptureFrame, type CaptureGrip, type FrameView, frameForView, frameTransform, toPiece, toScreen } from './captureFrame.ts';
import { BREAK_MASK, BorderBreakMask, INK, PAPER, TitleOverlay } from './TitleOverlay.tsx';
import { useLabelArtwork } from './useLabelArtwork.ts';
import { useMarkArtworks } from './useMarkArtwork.ts';

const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';

// MapLibre cannot find its own worker inside a bundle.
setWorkerUrl(maplibreWorker);

const COARSE = matchMedia('(pointer: coarse)').matches;
const HINT = COARSE
  ? 'Drag or pinch to look around. Drag the white frame to move the capture, or its handles to resize or turn it.'
  : 'Drag or scroll to look around. Drag the white frame to move the capture, or its handles to resize or turn it.';

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

interface FittedFrame {
  // px per mm
  scale: number;
  ox: number;
  oy: number;
  window: { x: number; y: number; w: number; h: number };
  padding: { top: number; right: number; bottom: number; left: number };
}

function fitFrame(layout: Layout, width: number, height: number): FittedFrame {
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

function tryLayout(product: ProductSettings, border: BorderSettings): Layout | null {
  try {
    return computeLayout(product, border);
  } catch {
    return null;
  }
}

// Where the capture is on screen for the camera right now. Read from the map
// rather than kept in state, since the camera moves without React knowing.
function cameraFrame(map: MapLibre, layout: Layout, area: AreaSpec): CaptureFrame {
  // Use the world copy nearest the camera when the view crosses the dateline.
  const lon = area.lon + 360 * Math.round((map.getCenter().lng - area.lon) / 360);
  const centre = map.project([lon, area.lat]);
  return frameForView(layout, area, [centre.x, centre.y], map.getZoom(), map.getBearing());
}

const sameArea = (a: AreaSpec | null | undefined, b: AreaSpec) =>
  a != null &&
  Math.abs(a.lon - b.lon) < 1e-9 &&
  Math.abs(a.lat - b.lat) < 1e-9 &&
  Math.abs(a.bearing - b.bearing) < 1e-6 &&
  Math.abs(a.widthM / b.widthM - 1) < 1e-6;

export function MapView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const overlayRef = useRef<FrameView>(null);
  const controlsRef = useRef<FrameView>(null);
  const presentedFrame = useRef<CaptureFrame | null>(null);
  const presentFrame = useRef<(force?: boolean) => void>(() => {});
  // Sources can only be added once the style has loaded.
  const styleLoaded = useRef(false);
  const showRoutes = useRef(() => {});
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The capture while it's dragged on the map. It's only stored when let go.
  const [captureDraft, setCaptureDraft] = useState<CaptureChange | null>(null);
  const [captureHover, setCaptureHover] = useState<CaptureGrip | null>(null);

  const area = useApp((s) => s.area);
  const shownArea = captureDraft?.area ?? area;
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);
  const label = useApp((s) => s.label);
  const customFontId = useApp((s) => s.customFontId);
  const setArea = useApp((s) => s.setArea);
  const scaleLocked = useApp((s) => s.scaleLocked);
  const setScaleLocked = useApp((s) => s.setScaleLocked);
  const storedScale = useApp(scaleOf);
  const routeItems = useApp((s) => s.routes.items);
  const routeColor = useApp((s) => s.styles[s.mode].colors.route);
  const routeData = useMemo(() => routesGeoJson(routeItems), [routeItems]);

  const storedLayout = useMemo(() => tryLayout(product, border), [product, border]);
  const draftLayout = useMemo(() => (captureDraft?.product ? tryLayout(captureDraft.product, border) : null), [captureDraft, border]);
  const layout = draftLayout ?? storedLayout;
  const map = mapRef.current;
  const frame = map && layout && size.w > 0 && size.h > 0 ? cameraFrame(map, layout, shownArea) : null;
  // Follows a drag on the capture before it's stored.
  const scale = Math.round(layout ? (shownArea.widthM / layout.window.w) * 1000 : storedScale);
  // The scale bar and north arrows follow the map. Other titles don't need
  // it, so they aren't laid out again every time the map moves.
  const needsMap = label.style === 'legend' || label.style === 'badge';
  const metresPerMm = layout ? shownArea.widthM / layout.window.w : 0;
  const mapInfo = useMemo(
    () => (needsMap && metresPerMm > 0 ? { metresPerMm, bearing: shownArea.bearing } : null),
    [needsMap, metresPerMm, shownArea.bearing],
  );
  // The title while it's dragged on the map. It's only stored when let go.
  // Pressing it selects it, which shows its handles.
  const [dragged, setDragged] = useState<LabelSettings | null>(null);
  const [titleSelected, setTitleSelected] = useState(false);
  const [titleHover, setTitleHover] = useState(false);
  const shownLabel = dragged ?? label;
  const values = usePlaceholderValues();
  const { artwork, error: labelError, layoutWith } = useLabelArtwork(true, layout, shownLabel, customFontId, values, mapInfo);
  // All of the selected title's handles. Which ones show depends on how big it
  // is on screen, so that's left to the overlay and gripAt, which know the camera.
  const handles = useMemo(() => {
    return titleSelected && artwork && layout ? titleHandles(layout, shownLabel, artwork) : [];
  }, [titleSelected, artwork, layout, shownLabel]);
  // Pins and text, which can be dragged on the map too. Resizing and turning
  // them is left to the preview and the sidebar.
  const marks = useApp((s) => s.marks);
  const selectedMark = useMarkUi((s) => s.selected);
  const liveMarks = useMarkArtworks(marks, label.font, customFontId, values);
  const [markDragged, setMarkDragged] = useState<MapMark | null>(null);
  const [markHover, setMarkHover] = useState<string | null>(null);
  const placedMarks: PlacedMark[] = useMemo(() => {
    if (!layout) return [];
    const transform = markTransform(shownArea, layout);
    return marks.map((m) => {
      const mark = markDragged?.id === m.id ? markDragged : m;
      return { mark, art: liveMarks.layoutWith(mark), at: markPoint(mark, transform, layout.window) };
    });
  }, [marks, markDragged, liveMarks, shownArea, layout]);
  // For the handlers below. React can render this and then throw the render
  // away, so nothing in here may come from outside React state, like the
  // camera. Handlers read the frame from the map instead.
  const latest = useRef({ layout, label, artwork, layoutWith, handles, placedMarks, area: shownArea, size });
  latest.current = { layout, label, artwork, layoutWith, handles, placedMarks, area: shownArea, size };
  const liveFrame = useRef(() => {
    const map = mapRef.current;
    const { layout, area, size } = latest.current;
    return map && layout && size.w > 0 && size.h > 0 ? cameraFrame(map, layout, area) : null;
  }).current;
  presentFrame.current = (force = false) => {
    const next = liveFrame();
    if (!next) return;
    const last = presentedFrame.current;
    if (!force && last && next.ox === last.ox && next.oy === last.oy && next.scale === last.scale && next.angle === last.angle) return;
    presentedFrame.current = next;
    overlayRef.current?.updateFrame(next);
    controlsRef.current?.updateFrame(next);
  };
  // Keep the SVG transforms in the camera's render cycle. A queued React
  // update can be cancelled repeatedly during a gesture and lag behind it.
  useLayoutEffect(() => presentFrame.current(true));
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
    let markGrab: { pointerId: number; start: Point; screen: Point; moved: boolean; from: PlacedMark; to: MapMark | null } | null = null;
    // The white frame around the map moves the capture, but a title or mark
    // drawn over it comes first.
    const onCanvas = (e: Event) => {
      const map = mapRef.current;
      if (!map || !(e.target instanceof Element)) return false;
      return map.getCanvasContainer().contains(e.target) || e.target.classList.contains('capture-band');
    };
    const pieceAt = (e: { clientX: number; clientY: number }): Point | null => {
      const f = liveFrame();
      if (!f) return null;
      const r = wrap.getBoundingClientRect();
      return toPiece(f, [e.clientX - r.left, e.clientY - r.top]);
    };
    const gripAt = (e: { clientX: number; clientY: number }): TitleGrip | null => {
      const { artwork: shown, label: stored, handles: spots } = latest.current;
      const f = liveFrame();
      const p = pieceAt(e);
      if (!p || !shown || !f) return null;
      const visible = shown && Math.max(shown.knockout[2], shown.knockout[3]) * f.scale >= 24
        ? spacedHandles(spots, (x, y) => toScreen(f, [x, y]), HANDLE_GAP) : [];
      return handleAt(visible, p[0], p[1], HANDLE_REACH / f.scale) ?? (titleAt(stored, shown, p[0], p[1]) ? 'move' : null);
    };
    const markUnder = (e: { clientX: number; clientY: number }): PlacedMark | null => {
      const { placedMarks: items } = latest.current;
      const f = liveFrame();
      const p = pieceAt(e);
      if (!p || !f) return null;
      const id = markAt(
        items.filter((i) => !i.art.empty),
        p,
        MARK_REACH_PX / f.scale,
      );
      return items.find((i) => i.mark.id === id) ?? null;
    };
    const finishMark = (keep: boolean) => {
      const g = markGrab;
      markGrab = null;
      if (keep && g?.moved && g.to) {
        const { id, ...patch } = g.to;
        updateMark(id, patch);
      }
      setMarkDragged(null);
    };
    const setCursor = (cursor: string) => {
      const container = mapRef.current?.getCanvasContainer();
      if (container) container.style.cursor = cursor;
      // The white frame has a cursor of its own, for moving the capture.
      if (cursor) wrap.style.setProperty('--capture-cursor', cursor);
      else wrap.style.removeProperty('--capture-cursor');
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
      if (grab || markGrab) {
        // A second finger puts the title or mark back and pinches the map
        // instead. MapLibre finds both fingers on this one's touchstart.
        finish(false);
        finishMark(false);
        setCursor('');
        return;
      }
      if (!onCanvas(e) || e.button !== 0) return;
      // Marks are drawn over the title, so they come first.
      const hit = markUnder(e);
      const from = pieceAt(e);
      if (hit && from) {
        e.stopPropagation();
        e.preventDefault();
        // The press is handled here, so move focus out of any sidebar field.
        wrap.focus({ preventScroll: true });
        try {
          wrap.setPointerCapture(e.pointerId);
        } catch {
          // Best effort, as with the title.
        }
        markGrab = { pointerId: e.pointerId, start: from, screen: [e.clientX, e.clientY], moved: false, from: hit, to: null };
        selectMark(hit.mark.id);
        setTitleSelected(false);
        setCursor('move');
        return;
      }
      selectMark(null);
      const grip = gripAt(e);
      const { artwork: shown, label: stored } = latest.current;
      const start = pieceAt(e);
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
      const f = liveFrame();
      if (!spot || !f) return null;
      const [dx, dy] = toScreen({ ...f, scale: 1, ox: 0, oy: 0 }, [spot.dx, spot.dy]);
      return resizeCursor(dx, dy);
    };
    const onMove = (e: PointerEvent) => {
      if (markGrab && e.pointerId === markGrab.pointerId) {
        e.stopPropagation();
        if (!markGrab.moved && Math.hypot(e.clientX - markGrab.screen[0], e.clientY - markGrab.screen[1]) < DRAG_START_PX) return;
        markGrab.moved = true;
        const { layout: at, area: now } = latest.current;
        const p = pieceAt(e);
        if (!at || !p) return;
        const { from, start } = markGrab;
        const spot: Point = [from.at[0] + p[0] - start[0], from.at[1] + p[1] - start[1]];
        markGrab.to = { ...from.mark, ...markPlacedAt(spot, markTransform(now, at), at.window) };
        setMarkDragged(markGrab.to);
        return;
      }
      if (grab && e.pointerId === grab.pointerId) {
        e.stopPropagation();
        // A click that wobbles a pixel or two only selects it.
        if (!grab.moved && Math.hypot(e.clientX - grab.screen[0], e.clientY - grab.screen[1]) < DRAG_START_PX) return;
        grab.moved = true;
        const { layout: at, layoutWith: relayout } = latest.current;
        const p = pieceAt(e);
        if (!at || !relayout || !p) return;
        grab.to = dragTitle(at, grab.drag, p[0] - grab.start[0], p[1] - grab.start[1], relayout);
        setDragged(grab.to);
        return;
      }
      if (grab || markGrab || e.buttons || !onCanvas(e)) return;
      const hit = markUnder(e);
      const grip = hit ? null : gripAt(e);
      setMarkHover(hit?.mark.id ?? null);
      setTitleHover(grip !== null);
      setCursor(hit ? 'move' : grip ? (cursorOf(grip) ?? 'move') : '');
    };
    const onUp = (e: PointerEvent) => {
      if (markGrab && e.pointerId === markGrab.pointerId) {
        e.stopPropagation();
        finishMark(e.type === 'pointerup');
        setCursor('');
        return;
      }
      if (!grab || e.pointerId !== grab.pointerId) return;
      e.stopPropagation();
      finish(e.type === 'pointerup');
      setCursor('');
    };
    // What MapLibre itself listens to, kept from it while the title is held.
    const swallow = (e: Event) => {
      if (grab || markGrab) e.stopPropagation();
    };
    const onDoubleClick = (e: MouseEvent) => {
      // Not a zoom on the title or a mark.
      if (onCanvas(e) && (markUnder(e) || gripAt(e))) e.stopPropagation();
    };
    const onLeave = () => {
      if (grab || markGrab) return;
      setTitleHover(false);
      setMarkHover(null);
      setCursor('');
    };
    const onKey = (e: KeyboardEvent) => {
      if (useApp.getState().view !== 'map') return;
      if (e.key === 'Delete') {
        if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || grab || markGrab) return;
        const target = e.target as HTMLElement | null;
        if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return;
        const id = useMarkUi.getState().selected;
        if (!id || !useApp.getState().marks.some((mark) => mark.id === id)) return;
        e.preventDefault();
        removeMark(id);
        return;
      }
      if (e.key !== 'Escape') return;
      if (markGrab) finishMark(false);
      else if (grab) finish(false);
      else {
        setTitleSelected(false);
        selectMark(null);
      }
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
  }, [liveFrame]);

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
    const showCamera = () => presentFrame.current();
    // Browsing changes only the camera. The capture is edited through its
    // border, handles and Location fields.
    map.on('move', showCamera);
    map.on('resize', showCamera);
    map.on('render', showCamera);
    mapRef.current = map;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      styleLoaded.current = false;
    };
  }, []);

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

  const fitCapture = () => {
    const map = mapRef.current;
    const { layout, area, size } = latest.current;
    if (!map || !layout || size.w <= 0 || size.h <= 0) return;
    const fitted = fitFrame(layout, size.w, size.h);
    const zoom = zoomForMetres(area.lat, area.widthM, fitted.window.w);
    map.jumpTo({
      center: [area.lon, area.lat],
      zoom: Number.isFinite(zoom) ? zoom : map.getZoom(),
      bearing: area.bearing,
      padding: fitted.padding,
    });
  };

  useEffect(() => {
    mapRef.current?.resize();
  }, [size]);

  // The camera only moves by itself to show a capture changed somewhere else:
  // a search, a preset, the Location or Size fields, or undo. A drag on the
  // capture leaves it where it is, so the frame stays under the pointer.
  const shownBy = useRef<{ layout: Layout; area: AreaSpec } | null>(null);
  const dropped = useRef<{ product: ProductSettings; area: AreaSpec } | null>(null);
  useEffect(() => {
    if (!mapRef.current || !storedLayout || size.w <= 0 || size.h <= 0) return;
    const last = shownBy.current;
    const changed = !last || last.layout !== storedLayout || !sameArea(last.area, area);
    const ours = dropped.current?.product === product && sameArea(dropped.current?.area, area);
    if (changed && !ours) fitCapture();
    shownBy.current = { layout: storedLayout, area };
  }, [storedLayout, product, area, size]);

  const commitCapture = (change: CaptureChange, grip: CaptureGrip) => {
    const { product: next, area: to } = change;
    if (next) {
      asChange('Resize piece', () => useApp.getState().set({ product: next, productPreset: 'custom', area: to }));
    } else {
      const name = grip === 'move' ? 'Move capture area' : grip === 'rotate' ? 'Turn capture area' : 'Resize capture area';
      asChange(name, () => setArea(to));
    }
    const stored = useApp.getState();
    dropped.current = { product: stored.product, area: stored.area };
  };

  const captureHint = () => {
    if (!captureHover) return null;
    if (captureHover === 'move') return 'Drag to move the capture area.';
    if (captureHover === 'rotate') {
      const turned = captureDraft ? `Turned to ${Math.round(shownArea.bearing)}°. ` : 'Drag to turn the capture area. ';
      return `${turned}Hold Shift to snap to 15°.`;
    }
    if (!scaleLocked) return 'Drag to resize the capture. The piece stays the same size and the scale changes.';
    const piece = captureDraft?.product;
    if (!piece) return `Drag to resize the piece. The scale is locked at 1:${scale.toLocaleString()}.`;
    const size = piece.shape === 'circle' ? `⌀ ${piece.width.toFixed(1)} mm` : `${piece.width.toFixed(1)} × ${piece.height.toFixed(1)} mm`;
    return `Piece ${size} at 1:${scale.toLocaleString()}.`;
  };
  const hint = titleSelected
    ? `Drag the title or its handles. ${COARSE ? 'Tap' : 'Click'} the map to let go.`
    : selectedMark || markHover || markDragged
      ? `Drag it to put it somewhere else. ${!COARSE && selectedMark ? 'Delete removes it. ' : ''}Resize and turn it in the preview.`
      : titleHover
        ? 'Drag to move the title.'
        : (captureHint() ?? HINT);
  return (
    <div className="map-wrap" ref={wrapRef} tabIndex={-1}>
      <div ref={containerRef} className="map" />
      {layout && frame ? (
        <Overlay
          ref={overlayRef}
          layout={layout}
          frame={frame}
          width={size.w}
          height={size.h}
          artwork={artwork}
          outline={artwork && (titleSelected || titleHover) && canDrag(shownLabel.style) ? (titleSelected ? 'selected' : 'hover') : null}
          handles={handles}
          marks={placedMarks}
          selectedMark={selectedMark}
          markHover={markHover}
        />
      ) : null}
      {layout && frame ? (
        <CaptureControls
          ref={controlsRef}
          layout={layout}
          area={area}
          product={product}
          border={border}
          frame={frame}
          width={size.w}
          height={size.h}
          locked={scaleLocked}
          onStart={() => {
            mapRef.current?.stop();
            setTitleSelected(false);
            selectMark(null);
          }}
          onHover={setCaptureHover}
          onPreview={setCaptureDraft}
          onCommit={commitCapture}
          onWheel={(e) => mapRef.current?.getCanvas().dispatchEvent(new WheelEvent(e.type, e))}
        />
      ) : null}
      <div className="map-footer">
        <button type="button" className="map-scale" title="Show the whole capture area" onClick={fitCapture}>Fit capture</button>
        <button
          type="button"
          className={scaleLocked ? 'map-scale locked' : 'map-scale'}
          aria-pressed={scaleLocked}
          title={scaleLocked ? 'Unlock the scale. Resizing the capture changes the scale again.' : 'Lock the scale. Resizing the capture then changes the piece size instead.'}
          onClick={() => setScaleLocked(!scaleLocked)}
        >
          <LockIcon locked={scaleLocked} />
          1:{scale.toLocaleString()}
        </button>
        <div className="map-hint">{hint}</div>
      </div>
      {labelError ? <div className="map-notice notice">{labelError}</div> : null}
    </div>
  );
}

function Overlay(props: {
  ref: Ref<FrameView>;
  layout: Layout;
  frame: CaptureFrame;
  width: number;
  height: number;
  artwork: LabelArtwork | null;
  outline: 'hover' | 'selected' | null;
  handles: HandleSpot[];
  marks: PlacedMark[];
  selectedMark: string | null;
  markHover: string | null;
}) {
  const { layout, frame, width, height, artwork, outline, handles, marks } = props;
  const pieceRef = useRef<SVGGElement>(null);
  const maskRef = useRef<SVGPathElement>(null);
  const titleHandlesRef = useRef<SVGGElement>(null);
  const markFramesRef = useRef<SVGGElement>(null);
  useImperativeHandle(props.ref, () => ({
    updateFrame(next) {
      const transform = frameTransform(next);
      pieceRef.current?.setAttribute('transform', transform);
      maskRef.current?.setAttribute('transform', transform);
      const visible = new Set(artwork && Math.max(artwork.knockout[2], artwork.knockout[3]) * next.scale >= 24
        ? spacedHandles(handles, (x, y) => toScreen(next, [x, y]), HANDLE_GAP).map((spot) => spot.id) : []);
      const rects = titleHandlesRef.current?.children;
      handles.forEach((spot, i) => {
        const element = rects?.[i] as SVGRectElement | undefined;
        if (!element) return;
        const [x, y] = toScreen(next, [spot.x, spot.y]);
        element.setAttribute('x', String(x - HANDLE_SIZE / 2));
        element.setAttribute('y', String(y - HANDLE_SIZE / 2));
        element.style.display = visible.has(spot.id) ? '' : 'none';
      });
      const polygons = markFramesRef.current?.querySelectorAll('polygon');
      let index = 0;
      for (const placed of marks) {
        if (placed.mark.id !== props.selectedMark && placed.mark.id !== props.markHover) continue;
        polygons?.[index++]?.setAttribute('points', markCorners(placed, 3 / next.scale).map(([x, y]) => `${x},${y}`).join(' '));
      }
    },
  }), [artwork, handles, marks, props.selectedMark, props.markHover]);
  const s = frame.scale;
  const transform = frameTransform(frame);
  const broken = artwork?.borderBreaks.length ? `url(#${BREAK_MASK})` : undefined;
  return (
    <svg className="map-overlay" width={width} height={height}>
      <defs>
        <mask id="capture-outside" maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
          <rect width={width} height={height} fill="#fff" />
          <path ref={maskRef} d={shapePathD(layout.canvas)} transform={transform} fill="#000" />
        </mask>
      </defs>
      <rect width={width} height={height} fill="rgba(40,40,40,0.35)" mask="url(#capture-outside)" />
      <g ref={pieceRef} transform={transform}>
        <BorderBreakMask artwork={artwork} canvas={layout.canvas} />
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
        {marks.length ? (
          <>
            <MarkDrawing items={marks} inkOf={() => INK} paper={PAPER} windowD={shapePathD(layout.window)} clipId="map-mark-window" screenLineWidth={1} />
            <g ref={markFramesRef}>
              <MarkFrames items={marks} selected={props.selectedMark} hover={props.markHover} editing={false} handles={[]} unit={1 / s} />
            </g>
          </>
        ) : null}
        {artwork && outline ? (
          <rect
            className={outline === 'selected' ? 'title-frame' : 'title-grab'}
            x={artwork.knockout[0]}
            y={artwork.knockout[1]}
            width={artwork.knockout[2]}
            height={artwork.knockout[3]}
          />
        ) : null}
      </g>
      <g ref={titleHandlesRef}>
        {handles.map((spot) => {
          const [x, y] = toScreen(frame, [spot.x, spot.y]);
          return <rect key={spot.id} className="title-handle" x={x - HANDLE_SIZE / 2} y={y - HANDLE_SIZE / 2} width={HANDLE_SIZE} height={HANDLE_SIZE} />;
        })}
      </g>
    </svg>
  );
}
