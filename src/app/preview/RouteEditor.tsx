// Editing routes in the preview: the route drawn with handles over the map,
// dragging and drawing, the keys, and the card beside the preview.
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '../../engine/lines/geometry.ts';
import { type PathHit, handleIndexes, nearestOnLines, spanLengthM } from '../../engine/routes/edit.ts';
import { nearestRoad } from '../../engine/routes/roadGraph.ts';
import { decodeRoute, routeLengthM } from '../../engine/routes/route.ts';
import type { RouteData } from '../../engine/settings.ts';
import type { RenderResult } from '../../engine/result.ts';
import { fmt, polylineD } from '../../engine/svg/format.ts';
import { Check, NumberInput, Segmented, Slider } from '../components/controls.tsx';
import { flash } from '../flash.ts';
import {
  type RoutePoint,
  type RouteSection,
  type RouteTool,
  type SpanEdit,
  applySpan,
  backToStart,
  connect,
  cutSection,
  drawTo,
  editSpace,
  insertEdit,
  isChanged,
  mmFor,
  moveEdit,
  removeEdit,
  reverseRoute,
  revertRoute,
  roadGraphFor,
  selectRoutePoint,
  selectSection,
  setEditedRoute,
  setFollow,
  setRouteEditing,
  setRouteTool,
  setSnapDistance,
  SNAP_LIMITS,
  snapToRoads,
  startSection,
  straightenSection,
  trimRouteEnd,
  useRouteEdit,
} from '../routeEdit.ts';
import { useApp } from '../store.ts';

const COARSE = matchMedia('(pointer: coarse)').matches;
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';

// In screen pixels. Handles are kept apart enough to grab, and fingers get more room.
const HANDLE_GAP = COARSE ? 34 : 22;
const HANDLE_TOLERANCE = 3;
const HANDLE_REACH = COARSE ? 18 : 10;
const HANDLE_R = COARSE ? 6.5 : 4.5;
const LINE_REACH = COARSE ? 14 : 7;
const DRAG_START = 4;
// Arrow keys move a point this far, in mm on the piece. Shift for further.
const NUDGE = 0.5;
const NUDGE_FAR = 5;

interface Grab {
  pointerId: number;
  kind: 'point' | 'insert';
  line: number;
  index: number;
  segment: number;
  t: number;
  before: number;
  after: number;
  start: Point;
  moved: boolean;
}

type Hover = { kind: 'point'; line: number; index: number } | { kind: 'line'; hit: PathHit } | null;

export interface RouteEditor {
  overlay: ReactNode;
  card: ReactNode;
  hint: string | null;
  label: string | null;
  cursor: string | null;
  /** A press on the preview. True when it grabbed a point or the line. */
  down(at: Point, e: React.PointerEvent): boolean;
  /** True while it's dragging that pointer. */
  move(at: Point, e: React.PointerEvent): boolean;
  hover(at: Point | null, alt: boolean): void;
  /** True when it was dragging that pointer. */
  up(e: React.PointerEvent): boolean;
  /** A press that didn't move and didn't grab anything. */
  click(at: Point, e: React.PointerEvent): void;
  doubleClick(at: Point): boolean;
  key(e: React.KeyboardEvent): boolean;
  cancel(): void;
}

