import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Layout, computeLayout } from '../../engine/layout/layout.ts';
import type { RenderResult } from '../../engine/result.ts';
import type { LabelSettings } from '../../engine/text/label.ts';
import { Select } from '../components/controls.tsx';
import { type TitleDrag, type TitleGrip, canDrag, dragTitle, droppedLabel, handleAt, resizeCursor, spacedHandles, titleAt, titleHandles } from '../labelDrag.ts';
import { useLabelArtwork } from '../map/useLabelArtwork.ts';
import { useRender } from '../render.ts';
import { type PreviewLook, useApp } from '../store.ts';
import { MATERIALS, type MaterialId, groupPaint, previewBackground } from './paint.ts';
import { PickIndex, PickOverlay, RoadRouteCard } from './RoutePicker.tsx';
import { TitleCard, TitleFrame, TitleGhost } from './TitleTools.tsx';

// The part of the piece in view, in mm. The height follows the stage.
interface Box {
  x: number;
  y: number;
  w: number;
}

type Point = [number, number];

const COARSE = matchMedia('(pointer: coarse)').matches;

// Handles in screen pixels: how far apart they're kept, and how far from one
// a press still takes it. Fingers get further.
const HANDLE_GAP = 18;
const HANDLE_REACH = COARSE ? 16 : 9;
// How far a press on the title moves before it drags it.
const DRAG_START_PX = 4;

const isTitle = (element: string) => element === 'text' || element === 'frame';

// hideTitle leaves the title out while a moved one is drawn over the result.
const PreviewContent = memo(function PreviewContent(props: { result: RenderResult; look: PreviewLook; hideTitle: boolean }) {
  const { result, look, hideTitle } = props;
  return (
    <g>
      <path d={result.outline} fill={previewBackground(result, look)} />
      {result.groups.map((group) => {
        if (hideTitle && isTitle(group.element)) return null;
        const paint = groupPaint(group, result, look);
        return (
          <g key={group.id} {...paint} strokeLinecap="round" strokeLinejoin="round">
            {group.paths.map((p, i) => (
              <path key={i} d={p.d} strokeWidth={p.strokeWidth} />
            ))}
          </g>
        );
      })}
    </g>
  );
});

// Centre of the touching pointers and their average distance from it.
function spread(points: Map<number, Point>): [Point, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of points.values()) {
    x += px / points.size;
    y += py / points.size;
  }
  let distance = 0;
  for (const [px, py] of points.values()) distance += Math.hypot(px - x, py - y) / points.size;
  return [[x, y], distance];
}

const clampWidth = (w: number) => Math.min(Math.max(w, 2), 5000);

function useLayout(): Layout | null {
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);
  return useMemo(() => {
    try {
      return computeLayout(product, border);
    } catch {
      return null;
    }
  }, [product, border]);
}

