// Editing imported and drawn routes in the preview: moving points, snapping
// the route to the roads, cutting bits out, trimming the ends and drawing new
// routes. Not the same as Pick roads, which colours roads already on the map.
//
// Edits are worked out in mm on the piece, then stored as lon/lat like an
// import, so each one is a single undo step and the render picks it up.
import { create } from 'zustand';
import { lonLatToWorld, worldSize, worldToLonLat } from '../engine/geo/mercator.ts';
import type { MapTransform } from '../engine/geo/transform.ts';
import type { Point } from '../engine/lines/geometry.ts';
import { cutSpan, replaceSpan, reverseLines, trimRoute, warpSpan } from '../engine/routes/edit.ts';
import type { PickLines } from '../engine/routes/picks.ts';
import type { LonLat } from '../engine/routes/polyline.ts';
import { type RoadGraph, buildRoadGraph, matchToRoads, nearestRoad, routeBetween } from '../engine/routes/roadGraph.ts';
import { decodeRoute, encodeRoute, routeLengthM } from '../engine/routes/route.ts';
import type { RouteData } from '../engine/settings.ts';
import { flash } from './flash.ts';
import { markTransform, pieceLayout } from './marks.ts';
import { MAX_ROUTES } from './routes.ts';
import { type AppState, useApp } from './store.ts';
import { asChange } from './undo.ts';

export type RouteTool = 'move' | 'draw';

/** A point of a route, by line and index into that line. */
export interface RoutePoint {
  line: number;
  index: number;
}

/** The stretch of one line from point `from` to point `to`, from < to. */
export interface RouteSection {
  line: number;
  from: number;
  to: number;
}

interface RouteEditUi {
  editing: boolean;
  routeId: string | null;
  selected: RoutePoint | null;
  section: RouteSection | null;
  // One end of a section being picked without Shift, waiting for the other.
  sectionFrom: RoutePoint | null;
  follow: boolean;
  // How far from a road a point snaps to it, in metres.
  snapM: number;
  tool: RouteTool;
  // The first click of a new route, which has no line until the second.
  draft: LonLat | null;
  // Counts each time the editor is opened, so the settings drawer can get out of the way.
  opened: number;
}

const FOLLOW_KEY = 'svgmap-follow-roads';
const SNAP_KEY = 'svgmap-snap-distance';
export const SNAP_LIMITS = { min: 5, max: 100, default: 30 };

function storedSnap(): number {
  try {
    const value = Number(localStorage.getItem(SNAP_KEY));
    return value >= SNAP_LIMITS.min && value <= SNAP_LIMITS.max ? value : SNAP_LIMITS.default;
  } catch {
    return SNAP_LIMITS.default;
  }
}

function storedFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const useRouteEdit = create<RouteEditUi>(() => ({
  editing: false,
  routeId: null,
  selected: null,
  section: null,
  sectionFrom: null,
  follow: storedFollow(),
  snapM: storedSnap(),
  tool: 'move',
  draft: null,
  opened: 0,
}));

/** Turns the editor on or off, on a route if one is given. */
export function setRouteEditing(editing: boolean, routeId?: string): void {
  if (!editing) {
    useRouteEdit.setState({ editing: false, selected: null, section: null, sectionFrom: null, tool: 'move', draft: null });
    return;
  }
  const items = useApp.getState().routes.items;
  const current = useRouteEdit.getState().routeId;
  const id = routeId ?? (items.some((r) => r.id === current) ? current : (items.find((r) => r.visible) ?? items[0])?.id ?? null);
  useRouteEdit.setState((s) => ({ editing: true, routeId: id, selected: null, section: null, sectionFrom: null, draft: null, tool: id ? 'move' : 'draw', opened: s.opened + 1 }));
}

/** The editor on with the draw tool, for a new route. */
export function startDrawing(): void {
  useRouteEdit.setState((s) => ({ editing: true, routeId: null, selected: null, section: null, sectionFrom: null, draft: null, tool: 'draw', opened: s.opened + 1 }));
}