/** unit is mm per screen pixel. */
export function useRouteEditor(active: boolean, unit: number, result: RenderResult | null): RouteEditor {
  const { routeId, selected, section, sectionFrom, follow, snapM, tool, draft } = useRouteEdit();
  const items = useApp((s) => s.routes.items);
  const bandWidth = useApp((s) => s.routes.width);
  const routeColor = useApp((s) => s.styles[s.mode].colors.route);
  const area = useApp((s) => s.area);
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);
  const space = useMemo(() => editSpace({ area, product, border }), [area, product, border]);
  const route = items.find((r) => r.id === routeId) ?? null;
  const lonLat = useMemo(() => (route ? decodeRoute(route) : []), [route]);
  const mm = useMemo(() => (space && active ? lonLat.map((line) => line.map(space.toMm)) : []), [lonLat, space, active]);
  const others = useMemo(
    () => (space && active ? items.filter((r) => r.visible && r.id !== routeId).map((r) => ({ route: r, lines: decodeRoute(r).map((l) => l.map(space.toMm)) })) : []),
    [items, routeId, space, active],
  );
  const graph = useMemo(() => (active ? roadGraphFor(result?.pick, space) : null), [active, result, space]);
  const roads = follow ? graph : null;

  // Handles follow the zoom in quarter steps, so a scroll doesn't redo them every frame.
  const step = 2 ** (Math.round(Math.log2(Math.max(unit, 1e-6)) * 4) / 4);
  const handles = useMemo(
    () =>
      mm.map((path, line) => {
        const keep: number[] = [];
        if (selected?.line === line) keep.push(selected.index);
        if (section?.line === line) keep.push(section.from, section.to);
        return handleIndexes(path, HANDLE_TOLERANCE * step, HANDLE_GAP * step, keep);
      }),
    [mm, step, selected, section],
  );
  const flat = useMemo(() => handles.flatMap((list, line) => list.map((index) => ({ line, index }))), [handles]);

  const grab = useRef<Grab | null>(null);
  const [preview, setPreview] = useState<{ edit: SpanEdit; snapped: boolean } | null>(null);
  const latestPreview = useRef<typeof preview>(null);
  const [hovered, setHovered] = useState<Hover>(null);
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const [announce, setAnnounce] = useState('');

  // An undo can take away the point or line that was selected.
  useEffect(() => {
    if (selected && !lonLat[selected.line]?.[selected.index]) selectRoutePoint(null);
    if (section && (!lonLat[section.line] || section.to >= lonLat[section.line].length)) selectSection(null);
  }, [lonLat, selected, section]);
  useEffect(() => {
    if (routeId && !route) setEditedRoute(null);
  }, [routeId, route]);
  useEffect(() => {
    if (!active) {
      grab.current = null;
      latestPreview.current = null;
      setPreview(null);
      setHovered(null);
      setDrawing(null);
    }
  }, [active]);
  useEffect(() => setDrawing(null), [tool]);

  const handleAt = (at: Point): RoutePoint | null => {
    let best: RoutePoint | null = null;
    let bestD = HANDLE_REACH * unit;
    handles.forEach((list, line) =>
      list.forEach((index) => {
        const p = mm[line][index];
        const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
        if (d <= bestD) {
          bestD = d;
          best = { line, index };
        }
      }),
    );
    return best;
  };
  // The handles either side of a point, or the point itself at an end.
  const neighbours = (line: number, index: number): [number, number] => {
    const list = handles[line] ?? [];
    let before = index;
    let after = index;
    for (const h of list) {
      if (h < index) before = h;
      else if (h > index) {
        after = h;
        break;
      }
    }
    return [before, after];
  };
  const target = (at: Point, free: boolean): { to: Point; snapped: boolean } => {
    if (roads && !free && space) {
      const spot = nearestRoad(roads, at, mmFor(space, snapM));
      if (spot) return { to: spot.point, snapped: true };
    }
    return { to: at, snapped: false };
  };
  const pointName = (p: RoutePoint) => {
    const n = flat.findIndex((h) => h.line === p.line && h.index === p.index);
    const end = p.line === 0 && p.index === 0 ? ', the start' : p.line === mm.length - 1 && p.index === mm[p.line].length - 1 ? ', the finish' : '';
    return n >= 0 ? `Point ${n + 1} of ${flat.length}${end}` : `Point${end}`;
  };
  const say = (text: string) => setAnnounce(text);

  const remove = (p: RoutePoint) => {
    if (!route || !space) return;
    const [before, after] = neighbours(p.line, p.index);
    applySpan(route, removeEdit(mm[p.line], p.line, before, p.index, after, roads, space), 'Delete route point', space, 'Deleted the point');
  };
  // follow false bends the stretches either side instead of rerouting them.
  const moveTo = (p: RoutePoint, to: Point, label: string | null, done?: string, follow = true) => {
    if (!route || !space) return;
    const [before, after] = neighbours(p.line, p.index);
    applySpan(route, moveEdit(mm[p.line], p.line, before, p.index, after, to, follow ? roads : null, space), label, space, done);
  };
  const snapPoint = (p: RoutePoint) => {
    if (!space || !graph) return;
    const spot = nearestRoad(graph, mm[p.line][p.index], mmFor(space, snapM));
    if (!spot) {
      flash(`No road or path within ${snapM} m of this point. A bigger snap distance reaches further.`, 4000);
      return;
    }
    moveTo(p, spot.point, 'Snap route point to road', 'Moved the point onto the road');
  };

  const editor: RouteEditor = {
    overlay: null,
    card: null,
    hint: null,
    label: null,
    cursor: null,
    down(at, e) {
      if (!active || !route || !space) return false;
      const hit = handleAt(at);
      if (hit) {
        const [before, after] = neighbours(hit.line, hit.index);
        grab.current = { pointerId: e.pointerId, kind: 'point', line: hit.line, index: hit.index, segment: 0, t: 0, before, after, start: at, moved: false };
        return true;
      }
      if (tool === 'draw') return false;
      const line = nearestOnLines(mm, at, LINE_REACH * unit);
      if (line) {
        const list = handles[line.line];
        const before = [...list].reverse().find((h) => h <= line.segment) ?? 0;
        const after = list.find((h) => h >= line.segment + 1) ?? mm[line.line].length - 1;
        grab.current = { pointerId: e.pointerId, kind: 'insert', line: line.line, index: -1, segment: line.segment, t: line.t, before, after, start: at, moved: false };
        return true;
      }
      return false;
    },
    move(at, e) {
      const held = grab.current;
      if (!held || held.pointerId !== e.pointerId || !space) return false;
      if (!held.moved && Math.hypot(at[0] - held.start[0], at[1] - held.start[1]) < DRAG_START * unit) return true;
      held.moved = true;
      const { to, snapped } = target(at, e.altKey);
      const path = mm[held.line];
      if (!path) return true;
      // Following roads, a point that isn't on one joins its neighbours straight.
      const via = roads ? (snapped ? roads : 'straight') : null;
      const edit =
        held.kind === 'point'
          ? moveEdit(path, held.line, held.before, held.index, held.after, to, via, space)
          : insertEdit(path, held.line, held.segment, held.t, held.before, held.after, to, via, space);
      latestPreview.current = { edit, snapped };
      setPreview(latestPreview.current);
      return true;
    },
    hover(at, alt) {
      if (!active || grab.current || !space) return;
      if (!at) {
        setHovered(null);
        setDrawing(null);
        return;
      }
      const hit = route ? handleAt(at) : null;
      if (hit) setHovered({ kind: 'point', ...hit });
      else if (tool !== 'draw' && route) {
        const line = nearestOnLines(mm, at, LINE_REACH * unit);
        setHovered(line ? { kind: 'line', hit: line } : null);
      } else setHovered(null);
      if (tool === 'draw' && !hit) {
        const { to, snapped } = target(at, alt);
        const from = drawFrom();
        setDrawing(from ? connect(from, to, snapped ? roads : null, space) : null);
      } else setDrawing(null);
    },
    up(e) {
      const held = grab.current;
      if (!held || held.pointerId !== e.pointerId) return false;
      grab.current = null;
      // Pointerup can arrive before React draws the last pointermove.
      const done = latestPreview.current;
      latestPreview.current = null;
      setPreview(null);
      if (e.type === 'pointercancel' || !route || !space) return true;
      if (!held.moved) {
        if (held.kind !== 'point') return true;
        const p = { line: held.line, index: held.index };
        // The other end of a section: after Pick a section, or with Shift.
        const anchor = sectionFrom ?? (e.shiftKey ? (section ? { line: section.line, index: section.from } : selected) : null);
        if (sectionFrom && sectionFrom.line !== p.line) {
          flash('Pick a point on the same piece of the route. A gap splits it in two.');
        } else if (anchor && anchor.line === p.line && anchor.index !== p.index) {
          const s = { line: p.line, from: Math.min(anchor.index, p.index), to: Math.max(anchor.index, p.index) };
          selectSection(s);
          say(sectionName(s));
        } else {
          selectRoutePoint(p);
          say(pointName(p));
        }
        return true;
      }
      if (done) applySpan(route, done.edit, held.kind === 'point' ? 'Move route point' : 'Add route point', space);
      return true;
    },
    click(at, e) {
      if (!active || !space || e.button !== 0) return;
      if (tool === 'draw') {
        const { to, snapped } = target(at, e.altKey);
        drawTo(to, snapped ? roads : null, space);
        setDrawing(null);
        return;
      }
      const other = others.find((o) => nearestOnLines(o.lines, at, LINE_REACH * unit));
      if (other) {
        setEditedRoute(other.route.id);
        flash(`Editing ${other.route.name}`);
        return;
      }
      if (selected || section) {
        selectRoutePoint(null);
        say('Nothing selected');
      }
    },
    doubleClick(at) {
      if (!active || tool === 'draw') return false;
      const hit = handleAt(at);
      if (!hit) return false;
      remove(hit);
      return true;
    },
    key(e) {
      if (!active) return false;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (grab.current) {
        if (e.key !== 'Escape') return false;
        editor.cancel();
        return true;
      }
      if (e.key === 'Escape') {
        if (draft) useRouteEdit.setState({ draft: null });
        else if (sectionFrom) startSection(null);
        else if (tool === 'draw') setRouteTool('move');
        else if (selected || section) selectRoutePoint(null);
        else setRouteEditing(false);
        return true;
      }
      if (!plain) return false;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        setFollow(!follow);
        flash(follow ? 'Follow roads off' : 'Follow roads on');
        return true;
      }
      if (key === 'd') {
        setRouteTool('draw');
        return true;
      }
      if (key === 'v' || (e.key === 'Enter' && tool === 'draw')) {
        setRouteTool('move');
        return true;
      }
      if (!route || !space) return false;
      // Comma and period, or < and > with Shift, step through the handles.
      // The key's place too, since Shift turns them into other characters on some layouts.
      const forward = e.key === '.' || e.key === '>' || e.code === 'Period' || e.key === 'End';
      const back = e.key === ',' || e.key === '<' || e.code === 'Comma' || e.key === 'Home';
      if ((forward || back) && flat.length) {
        const current = section ? { line: section.line, index: forward ? section.to : section.from } : selected;
        let i = current ? flat.findIndex((h) => h.line === current.line && h.index === current.index) : -1;
        if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = flat.length - 1;
        else if (i < 0) i = forward ? 0 : flat.length - 1;
        else i = Math.max(0, Math.min(flat.length - 1, i + (forward ? 1 : -1)));
        const next = flat[i];
        const anchor = section ? { line: section.line, index: forward ? section.from : section.to } : selected;
        if (e.shiftKey && anchor && anchor.line === next.line && anchor.index !== next.index) {
          const s = { line: next.line, from: Math.min(anchor.index, next.index), to: Math.max(anchor.index, next.index) };
          selectSection(s);
          say(sectionName(s));
        } else {
          selectRoutePoint(next);
          say(pointName(next));
        }
        return true;
      }
      const nudges: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (selected && nudges[e.key]) {
        const d = e.shiftKey ? NUDGE_FAR : NUDGE;
        const p = mm[selected.line]?.[selected.index];
        // A nudge is for fine placing, so it never reroutes. S snaps to a road.
        if (p) moveTo(selected, [p[0] + nudges[e.key][0] * d, p[1] + nudges[e.key][1] * d], null, undefined, false);
        return true;
      }
      if (selected && key === 's') {
        snapPoint(selected);
        return true;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (section) cutSection(route, section);
        else if (selected) remove(selected);
        else return false;
        return true;
      }
      return false;
    },
    cancel() {
      grab.current = null;
      latestPreview.current = null;
      setPreview(null);
    },
  };

  // Where a click with the draw tool carries on from.
  function drawFrom(): Point | null {
    if (!space) return null;
    if (!route) return draft ? space.toMm(draft) : null;
    if (selected?.index === 0 && mm[selected.line]) return mm[selected.line][0];
    const line = selected && mm[selected.line] && selected.index === mm[selected.line].length - 1 ? selected.line : mm.length - 1;
    const path = mm[line];
    return path ? path[path.length - 1] : null;
  }

  function sectionName(s: RouteSection): string {
    const length = lonLat[s.line] ? spanLengthM(lonLat[s.line], s.from, s.to) : 0;
    return `Section of ${formatLength(length)} picked`;
  }

  if (!active) return editor;

  // What's drawn, with a drag in progress swapped in.
  const shown = preview
    ? mm.map((path, i) => (i === preview.edit.line ? [...path.slice(0, preview.edit.from), ...preview.edit.points, ...path.slice(preview.edit.to + 1)] : path))
    : mm;
  const held = grab.current;
  const d = shown.map((path) => polylineD(path)).join('');
  const sectionD = section && mm[section.line] ? polylineD(mm[section.line].slice(section.from, section.to + 1)) : '';
  const r = HANDLE_R * unit;
  const lastLine = mm.length - 1;

  editor.overlay = (
    <g className="route-edit" pointerEvents="none">
      {others.map((o) => (
        <path key={o.route.id} className="route-edit-other" d={o.lines.map((l) => polylineD(l)).join('')} />
      ))}
      {d ? (
        <>
          <path d={d} fill="none" stroke={routeColor} strokeOpacity={0.3} strokeWidth={bandWidth} strokeLinecap="round" strokeLinejoin="round" />
          <path className="route-edit-casing" d={d} />
          <path className="route-edit-line" d={d} />
        </>
      ) : null}
      {sectionD ? <path className="route-edit-section" d={sectionD} /> : null}
      {drawing ? <path className="route-edit-draw" d={polylineD(drawing)} /> : null}
      {draft && space && !route ? <circle className="route-handle route-handle-end" cx={fmt(space.toMm(draft)[0])} cy={fmt(space.toMm(draft)[1])} r={fmt(r * 1.2)} /> : null}
      {hovered?.kind === 'line' && !held ? (
        <g className="route-ghost">
          <circle cx={fmt(hovered.hit.point[0])} cy={fmt(hovered.hit.point[1])} r={fmt(r)} />
          <path d={`M${fmt(hovered.hit.point[0] - r * 0.55)} ${fmt(hovered.hit.point[1])}h${fmt(r * 1.1)}M${fmt(hovered.hit.point[0])} ${fmt(hovered.hit.point[1] - r * 0.55)}v${fmt(r * 1.1)}`} />
        </g>
      ) : null}
      {handles.map((list, line) =>
        list.map((index) => {
          if (held?.moved && held.kind === 'point' && held.line === line && held.index === index) return null;
          const [x, y] = mm[line][index];
          const isSelected = selected?.line === line && selected.index === index;
          const inSection = section?.line === line && (section.from === index || section.to === index);
          const isHover = hovered?.kind === 'point' && hovered.line === line && hovered.index === index;
          const start = line === 0 && index === 0;
          const finish = line === lastLine && index === mm[line].length - 1;
          const className = `route-handle${isSelected || inSection ? ' selected' : ''}${isHover ? ' hover' : ''}${start || finish ? ' route-handle-end' : ''}`;
          const size = start || finish ? r * 1.25 : r;
          return finish && !start ? (
            <rect key={`${line}-${index}`} className={className} x={fmt(x - size)} y={fmt(y - size)} width={fmt(size * 2)} height={fmt(size * 2)} />
          ) : (
            <circle key={`${line}-${index}`} className={className} cx={fmt(x)} cy={fmt(y)} r={fmt(size)} />
          );
        }),
      )}
      {preview?.edit.focus ? (
        <circle className={preview.snapped ? 'route-handle dragged snapped' : 'route-handle dragged'} cx={fmt(preview.edit.focus[0])} cy={fmt(preview.edit.focus[1])} r={fmt(r * 1.2)} />
      ) : null}
    </g>
  );

  const tap = COARSE ? 'Tap' : 'Click';
  if (held?.moved) editor.hint = preview?.snapped ? 'On a road. Hold Alt to put it anywhere.' : roads ? 'Not near a road, so it goes straight' : 'Let go to put it there';
  else if (tool === 'draw') editor.hint = route || draft ? `${tap} to carry the route on. Enter or Esc to stop.` : `${tap} the map where the route starts`;
  else if (sectionFrom) editor.hint = `${tap} the other end of the section`;
  else if (section) editor.hint = 'Snap it to the roads, straighten it or cut it out in the card';
  else if (selected) editor.hint = COARSE ? 'Drag to move it, or use the buttons in the card' : 'Drag to move it. Delete removes it. Shift-click another point to pick the section between.';
  else if (route) editor.hint = `Drag a point to move it, or drag the line to add one`;
  editor.cursor = held?.moved ? 'grabbing' : hovered?.kind === 'point' ? 'grab' : hovered?.kind === 'line' ? 'copy' : tool === 'draw' ? 'crosshair' : null;
  editor.label = route
    ? `Preview of the SVG map, editing ${route.name}. ${selected ? `${pointName(selected)} selected. ` : ''}Comma and period go to the previous and next point, Shift picks a section. Arrow keys move a point, S snaps it to a road, Delete removes it. F turns Follow roads on and off, D draws, Escape backs out.`
    : 'Preview of the SVG map, drawing a new route. Press D and click the map to start it, Escape to stop.';
  editor.card = (
    <RouteEditCard
      route={route}
      lonLat={lonLat}
      selected={selected}
      section={section}
      sectionFrom={sectionFrom}
      follow={follow}
      snapM={snapM}
      tool={tool}
      draft={draft !== null}
      hasRoads={graph !== null}
      pointName={selected ? pointName(selected) : ''}
      sectionName={section ? sectionName(section) : ''}
      announce={announce}
      onDelete={() => selected && remove(selected)}
      onSnapPoint={() => selected && snapPoint(selected)}
      onSnap={(part) => route && graph && space && snapToRoads(route, part, graph, space)}
      onBackToStart={() => route && space && backToStart(route, roads, space)}
    />
  );
  return editor;
}

