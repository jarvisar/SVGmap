// Pins and text in the preview: the marks drawn on the main thread while
// they're dragged or edited, their frames and handles, and the tools.
import { type ReactNode, useEffect, useRef } from 'react';
import { markLabel } from '../../engine/marks/draw.ts';
import { type MapMark, markName, markTextFill } from '../../engine/marks/marks.ts';
import { MARK_SHAPES, type MarkShape, SHAPE_ORDER } from '../../engine/marks/shapes.ts';
import { fmt, polylineD } from '../../engine/svg/format.ts';
import { MarkIcon } from '../components/MarkIcon.tsx';
import { type MarkHandle, type PlacedMark, markCorners } from '../markDrag.ts';
import { selectMark } from '../marks.ts';
import { MarkEditor } from '../panels/MarkEditor.tsx';
import { MarkIdeas } from '../panels/MarksPanel.tsx';

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;

// Grows in from its spot with a little overshoot. SMIL rather than CSS, since
// it scales around the spot, which is the origin here. Started by hand: an
// animation added after the page loaded would count as long finished.
function DropIn(props: { children: ReactNode }) {
  const ref = useRef<SVGAnimateTransformElement>(null);
  useEffect(() => {
    if (!REDUCED_MOTION) ref.current?.beginElement();
  }, []);
  return (
    <g>
      {props.children}
      <animateTransform ref={ref} attributeName="transform" type="scale" values="0.3;1.12;1" keyTimes="0;0.6;1" dur="0.28s" begin="indefinite" fill="freeze" />
    </g>
  );
}

const rings = (paths: readonly (readonly [number, number])[][]) => paths.map((r) => polylineD(r, true)).join('');
const lines = (paths: readonly (readonly [number, number])[][]) => paths.map((p) => polylineD(p)).join('');

/**
 * The marks laid out here, drawn over the map. A rough version of the
 * render: what a mark clears is painted over in the paper colour, holes are
 * painted rather than cut, and hatching is drawn solid.
 */
export function MarkDrawing(props: {
  items: PlacedMark[];
  inkOf: (mark: MapMark) => string;
  paper: string;
  windowD: string;
  clipId: string;
  lineWidth?: number;
  // Map overlays keep outlines at this screen width as the camera zooms.
  screenLineWidth?: number;
  // A mark just added, which drops in.
  fresh?: string | null;
}) {
  const { items, inkOf, paper, windowD, clipId } = props;
  const width = props.screenLineWidth ?? props.lineWidth ?? 0.25;
  const vectorEffect = props.screenLineWidth === undefined ? undefined : 'non-scaling-stroke';
  return (
    <g pointerEvents="none">
      <clipPath id={clipId}>
        <path d={windowD} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {items.map(({ mark, art, at }) => {
          if (art.empty) return null;
          const ink = inkOf(mark);
          const outer = rings([...art.fill, ...art.extra]);
          const letters = rings(art.text.rings);
          const strokes = lines(art.text.strokes);
          const gap = mark.clear ? mark.gap : 0;
          const outline = mark.fill === 'outline';
          const textFill = markTextFill(mark);
          const textOutline = textFill === 'outline';
          const letterInk = art.inside ? paper : ink;
          const drawn = (
            <>
              {mark.clear ? (
                <>
                  <path d={outer + letters} fill={paper} stroke={gap > 0 ? paper : 'none'} strokeWidth={gap * 2} />
                  {strokes ? <path d={strokes} fill="none" stroke={paper} strokeWidth={gap * 2 + 0.3} /> : null}
                </>
              ) : null}
              {art.fill.length ? (
                <path d={rings(art.fill)} fill={outline ? 'none' : ink} fillOpacity={mark.fill === 'hatch' || mark.fill === 'contour' ? 0.75 : 1} stroke={outline ? ink : 'none'} strokeWidth={width} vectorEffect={vectorEffect} />
              ) : null}
              {art.holes.length ? <path d={rings(art.holes)} fill={outline ? 'none' : paper} stroke={outline ? ink : 'none'} strokeWidth={width} vectorEffect={vectorEffect} /> : null}
              {art.extra.length ? <path d={rings(art.extra)} fill={outline ? 'none' : ink} stroke={outline ? ink : 'none'} strokeWidth={width} vectorEffect={vectorEffect} /> : null}
              {letters ? (
                <path
                  d={letters}
                  fill={textOutline && !art.inside ? 'none' : letterInk}
                  fillOpacity={textFill === 'hatch' || textFill === 'contour' ? 0.75 : 1}
                  stroke={textOutline ? ink : 'none'}
                  strokeWidth={width}
                  vectorEffect={vectorEffect}
                />
              ) : null}
              {strokes ? <path d={strokes} fill="none" stroke={letterInk} strokeWidth={art.inside ? 0.4 : 0.3} /> : null}
            </>
          );
          return (
            <g key={mark.id} transform={`translate(${fmt(at[0])} ${fmt(at[1])})`} strokeLinecap="round" strokeLinejoin="round">
              {mark.id === props.fresh ? <DropIn>{drawn}</DropIn> : drawn}
            </g>
          );
        })}
      </g>
    </g>
  );
}

/**
 * Outlines of the marks: faint for all of them while editing, dashed under
 * the pointer and solid with handles when selected. unit is mm per pixel.
 */