export function setEditedRoute(routeId: string | null): void {
  useRouteEdit.setState({ routeId, selected: null, section: null, sectionFrom: null, draft: null });
}

export function setSnapDistance(metres: number): void {
  const snapM = Math.min(SNAP_LIMITS.max, Math.max(SNAP_LIMITS.min, Math.round(metres)));
  useRouteEdit.setState({ snapM });
  try {
    localStorage.setItem(SNAP_KEY, String(snapM));
  } catch {
    // Only a preference.
  }
}

export function setFollow(follow: boolean): void {
  useRouteEdit.setState({ follow });
  try {
    localStorage.setItem(FOLLOW_KEY, follow ? 'on' : 'off');
  } catch {
    // Only a preference.
  }
}

export function setRouteTool(tool: RouteTool): void {
  useRouteEdit.setState({ tool, draft: null, sectionFrom: null });
}

export function selectRoutePoint(point: RoutePoint | null): void {
  useRouteEdit.setState({ selected: point, section: null, sectionFrom: null });
}

export function selectSection(section: RouteSection | null): void {
  useRouteEdit.setState({ section, selected: null, sectionFrom: null });
}

/** Waits for the other end of a section, for picking one without Shift. */
export function startSection(from: RoutePoint | null): void {
  useRouteEdit.setState({ sectionFrom: from });
}

// ------------------------------------------------------------ space

/** Converts between lon/lat and mm on the piece as it's set up now. */
export interface EditSpace {
  transform: MapTransform;
  metresPerMm: number;
  toMm(p: LonLat): Point;
  toLonLat(p: Point): LonLat;
}

export function editSpace(s: Pick<AppState, 'area' | 'product' | 'border'> = useApp.getState()): EditSpace | null {
  const layout = pieceLayout(s);
  if (!layout) return null;
  const transform = markTransform(s.area, layout);
  const world = worldSize(transform.zoom);
  return {
    transform,
    metresPerMm: transform.metresPerMm,
    toMm: ([lon, lat]) => {
      const [x, y] = lonLatToWorld(lon, lat, transform.zoom);
      // The copy of the world nearest the map, like the render.
      return transform.toCanvas(x + world * Math.round((transform.cx - x) / world), y);
    },
    toLonLat: ([x, y]) => {
      const { lon, lat } = worldToLonLat(...transform.toWorld(x, y), transform.zoom);
      return [((((lon + 180) % 360) + 360) % 360) - 180, lat];
    },
  };
}

export const mmFor = (space: EditSpace, metres: number) => metres / space.metresPerMm;

// One graph at a time. A new render of the same map has new pick arrays with
// the same roads in them, so it's keyed on what's in them.
let cachedGraph: { key: string; graph: RoadGraph } | null = null;

function pickKey(pick: PickLines, t: MapTransform): string {
  let sum = 0;
  const step = Math.max(1, Math.floor(pick.points.length / 997));
  for (let i = 0; i < pick.points.length; i += step) sum += pick.points[i] * ((i % 13) + 1);
  const p = pick.transform;
  return [pick.starts.length, pick.points.length, sum, p.zoom, p.cx, p.cy, p.mmPerUnit, p.cos, t.zoom, t.cx, t.cy, t.mmPerUnit, t.cos, t.wx, t.wy].join(',');
}

/** The render's roads and paths as a graph in the space's mm, or null without a render. */
export function roadGraphFor(pick: PickLines | undefined, space: EditSpace | null): RoadGraph | null {
  if (!pick || !space) return null;
  const key = pickKey(pick, space.transform);
  if (cachedGraph?.key === key) return cachedGraph.graph;
  const t = space.transform;
  const k = 2 ** (t.zoom - pick.transform.zoom);
  const graph = buildRoadGraph(pick, (x, y) => t.toCanvas(x * k, y * k), space.metresPerMm);
  cachedGraph = { key, graph };
  return graph;
}