function formatLength(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

function RouteEditCard(props: {
  route: RouteData | null;
  lonLat: [number, number][][];
  selected: RoutePoint | null;
  section: RouteSection | null;
  sectionFrom: RoutePoint | null;
  follow: boolean;
  snapM: number;
  tool: RouteTool;
  draft: boolean;
  hasRoads: boolean;
  pointName: string;
  sectionName: string;
  announce: string;
  onDelete: () => void;
  onSnapPoint: () => void;
  onSnap: (section: RouteSection | null) => void;
  onBackToStart: () => void;
}) {
  const { route, lonLat, selected, section, follow, tool, hasRoads } = props;
  const items = useApp((s) => s.routes.items);
  const [trim, setTrim] = useState(200);
  const length = useMemo(() => routeLengthM(lonLat), [lonLat]);
  const tap = COARSE ? 'Tap' : 'Click';
  return (
    <section className="preview-card route-card" aria-label="Edit route">
      <header className="preview-card-header">
        <h2>{route ? route.name : 'Draw a route'}</h2>
        <button type="button" className="icon-button" aria-label="Stop editing the route" title="Done" onClick={() => setRouteEditing(false)}>
          ×
        </button>
      </header>
      <p className="visually-hidden" aria-live="polite">
        {props.announce}
      </p>
      {items.length > 0 ? (
        <div className="preview-card-actions">
          <select
            className="select"
            aria-label="Route to edit"
            value={route?.id ?? ''}
            onChange={(e) => {
              setEditedRoute(e.target.value || null);
              if (!e.target.value) setRouteTool('draw');
            }}
          >
            {items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="">New route…</option>
          </select>
        </div>
      ) : null}
      <div className="preview-card-actions">
        <Segmented<RouteTool>
          label="Tool"
          value={tool}
          options={[
            { value: 'move', label: 'Move points', title: 'Drag points and the line (V)' },
            { value: 'draw', label: 'Draw', title: route ? 'Click the map to carry the route on (D)' : 'Click the map to draw a new route (D)' },
          ]}
          onChange={setRouteTool}
        />
      </div>
      <Check
        label="Follow roads"
        checked={follow && hasRoads}
        disabled={!hasRoads}
        title="Moved points snap to the nearest road or path, and the route goes along the roads between them (F)"
        onChange={setFollow}
      />
      {hasRoads ? (
        <Slider
          label="Snap distance"
          value={props.snapM}
          min={SNAP_LIMITS.min}
          max={SNAP_LIMITS.max}
          step={5}
          limits={{ min: SNAP_LIMITS.min, max: SNAP_LIMITS.max }}
          unit="m"
          hint="How far from a road a point can be and still snap to it. Raise it for a wobbly track, lower it where roads and paths run close together."
          onChange={setSnapDistance}
        />
      ) : null}
      {!hasRoads ? (
        <p className="preview-card-note">Following roads needs roads or paths in the preview. Turn Roads or Paths on under Layers, and wait for the preview to catch up.</p>
      ) : null}

      <div className="route-card-part">
        {tool === 'draw' ? (
          <p className="preview-card-text">
            {!route
              ? props.draft
                ? `${tap} again to draw the first stretch.`
                : `${tap} the map where the route starts, then ${tap.toLowerCase()} along it.${follow && hasRoads ? ' It goes along the roads between your clicks.' : ''}`
              : `${tap} the map to carry the route on from its finish${selected?.index === 0 ? '' : '. Select the first point to add to the start instead'}. Hold Alt to go straight.`}
          </p>
        ) : section ? (
          <>
            <p className="preview-card-text">{props.sectionName}</p>
            <div className="preview-card-actions">
              {hasRoads ? (
                <button type="button" className="btn btn-small" onClick={() => props.onSnap(section)} title="Move this section onto the roads it runs along">
                  Snap to roads
                </button>
              ) : null}
              <button type="button" className="btn btn-small" onClick={() => route && straightenSection(route, section)} title="A straight line from one end to the other">
                Straighten
              </button>
              <button type="button" className="btn btn-small" onClick={() => route && cutSection(route, section)} title="Take it out. In the middle this leaves a gap.">
                Cut out
              </button>
            </div>
          </>
        ) : selected ? (
          <>
            <p className="preview-card-text">{props.pointName}</p>
            <div className="preview-card-actions">
              {hasRoads ? (
                <button type="button" className="btn btn-small" onClick={props.onSnapPoint} title="Move it onto the nearest road or path (S)">
                  Snap to road
                </button>
              ) : null}
              <button type="button" className="btn btn-small" onClick={props.onDelete} title="Delete">
                Delete point
              </button>
            </div>
            {props.sectionFrom ? (
              <div className="preview-card-actions">
                <span className="route-card-wait">{tap} the other end of the section.</span>
                <button type="button" className="btn btn-small" onClick={() => startSection(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="preview-card-actions">
                <button type="button" className="btn btn-small" onClick={() => startSection(selected)} title="Then pick the other end, to snap, straighten or cut out what's between">
                  Pick a section
                </button>
                {COARSE ? null : <span className="preview-card-note route-card-inline">or Shift-click the other end</span>}
              </div>
            )}
          </>
        ) : route ? (
          <p className="preview-card-text">
            {COARSE
              ? 'Drag a point to move it, or drag the line to add one. Tap a point to select it.'
              : 'Drag a point to move it, or drag the line to add one. Click a point to select it, and double-click it to delete it.'}
          </p>
        ) : null}
      </div>

      {route ? (
        <div className="route-card-part">
          <span className="field-label">Whole route</span>
          <div className="preview-card-actions">
            {hasRoads ? (
              <button type="button" className="btn btn-small" onClick={() => props.onSnap(null)} title="Move the whole route onto the roads it runs along. Stretches away from roads stay as they are.">
                Snap to roads
              </button>
            ) : null}
            <button type="button" className="btn btn-small" onClick={() => reverseRoute(route)} title="Swap the start and the finish">
              Reverse
            </button>
            <button type="button" className="btn btn-small" onClick={props.onBackToStart} title="Join the finish back to the start">
              Back to start
            </button>
          </div>
          <div className="preview-card-actions route-trim">
            <NumberInput value={trim} min={10} max={5000} step={10} unit="m" label="Distance to trim" onChange={setTrim} />
            <button type="button" className="btn btn-small" onClick={() => trimRouteEnd(route, trim, 'start')} title="Hide where the route starts, like your front door">
              Trim start
            </button>
            <button type="button" className="btn btn-small" onClick={() => trimRouteEnd(route, trim, 'end')}>
              Trim finish
            </button>
          </div>
          <p className="preview-card-note">
            {formatLength(length)}
            {isChanged(route) ? (
              <>
                {' '}
                <button type="button" className="link-button" onClick={() => revertRoute(route)}>
                  Undo all changes
                </button>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      <p className="preview-card-note">
        {COARSE
          ? 'Undo is at the top of Settings.'
          : `Comma and period step through the points, with Shift to pick a section. Arrow keys move a point, S snaps it to a road, Delete removes it. F turns Follow roads on and off. ${MOD}+Z undoes.`}
      </p>
    </section>
  );
}