export function MarkFrames(props: { items: PlacedMark[]; selected: string | null; hover: string | null; editing: boolean; handles: MarkHandle[]; unit: number }) {
  const { items, selected, hover, editing, handles, unit } = props;
  const s = 9 * unit;
  const chosen = items.find((p) => p.mark.id === selected);
  const rotate = handles.find((h) => h.id === 'rotate');
  const top = chosen ? markCorners(chosen, 3 * unit).slice(0, 2) : null;
  return (
    <g pointerEvents="none">
      {items.map((p) => {
        const className = p.mark.id === selected ? 'title-frame' : p.mark.id === hover ? 'title-grab' : editing ? 'mark-outline' : null;
        if (!className) return null;
        const points = markCorners(p, 3 * unit).map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
        return <polygon key={p.mark.id} className={className} points={points} />;
      })}
      {rotate && top ? (
        <line className="mark-rotate-stem" x1={fmt((top[0][0] + top[1][0]) / 2)} y1={fmt((top[0][1] + top[1][1]) / 2)} x2={fmt(rotate.x)} y2={fmt(rotate.y)} />
      ) : null}
      {handles.map((h) =>
        h.id === 'rotate' ? (
          <circle key={h.id} className="mark-rotate" cx={fmt(h.x)} cy={fmt(h.y)} r={fmt(s * 0.6)} />
        ) : (
          <rect key={h.id} className="title-handle" x={fmt(h.x - s / 2)} y={fmt(h.y - s / 2)} width={fmt(s)} height={fmt(s)} />
        ),
      )}
    </g>
  );
}

// Keys that pick a tool while the preview has the focus.
export const TOOL_KEYS: Record<string, MarkShape | null> = { v: null, t: 'none', p: 'pin', h: 'heart', s: 'star' };
const KEY_OF: Partial<Record<MarkShape | 'select', string>> = { select: 'V', none: 'T', pin: 'P', heart: 'H', star: 'S' };

function SelectIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5 2.5v12l3.2-3.1 2.2 4.8 2-.9-2.2-4.7h4.3z" fill="currentColor" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The tools down the side of the preview. A click on a shape picks it for
 * the next click on the map. From the keyboard, a shape goes straight on the
 * map instead, near the middle, since there's nothing to point with.
 * Arrow keys move between the tools, as in any toolbar.
 */
export function MarkPalette(props: { tool: MarkShape | null; onTool: (tool: MarkShape | null) => void; onAdd: (shape: MarkShape) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const tools: (MarkShape | 'select')[] = ['select', 'none', ...SHAPE_ORDER.filter((s) => s !== 'none')];
  const active = props.tool ?? 'select';
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && props.tool) {
      props.onTool(null);
      return;
    }
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const buttons = [...(ref.current?.querySelectorAll('button') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + step! + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <div className="mark-palette" role="toolbar" aria-label="Pins and text" aria-orientation="vertical" ref={ref} onKeyDown={onKeyDown}>
      {tools.map((tool) => {
        const name = tool === 'select' ? 'Select and move' : tool === 'none' ? 'Text' : MARK_SHAPES[tool].name;
        const key = KEY_OF[tool];
        const on = tool === active;
        return (
          <button
            key={tool}
            type="button"
            className={on ? 'mark-tool active' : 'mark-tool'}
            aria-pressed={on}
            aria-label={tool === 'select' ? name : `Add ${tool === 'none' ? 'text' : `a ${name.toLowerCase()}`}`}
            title={key ? `${name} (${key})` : name}
            tabIndex={on ? 0 : -1}
            onClick={(e) => {
              if (tool === 'select') props.onTool(null);
              // A click from the keyboard has no pointer position.
              else if (e.detail === 0) props.onAdd(tool);
              else props.onTool(on ? null : tool);
            }}
          >
            {tool === 'select' ? <SelectIcon /> : <MarkIcon shape={tool} />}
          </button>
        );
      })}
    </div>
  );
}

// Beside the preview: the selected mark's settings, or how to add one and
// the marks already on the map.
export function MarkCard(props: { marks: MapMark[]; selected: MapMark | null; editing: boolean; onClose: () => void }) {
  const { marks, selected, editing } = props;
  return (
    <section className="preview-card" aria-label={selected ? markLabel(selected) : 'Pins and text'}>
      <header className="preview-card-header">
        <h2>{selected ? markLabel(selected) : 'Pins & text'}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={selected ? 'Let go of it' : 'Stop editing pins and text'}
          title={selected ? 'Let go of it' : 'Done'}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      {selected ? (
        <>
          <p className="preview-card-text">Drag it to move it, a corner to resize it, or the round handle to turn it.</p>
          <MarkEditor key={selected.id} mark={selected} />
          {editing ? (
            <p className="preview-card-note">Arrow keys nudge it, Shift for further. R turns it, Delete removes it and {MOD}+D makes a copy.</p>
          ) : null}
        </>
      ) : (
        <>
          <p className="preview-card-text">
            {COARSE
              ? 'Pick a shape or text from the tools, then tap the map to put it there. Tap one on the map to change it.'
              : 'Pick a shape or text from the tools, then click the map to put it there. Click one on the map to change it.'}
          </p>
          <div className="field">
            <span className="field-label">Ideas</span>
            <MarkIdeas />
          </div>
          {marks.length ? (
            <div className="field">
              <span className="field-label">On the map</span>
              <ul className="mark-list">
                {marks.map((mark) => (
                  <li key={mark.id}>
                    <button type="button" className="mark-row-name" onClick={() => selectMark(mark.id)}>
                      <MarkIcon shape={mark.shape} size={14} />
                      <span>{markName(mark)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
