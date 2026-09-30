import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { OutputGroup, RenderResult } from '../../engine/result.ts';
import type { ElementId } from '../../engine/settings.ts';
import { Segmented } from '../components/controls.tsx';
import { useRender } from '../render.ts';
import { type PreviewLook, useApp } from '../store.ts';

// The part of the piece in view, in mm. The height follows the stage.
interface Box {
  x: number;
  y: number;
  w: number;
}

type Point = [number, number];

const WOOD = '#E8D2AC';
const BURN = '#3A2415';
// Rough darkness of each fill in the wood preview, since each gets its own process.
const BURN_OPACITY: Partial<Record<ElementId, number>> = {
  buildings: 0.92,
  text: 0.95,
  band: 0.95,
  water: 0.7,
  aeroways: 0.6,
  rocks: 0.5,
  greens: 0.38,
  sand: 0.25,
  decks: 0.3,
};

function groupPaint(group: OutputGroup, result: RenderResult, look: PreviewLook) {
  const laserMaterial = result.mode === 'laser' && look === 'material';
  if (group.id === 'cut') {
    return { fill: 'none', stroke: laserMaterial ? 'rgba(0,0,0,0.35)' : group.color, strokeWidth: laserMaterial ? 0.3 : Math.max(group.strokeWidth, 0.12) };
  }
  if (group.kind === 'fill') {
    return laserMaterial
      ? { fill: BURN, fillOpacity: BURN_OPACITY[group.element] ?? 0.8, stroke: 'none' }
      : { fill: group.color, stroke: 'none' };
  }
  const width = result.mode === 'laser' ? 0.12 : group.strokeWidth;
  return laserMaterial
    ? { fill: 'none', stroke: BURN, strokeOpacity: 0.85, strokeWidth: width }
    : { fill: 'none', stroke: group.color, strokeWidth: width };
}

const PreviewContent = memo(function PreviewContent(props: { result: RenderResult; look: PreviewLook }) {
  const { result, look } = props;
  const background =
    result.mode === 'laser' ? (look === 'material' ? WOOD : '#fff') : (result.background ?? '#fff');
  return (
    <g>
      <path d={result.outline} fill={background} />
      {result.groups.map((group) => {
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

export function Preview(props: { onGenerate: () => void }) {
  const result = useRender((s) => s.result);
  const status = useRender((s) => s.status);
  const error = useRender((s) => s.error);
  const look = useApp((s) => s.previewLook);
  const setLook = useApp((s) => s.setPreviewLook);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useRef<HTMLDivElement>(null);
  // Pointers down on the stage, in stage pixels. Dragging and pinching both
  // work from where the gesture started, so they don't drift.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ box: Box; start: Map<number, Point> } | null>(null);
  const [dragging, setDragging] = useState(false);

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

  // Zooms by factor, keeping the point at (px, py) on the stage still.
  const zoomAt = (px: number, py: number, factor: number) => {
    if (!box || size.w === 0) return;
    const w = clampWidth(box.w * factor);
    const before = box.w / size.w;
    const after = w / size.w;
    setBox({ x: box.x + px * (before - after), y: box.y + py * (before - after), w });
  };

  const stagePoint = (e: React.PointerEvent | React.WheelEvent): Point => {
    const rect = ref.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const restart = () => {
    gesture.current = box && pointers.current.size > 0 ? { box, start: new Map(pointers.current) } : null;
    setDragging(pointers.current.size > 0);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!box) return;
    try {
      // Keeps the drag going outside the stage. Throws if the pointer is already gone.
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    pointers.current.set(e.pointerId, stagePoint(e));
    restart();
  };
  const onPointerMove = (e: React.PointerEvent) => {
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
    restart();
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
  return (
    <div className="preview-stage" ref={ref}>
      <div
        className={dragging ? 'preview dragging' : 'preview'}
        onWheel={(e) => zoomAt(...stagePoint(e), Math.exp(e.deltaY * 0.0015))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={fit}
      >
        {box ? (
          <svg viewBox={`${box.x} ${box.y} ${box.w} ${h}`} preserveAspectRatio="xMidYMid meet">
            <PreviewContent result={result} look={look} />
          </svg>
        ) : null}
      </div>
      <div className="preview-toolbar">
        {result.mode === 'laser' ? (
          <Segmented<PreviewLook>
            label="Preview colours"
            value={look}
            options={[
              { value: 'material', label: 'Wood' },
              { value: 'colors', label: 'Colours' },
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
        {result.stats.coverage !== null ? <span>{(result.stats.coverage * 100).toFixed(1)}% of roads kept</span> : null}
        {result.stats.plotter ? (
          <span>
            {(result.stats.plotter.penDownMm / 1000).toFixed(1)} m drawn, {(result.stats.plotter.penUpMm / 1000).toFixed(1)} m pen-up
          </span>
        ) : null}
      </div>
    </div>
  );
}
