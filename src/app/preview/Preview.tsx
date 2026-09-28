import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { OutputGroup, RenderResult } from '../../engine/result.ts';
import type { ElementId } from '../../engine/settings.ts';
import { useRender } from '../render.ts';

type Look = 'material' | 'colors';

interface Box {
  x: number;
  y: number;
  w: number;
}

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

function groupPaint(group: OutputGroup, result: RenderResult, look: Look) {
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

const PreviewContent = memo(function PreviewContent(props: { result: RenderResult; look: Look }) {
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

export function Preview(props: { onGenerate: () => void }) {
  const result = useRender((s) => s.result);
  const status = useRender((s) => s.status);
  const error = useRender((s) => s.error);
  const [look, setLook] = useState<Look>('material');
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; box: Box } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!result || size.w === 0) return;
    const scale = Math.min(size.w / (result.width * 1.12), (size.h - 40) / (result.height * 1.12));
    const w = size.w / scale;
    const h = size.h / scale;
    setBox({ x: result.width / 2 - w / 2, y: result.height / 2 - h / 2 + 20 / scale, w });
  }, [result, size]);

  // Only refit when the piece or the view changes size, so tweaking a setting keeps the zoom.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const shapeKey = result ? `${result.width}x${result.height}` : '';
  useEffect(() => fitRef.current(), [shapeKey, size.w, size.h]);

  const onWheel = (e: React.WheelEvent) => {
    if (!box || size.w === 0) return;
    const rect = ref.current!.getBoundingClientRect();
    const factor = Math.exp(e.deltaY * 0.0015);
    const px = (e.clientX - rect.left) / size.w;
    const py = (e.clientY - rect.top) / size.h;
    const h = (box.w * size.h) / size.w;
    const w = Math.min(Math.max(box.w * factor, 2), 5000);
    const nh = (w * size.h) / size.w;
    setBox({ x: box.x + px * (box.w - w), y: box.y + py * (h - nh), w });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!box) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, box };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || size.w === 0) return;
    const k = d.box.w / size.w;
    setBox({ x: d.box.x - (e.clientX - d.x) * k, y: d.box.y - (e.clientY - d.y) * k, w: d.box.w });
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
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
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
          <div className="segmented">
            <button type="button" className={look === 'material' ? 'active' : undefined} onClick={() => setLook('material')}>
              Wood
            </button>
            <button type="button" className={look === 'colors' ? 'active' : undefined} onClick={() => setLook('colors')}>
              Colours
            </button>
          </div>
        ) : null}
        <button type="button" className="btn btn-small" onClick={fit}>
          Fit
        </button>
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