/** Along the roads from a to b, or straight when either is off the roads or they don't connect. */
export function connect(a: Point, b: Point, graph: RoadGraph | null, space: EditSpace): Point[] {
  if (!graph) return [a, b];
  // The handles either side are joined along a road if they are within snapping distance of one.
  const reach = mmFor(space, useRouteEdit.getState().snapM);
  const from = nearestRoad(graph, a, reach);
  const to = nearestRoad(graph, b, reach);
  if (!from || !to) return [a, b];
  const straight = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // A detour much longer than the gap is a wrong turn more often than not, like
  // a point nudged onto the next street over. Straight is the better guess then.
  const way = routeBetween(graph, from, to, straight * 3 + mmFor(space, 80));
  if (!way) return [a, b];
  const out = [a, ...way, b];
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-6);
}

// The snap distance is how far matching looks for roads, and the GPS error it
// expects grows with it, so a higher setting also cares less which road is nearest.
export function matchOptions(space: EditSpace) {
  const snapM = useRouteEdit.getState().snapM;
  return { spacing: mmFor(space, 20), reach: mmFor(space, snapM), sigma: mmFor(space, Math.max(3, snapM / 3)), spur: mmFor(space, 40) };
}

// ------------------------------------------------------------ edits

/** New points for one line from `from` to `to`, both included, in mm. */
export interface SpanEdit {
  line: number;
  from: number;
  to: number;
  points: Point[];
  /** Where the selection goes afterwards. */
  focus: Point | null;
}

/**
 * How the stretches either side of a moved point are redrawn: along the roads,
 * straight, or with the old points bent along (null).
 */
export type Rejoin = RoadGraph | 'straight' | null;

/**
 * The point at `index` moved to `to`, with the handles before and after it
 * staying put and the stretches between joined up as `how` says.
 */
export function moveEdit(path: readonly Point[], line: number, before: number, index: number, after: number, to: Point, how: Rejoin, space: EditSpace): SpanEdit {
  if (!how) return { line, from: before, to: after, points: warpSpan(path, before, index, after, to), focus: to };
  const graph = how === 'straight' ? null : how;
  const left = before === index ? [to] : connect(path[before], to, graph, space);
  const right = after === index ? [] : connect(to, path[after], graph, space).slice(1);
  return { line, from: before, to: after, points: [...left, ...right], focus: to };
}

/** A new point put on the line at segment + t, then moved to `to`. */
export function insertEdit(path: readonly Point[], line: number, segment: number, t: number, before: number, after: number, to: Point, how: Rejoin, space: EditSpace): SpanEdit {
  const a = path[segment];
  const b = path[segment + 1];
  const on: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const longer = [...path.slice(0, segment + 1), on, ...path.slice(segment + 1)];
  const edit = moveEdit(longer, line, before, segment + 1, after + 1, to, how, space);
  // In terms of the line as it was, before the new point went in.
  return { ...edit, to: after };
}

/** The point at `index` taken out, with the handles either side joined up. */
export function removeEdit(path: readonly Point[], line: number, before: number, index: number, after: number, graph: RoadGraph | null, space: EditSpace): SpanEdit {
  if (before === index) return { line, from: index, to: after, points: [path[after]], focus: path[after] };
  if (after === index) return { line, from: before, to: index, points: [path[before]], focus: path[before] };
  return { line, from: before, to: after, points: connect(path[before], path[after], graph, space), focus: path[after] };
}

export function routeById(id: string | null): RouteData | null {
  return useApp.getState().routes.items.find((r) => r.id === id) ?? null;
}

// The route as first seen by the editor in this session, for putting it back.
const originals = new Map<string, string[]>();