// upToDate says the result is from the settings as they are now.
export function Preview(props: { onGenerate: () => void; upToDate: boolean }) {
  const result = useRender((s) => s.result);
  const status = useRender((s) => s.status);
  const error = useRender((s) => s.error);
  const look = useApp((s) => s.previewLook);
  const setLook = useApp((s) => s.setPreviewLook);
  const setLabel = useApp((s) => s.setLabel);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useRef<HTMLDivElement>(null);
  // Pointers down on the stage, in stage pixels. Dragging and pinching both
  // work from where the gesture started, so they don't drift.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ box: Box; start: Map<number, Point> } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Picking roads: a press that barely moves is a click, anything more still pans.
  const [picking, setPicking] = useState(false);
  const roadRoutes = useApp((s) => s.roadRoutes);
  const [selected, setSelected] = useState<number[]>([]);
  const [hoverLine, setHoverLine] = useState(-1);
  const pressed = useRef<{ point: Point; moved: boolean } | null>(null);
  // Built only while picking: a big map's index takes most of a frame.
  const index = useMemo(() => (picking && result?.pick ? new PickIndex(result.pick) : null), [picking, result]);

  // Moving and resizing the title. Pressing it selects it and shows its
  // handles. It's laid out here as it's dragged and only stored when let go,
  // and drawn over the result until the render catches up (`placing`).
  const layout = useLayout();
  const label = useApp((s) => s.label);
  const customFontId = useApp((s) => s.customFontId);
  const widthM = useApp((s) => s.area.widthM);
  const bearing = useApp((s) => s.area.bearing);
  // The scale bar and north arrows follow the map. Other titles don't need it.
  const needsMap = label.style === 'legend' || label.style === 'badge';
  const metresPerMm = layout ? widthM / layout.window.w : 0;
  const mapInfo = useMemo(() => (needsMap && metresPerMm > 0 ? { metresPerMm, bearing } : null), [needsMap, metresPerMm, bearing]);
  const [dragged, setDragged] = useState<LabelSettings | null>(null);
  const shown = dragged ?? label;
  const draggable = canDrag(label.style);
  const title = useLabelArtwork(Boolean(result) && draggable, layout, shown, customFontId, mapInfo);
  const titleGrab = useRef<{ pointerId: number; start: Point; moved: boolean; drag: TitleDrag; to: LabelSettings | null; cursor: string } | null>(null);
  const [titleSelected, setTitleSelected] = useState(false);
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  useEffect(() => {
    if (props.upToDate) setPlacing(false);
  }, [props.upToDate, result, placing]);
  const ghost = (dragged !== null || placing) && title.artwork !== null && layout !== null;
  const unit = box && size.w > 0 ? box.w / size.w : 1;
  const handles = useMemo(() => {
    if (!titleSelected || picking || !title.artwork || !layout) return [];
    return spacedHandles(titleHandles(layout, shown, title.artwork), (x, y) => [x / unit, y / unit], HANDLE_GAP);
  }, [titleSelected, picking, title.artwork, layout, shown, unit]);
  useEffect(() => {
    if (!title.artwork) setTitleSelected(false);
  }, [title.artwork]);
  // Line numbers belong to one render.
  useEffect(() => {
    setSelected([]);
    setHoverLine(-1);
  }, [index]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!result || size.w === 0 || size.h === 0) return;
    // A short stage still keeps half its height for the piece, or the scale
    // and the view box went negative.
    const scale = Math.min(size.w / (result.width * 1.12), Math.max(size.h - 40, size.h / 2) / (result.height * 1.12));
    const w = size.w / scale;
    const h = size.h / scale;
    setBox({ x: result.width / 2 - w / 2, y: result.height / 2 - h / 2 + 20 / scale, w });
  }, [result, size]);

  // Only refit when the piece or the view changes size, so tweaking a setting keeps the zoom.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const shapeKey = result ? `${result.width}x${result.height}` : '';
  useEffect(() => fitRef.current(), [shapeKey, size.w, size.h]);

  // Zooms by factor, keeping the point at (px, py) on the stage still. Wheel
  // and gesture events can come faster than renders, so it builds on the
  // latest box.
  const zoomAt = (px: number, py: number, factor: number) => {
    if (size.w === 0) return;
    setBox((box) => {
      if (!box) return box;
      const w = clampWidth(box.w * factor);
      const before = box.w / size.w;
      const after = w / size.w;
      return { x: box.x + px * (before - after), y: box.y + py * (before - after), w };
    });
  };
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;

  // A trackpad pinch is a wheel event with ctrlKey in Chrome and Edge, and
  // React's wheel listener is passive, so it can't stop the page zooming too.
  // Safari sends gesture events instead.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let scale = 1;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const onGesture = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      // On iOS a pinch is also two pointers, which zoom already.
      if (e.type === 'gesturechange' && pointers.current.size === 0) {
        const rect = el.getBoundingClientRect();
        zoomRef.current(g.clientX - rect.left, g.clientY - rect.top, scale / g.scale);
      }
      scale = e.type === 'gesturestart' ? 1 : g.scale;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGesture);
    el.addEventListener('gesturechange', onGesture);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGesture);
      el.removeEventListener('gesturechange', onGesture);
    };
  }, []);

  const stagePoint = (e: React.PointerEvent | React.WheelEvent): Point => {
    const rect = ref.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const restart = () => {
    gesture.current = box && pointers.current.size > 0 ? { box, start: new Map(pointers.current) } : null;
    setDragging(pointers.current.size > 0);
  };
  // Where a stage point is on the piece, in mm, and a few pixels' reach there.
  const pieceAt = ([px, py]: Point): { x: number; y: number; k: number } | null => {
    if (!box || size.w === 0) return null;
    const k = box.w / size.w;
    return { x: box.x + px * k, y: box.y + py * k, k };
  };
  // A handle of the selected title, or the title itself, under a stage point.
  const gripAt = (point: Point): TitleGrip | null => {
    const at = pieceAt(point);
    if (!at || !title.artwork) return null;
    const handle = handleAt(handles, at.x, at.y, HANDLE_REACH * at.k);
    if (handle) return handle;
    return titleAt(shown, title.artwork, at.x, at.y) ? 'move' : null;
  };
  const cursorFor = (grip: TitleGrip) => {
    const spot = handles.find((h) => h.id === grip);
    return spot ? resizeCursor(spot.dx, spot.dy) : 'move';
  };
  const cancelTitleDrag = () => {
    titleGrab.current = null;
    setDragged(null);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!box) return;
    try {
      // Keeps the drag going outside the stage. Throws if the pointer is already gone.
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    const point = stagePoint(e);
    pointers.current.set(e.pointerId, point);
    pressed.current = pointers.current.size === 1 ? { point, moved: false } : null;
    if (titleGrab.current) {
      // A second finger puts the title back and pinches instead.
      cancelTitleDrag();
    } else if (pointers.current.size === 1 && !picking && e.button === 0 && title.artwork) {
      const grip = gripAt(point);
      if (grip) {
        titleGrab.current = { pointerId: e.pointerId, start: point, moved: false, drag: { grip, label, artwork: title.artwork }, to: null, cursor: cursorFor(grip) };
        setTitleSelected(true);
        return;
      }
    }
    restart();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const grab = titleGrab.current;
    if (grab && grab.pointerId === e.pointerId) {
      const point = stagePoint(e);
      pointers.current.set(e.pointerId, point);
      // A click that wobbles a pixel or two only selects it.
      if (!grab.moved && Math.hypot(point[0] - grab.start[0], point[1] - grab.start[1]) < DRAG_START_PX) return;
      grab.moved = true;
      if (!layout || !box || size.w === 0 || !title.layoutWith) return;
      const k = box.w / size.w;
      grab.to = dragTitle(layout, grab.drag, (point[0] - grab.start[0]) * k, (point[1] - grab.start[1]) * k, title.layoutWith);
      setDragged(grab.to);
      return;
    }
    if (!picking && !pointers.current.size) {
      const grip = gripAt(stagePoint(e));
      setHoverCursor(grip ? cursorFor(grip) : null);
    }
    if (picking && index && !pointers.current.size) {
      const at = pieceAt(stagePoint(e));
      if (at) setHoverLine(index.nearest(at.x, at.y, 8 * at.k));
    }
    const press = pressed.current;
    if (press && Math.hypot(stagePoint(e)[0] - press.point[0], stagePoint(e)[1] - press.point[1]) > 4) press.moved = true;
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId) || size.w === 0) return;
    pointers.current.set(e.pointerId, stagePoint(e));
    const [c0, d0] = spread(g.start);
    const [c1, d1] = spread(pointers.current);
    const w = clampWidth(d0 > 0 && d1 > 0 ? (g.box.w * d0) / d1 : g.box.w);
    // Keep the spot under the fingers' centre under it.
    const k0 = g.box.w / size.w;
    const k1 = w / size.w;
    setBox({ x: g.box.x + c0[0] * k0 - c1[0] * k1, y: g.box.y + c0[1] * k0 - c1[1] * k1, w });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const grab = titleGrab.current;
    if (grab && grab.pointerId === e.pointerId) {
      titleGrab.current = null;
      pressed.current = null;
      const placed = e.type !== 'pointercancel' && grab.to && title.layoutWith ? title.layoutWith(grab.to) : null;
      if (grab.to && placed) {
        setLabel(droppedLabel(grab.to, placed));
        setPlacing(true);
      }
      setDragged(null);
      restart();
      return;
    }
    restart();
    const press = pressed.current;
    pressed.current = null;
    // A click off the title lets go of it.
    if (!picking && press && !press.moved && e.type !== 'pointercancel') setTitleSelected(false);
    if (!picking || !index || !press || press.moved || e.type === 'pointercancel') return;
    const at = pieceAt(press.point);
    if (!at) return;
    // Picking is for several roads at once, so a click adds a road or drops it
    // again, and a click beside the roads doesn't lose the others.
    const line = index.nearest(at.x, at.y, 8 * at.k);
    if (line < 0) return;
    setSelected((current) => (current.includes(line) ? current.filter((l) => l !== line) : [...current, line]));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((titleGrab.current || titleSelected) && e.key === 'Escape') {
      if (titleGrab.current) cancelTitleDrag();
      else setTitleSelected(false);
      e.preventDefault();
      return;
    }
    if (picking && e.key === 'Escape') {
      if (selected.length) setSelected([]);
      else setPicking(false);
      e.preventDefault();
      return;
    }
    // Leave Ctrl/Cmd with +, - and 0 to the browser's own zoom.
    if (!box || size.w === 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = box.w / 10;
    const pan: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (pan[e.key]) setBox({ ...box, x: box.x + pan[e.key][0], y: box.y + pan[e.key][1] });
    else if (e.key === '+' || e.key === '=') zoomAt(size.w / 2, size.h / 2, 1 / 1.5);
    else if (e.key === '-' || e.key === '_') zoomAt(size.w / 2, size.h / 2, 1.5);
    else if (e.key === '0') fit();
    else return;
    e.preventDefault();
  };

  if (!result) {
    return (
      <div className="preview-stage" ref={ref}>
        <div className="preview-empty">
          {status === 'working' ? <span>Generating…</span> : error ? <span>{error}</span> : <span>No preview yet.</span>}
          {status !== 'working' ? (
            <button type="button" className="btn btn-primary" onClick={props.onGenerate}>
              Generate
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const h = box ? (box.w * size.h) / Math.max(size.w, 1) : 0;
  const pathCount = result.groups.reduce((n, g) => n + g.subpaths, 0);
  const km = (m: number) => (m / 1000).toFixed(2);
  const plotter = result.stats.plotter;
  const canGrab = draggable && title.artwork !== null;
  const hint = picking
    ? COARSE
      ? 'Tap roads to pick them, tap again to drop one'
      : 'Click roads to pick them, click again to drop one, Esc clears'
    : titleSelected
      ? `Drag the handles to resize the title. ${COARSE ? 'Tap' : 'Click'} the map to let go.`
      : canGrab
        ? `${COARSE ? 'Tap' : 'Click'} the title to move or resize it`
        : null;
  const card = picking || (titleSelected && title.artwork !== null);
  return (
    <div className={card ? 'preview-stage has-card' : 'preview-stage'} ref={ref}>
      <div
        className={dragging ? 'preview dragging' : 'preview'}
        style={{ cursor: titleGrab.current?.cursor ?? (picking ? 'crosshair' : (hoverCursor ?? undefined)) }}
        role="img"
        tabIndex={0}
        aria-label={`Preview of the SVG map, ${result.width.toFixed(1)} by ${result.height.toFixed(1)} mm. Arrow keys move it, plus and minus zoom, 0 fits it.`}
        onKeyDown={onKeyDown}
        onWheel={(e) => zoomAt(...stagePoint(e), Math.exp(e.deltaY * 0.0015))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverCursor(null)}
        onDoubleClick={fit}
      >
        {box ? (
          <svg viewBox={`${box.x} ${box.y} ${box.w} ${h}`} preserveAspectRatio="xMidYMid meet">
            <PreviewContent result={result} look={look} hideTitle={ghost} />
            {ghost && title.artwork && layout ? <TitleGhost artwork={title.artwork} result={result} look={look} layout={layout} /> : null}
            {!picking && title.artwork && canGrab && (titleSelected || hoverCursor) ? (
              <TitleFrame artwork={title.artwork} label={shown} handles={handles} selected={titleSelected} unit={unit} />
            ) : null}
            {picking && index ? <PickOverlay index={index} selected={selected} hover={hoverLine} unit={unit} routes={roadRoutes} /> : null}
          </svg>
        ) : null}
      </div>
      <div className="preview-toolbar">
        <button
          type="button"
          className={picking ? 'btn btn-small pick-toggle active' : 'btn btn-small pick-toggle'}
          aria-pressed={picking}
          title={picking ? 'Stop picking roads' : 'Pick roads to put in a road route of their own colour, or to leave out'}
          disabled={!result.pick}
          onClick={() => {
            setPicking(!picking);
            setSelected([]);
            setTitleSelected(false);
          }}
        >
          Pick roads
        </button>
        {result.mode === 'laser' ? (
          <Select<PreviewLook>
            label="Preview colours"
            className="select preview-look"
            value={look}
            options={[
              ...Object.entries(MATERIALS).map(([value, m]) => ({ value: value as MaterialId, label: m.name })),
              { value: 'colors', label: 'File colours' },
            ]}
            onChange={setLook}
          />
        ) : null}
        <div className="button-group">
          <button type="button" className="btn btn-small" aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.5)}>
            +
          </button>
          <button type="button" className="btn btn-small" aria-label="Zoom out" title="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.5)}>
            −
          </button>
          <button type="button" className="btn btn-small" onClick={fit}>
            Fit
          </button>
        </div>
      </div>
      {picking ? (
        <RoadRouteCard index={index} selected={selected} onSelect={setSelected} onClose={() => setPicking(false)} />
      ) : titleSelected && title.artwork ? (
        <TitleCard label={label} onChange={setLabel} onClose={() => setTitleSelected(false)} />
      ) : null}
      {result.warnings.length || error ? (
        <div className="preview-notices">
          {error ? <div className="notice error">{error}</div> : null}
          {result.warnings.map((w) => (
            <div key={w} className="notice">
              {w}
            </div>
          ))}
        </div>
      ) : null}
      <div className="preview-footer">
        <span>
          {result.width.toFixed(1)} × {result.height.toFixed(1)} mm
        </span>
        <span>1:{result.meta.scale.toLocaleString()}</span>
        <span>
          {km(result.meta.widthM)} × {km(result.meta.heightM)} km
        </span>
        <span>{pathCount.toLocaleString()} paths</span>
        {result.stats.overtureBuildings !== undefined ? (
          <span>
            {result.stats.overtureBuildings.toLocaleString()} {result.stats.overtureBuildings === 1 ? 'building' : 'buildings'} added from Overture
          </span>
        ) : null}
        {result.stats.sidewalksLeftOutM !== undefined ? (
          <span>
            {result.stats.sidewalksLeftOutM >= 1000 ? `${km(result.stats.sidewalksLeftOutM)} km` : `${Math.round(result.stats.sidewalksLeftOutM)} m`} of sidewalks and
            crossings left out
          </span>
        ) : null}
        {result.stats.coverage !== null ? <span>{(result.stats.coverage * 100).toFixed(1)}% of roads kept</span> : null}
        {plotter ? (
          <span>
            {plotter.pens} {plotter.pens === 1 ? 'pen' : 'pens'}, {(plotter.penDownMm / 1000).toFixed(1)} m drawn, {(plotter.penUpMm / 1000).toFixed(1)} m pen-up
          </span>
        ) : null}
      </div>
      {hint ? <div className="preview-hint">{hint}</div> : null}
    </div>
  );
}