export function originalOf(id: string): string[] | undefined {
  return originals.get(id);
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

export function isChanged(route: RouteData): boolean {
  const original = originals.get(route.id);
  return Boolean(original && !sameLines(original, route.lines));
}

/** The point of a route nearest a lon/lat, for keeping the selection after an edit. */
function pointNear(lines: readonly LonLat[][], target: LonLat): RoutePoint | null {
  let best: RoutePoint | null = null;
  let bestD = Infinity;
  const k = Math.cos((target[1] * Math.PI) / 180);
  lines.forEach((points, line) => {
    points.forEach(([lon, lat], index) => {
      const d = ((lon - target[0]) * k) ** 2 + (lat - target[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { line, index };
      }
    });
  });
  return best;
}

/**
 * Stores new lines for a route as one undo step, and keeps hold of whatever
 * was selected. A route left with nothing is removed. Without a label, steps
 * like arrow key nudges in a row undo together.
 */
export function commitLines(route: RouteData, lines: LonLat[][], label: string | null, focus: LonLat | null, done?: string): void {
  if (!originals.has(route.id)) originals.set(route.id, route.lines);
  const kept = lines.filter((l) => l.length >= 2);
  if (!kept.length) {
    asChange(label ?? 'Remove route', () => useApp.getState().removeRoute(route.id));
    useRouteEdit.setState({ routeId: null, selected: null, section: null, tool: 'draw' });
    flash(`Removed ${route.name}, nothing was left of it. Undo brings it back.`, 4000);
    return;
  }
  const encoded = encodeRoute(kept);
  const store = () => useApp.getState().updateRoute(route.id, { lines: encoded });
  if (label) asChange(label, store);
  else store();
  const stored = decodeRoute({ lines: encoded });
  useRouteEdit.setState({ selected: focus ? pointNear(stored, focus) : null, section: null });
  if (done) flash(done);
}

/** Applies a span worked out in mm. */
export function applySpan(route: RouteData, edit: SpanEdit, label: string | null, space: EditSpace, done?: string): void {
  const lines = decodeRoute(route);
  if (!lines[edit.line]) return;
  const next = replaceSpan(lines, edit.line, edit.from, edit.to, edit.points.map(space.toLonLat));
  commitLines(route, next, label, edit.focus ? space.toLonLat(edit.focus) : null, done);
}

const km = (metres: number) => (metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`);

/** Matches a section, or the whole route, to the roads. */
export function snapToRoads(route: RouteData, section: RouteSection | null, graph: RoadGraph, space: EditSpace): void {
  const lines = decodeRoute(route);
  const options = matchOptions(space);
  let next: LonLat[][];
  if (section) {
    const path = lines[section.line].slice(section.from, section.to + 1).map(space.toMm);
    const matched = matchToRoads(graph, path, options).map(space.toLonLat);
    next = replaceSpan(lines, section.line, section.from, section.to, matched);
  } else {
    next = lines.map((line) => matchToRoads(graph, line.map(space.toMm), options).map(space.toLonLat));
  }
  const before = routeLengthM(lines);
  const after = routeLengthM(next);
  if (sameLines(encodeRoute(next), route.lines)) {
    flash('Already on the roads. Nothing changed.');
    return;
  }
  commitLines(route, next, section ? 'Snap route section to roads' : 'Snap route to roads', null, `Snapped to the roads, ${km(before)} is now ${km(after)}`);
}

export function straightenSection(route: RouteData, section: RouteSection): void {
  const lines = decodeRoute(route);
  const points = lines[section.line];
  if (!points) return;
  const next = replaceSpan(lines, section.line, section.from, section.to, [points[section.from], points[section.to]]);
  commitLines(route, next, 'Straighten route section', points[section.to], 'Straightened the section');
}

export function cutSection(route: RouteData, section: RouteSection): void {
  const lines = decodeRoute(route);
  const points = lines[section.line];
  if (!points) return;
  const atEnd = section.from === 0 || section.to === points.length - 1;
  commitLines(route, cutSpan(lines, section.line, section.from, section.to), 'Cut out route section', null, atEnd ? 'Trimmed the route' : 'Cut the section out, leaving a gap');
}

export function trimRouteEnd(route: RouteData, metres: number, end: 'start' | 'end'): void {
  const lines = decodeRoute(route);
  const total = routeLengthM(lines);
  if (metres >= total) {
    flash(`The route is only ${km(total)} long.`);
    return;
  }
  commitLines(route, trimRoute(lines, metres, end), end === 'start' ? 'Trim route start' : 'Trim route finish', null, `Took ${km(metres)} off the ${end === 'start' ? 'start' : 'finish'}`);
}

export function reverseRoute(route: RouteData): void {
  commitLines(route, reverseLines(decodeRoute(route)), 'Reverse route', null, 'Reversed. The start and finish swapped.');
}

/** Joins the finish back to the start, along the roads when following them. */
export function backToStart(route: RouteData, graph: RoadGraph | null, space: EditSpace): void {
  const lines = decodeRoute(route);
  if (!lines.length) return;
  const last = lines[lines.length - 1];
  const start = space.toMm(lines[0][0]);
  const end = space.toMm(last[last.length - 1]);
  if (Math.hypot(start[0] - end[0], start[1] - end[1]) < 0.05) {
    flash('It already finishes where it starts.');
    return;
  }
  const way = connect(end, start, graph, space).map(space.toLonLat);
  const next = replaceSpan(lines, lines.length - 1, last.length - 1, last.length - 1, way);
  commitLines(route, next, 'Route back to start', null, 'Joined the finish back to the start');
}

/** Puts the route back the way it was when the editor first saw it. */
export function revertRoute(route: RouteData): void {
  const original = originals.get(route.id);
  if (!original) return;
  asChange('Undo route edits', () => useApp.getState().updateRoute(route.id, { lines: original }));
  useRouteEdit.setState({ selected: null, section: null });
  flash('Put the route back the way it was');
}

function drawnName(): string {
  const names = new Set(useApp.getState().routes.items.map((r) => r.name));
  if (!names.has('Drawn route')) return 'Drawn route';
  let n = 2;
  while (names.has(`Drawn route ${n}`)) n++;
  return `Drawn route ${n}`;
}

/**
 * A click with the draw tool. It carries the route on from its finish, or
 * from its start when the first point is selected. Without a route the
 * first click starts one and the second makes its first stretch.
 */
export function drawTo(to: Point, graph: RoadGraph | null, space: EditSpace): void {
  const ui = useRouteEdit.getState();
  const route = routeById(ui.routeId);
  if (!route) {
    if (!ui.draft) {
      useRouteEdit.setState({ draft: space.toLonLat(to) });
      flash('Started a route. Click again to carry it on.');
      return;
    }
    if (useApp.getState().routes.items.length >= MAX_ROUTES) {
      flash(`There can be up to ${MAX_ROUTES} routes. Remove some first.`, 4000);
      return;
    }
    const points = connect(space.toMm(ui.draft), to, graph, space).map(space.toLonLat);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = drawnName();
    const lines = encodeRoute([points]);
    asChange('Draw route', () => useApp.getState().addRoutes([{ id, name, visible: true, lines }]));
    originals.set(id, lines);
    useRouteEdit.setState({ routeId: id, draft: null, selected: pointNear(decodeRoute({ lines }), points[points.length - 1]), section: null });
    flash(`Added ${name}`);
    return;
  }
  const lines = decodeRoute(route);
  const atStart = ui.selected?.index === 0 && lines[ui.selected.line] !== undefined;
  const line = atStart ? ui.selected!.line : (ui.selected && lines[ui.selected.line] && ui.selected.index === lines[ui.selected.line].length - 1 ? ui.selected.line : lines.length - 1);
  const points = lines[line];
  if (!points) return;
  if (atStart) {
    const way = connect(to, space.toMm(points[0]), graph, space).map(space.toLonLat);
    commitLines(route, replaceSpan(lines, line, 0, 0, way), 'Draw route', way[0]);
  } else {
    const end = points.length - 1;
    const way = connect(space.toMm(points[end]), to, graph, space).map(space.toLonLat);
    commitLines(route, replaceSpan(lines, line, end, end, way), 'Draw route', way[way.length - 1]);
  }
}
