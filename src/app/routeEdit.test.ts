import { beforeEach, describe, expect, it } from 'vitest';
import { makeTransform } from '../engine/geo/transform.ts';
import type { Point } from '../engine/lines/geometry.ts';
import { PICK_LAYERS, type PickLines } from '../engine/routes/picks.ts';
import type { LonLat } from '../engine/routes/polyline.ts';
import { nearestRoad, routeBetween } from '../engine/routes/roadGraph.ts';
import { decodeRoute, encodeRoute, routeLengthM } from '../engine/routes/route.ts';
import type { RouteData } from '../engine/settings.ts';
import { applySpan, backToStart, commitLines, cutSection, drawTo, editSpace, insertEdit, moveEdit, reverseRoute, revertRoute, roadGraphFor, selectRoutePoint, setRouteEditing, startDrawing, straightenSection, trimRouteEnd, useRouteEdit } from './routeEdit.ts';
import { defaultSettings } from './settings.ts';
import { useApp } from './store.ts';
import { quietly, redoChange, startUndo, undoChange, useUndo } from './undo.ts';

let nextId = 0;
const current = () => useApp.getState().routes.items[0];
function seed(): RouteData {
  const route = { id: `qa-${nextId++}`, name: 'Run', visible: true, lines: encodeRoute([[[0, 0], [0.002, 0.001], [0.004, 0], [0.006, 0.001], [0.008, 0]]]) };
  quietly(() => useApp.getState().addRoutes([route]));
  setRouteEditing(true, route.id);
  return route;
}
beforeEach(() => {
  startUndo();
  quietly(() => useApp.getState().set(defaultSettings()));
  useUndo.setState({ past: [], future: [] });
  startDrawing();
});

describe('route editing', () => {
  it('moves and inserts points with one undo step each', () => {
    const route = seed(); const space = editSpace()!;
    const mm = decodeRoute(route)[0].map(space.toMm);
    const to: Point = [mm[2][0], mm[2][1] - 2];
    applySpan(route, moveEdit(mm, 0, 1, 2, 3, to, null, space), 'Move route point', space);
    expect(useUndo.getState().past).toHaveLength(1);
    expect(current().lines).not.toEqual(route.lines);
    const moved = current().lines;
    expect(undoChange()).toBe(true); expect(current().lines).toEqual(route.lines);
    expect(redoChange()).toBe(true); expect(current().lines).toEqual(moved);
    const path = decodeRoute(current())[0].map(space.toMm);
    applySpan(current(), insertEdit(path, 0, 1, 0.5, 1, 2, [to[0] + 2, to[1]], null, space), 'Add route point', space);
    expect(decodeRoute(current())[0]).toHaveLength(6);
    expect(useUndo.getState().past).toHaveLength(2);
  });

  it('cuts a section into separate lines and restores it with undo', () => {
    const route = seed(); cutSection(route, { line: 0, from: 1, to: 3 });
    expect(decodeRoute(current()).map(l => l.length)).toEqual([2, 2]);
    expect(undoChange()).toBe(true); expect(current().lines).toEqual(route.lines);
  });

  it('straightens a section, reverses and closes the route', () => {
    const route = seed(); straightenSection(route, { line: 0, from: 0, to: 4 });
    expect(decodeRoute(current())[0]).toHaveLength(2);
    const line = decodeRoute(current())[0]; reverseRoute(current());
    expect(decodeRoute(current())[0]).toEqual([...line].reverse());
    backToStart(current(), null, editSpace()!);
    const closed = decodeRoute(current())[0]; expect(closed[0]).toEqual(closed.at(-1));
    revertRoute(current()); expect(current().lines).toEqual(route.lines);
    undoChange(); expect(current().lines).not.toEqual(route.lines);
  });

  it('trims the requested distance and rejects a trim longer than the route', () => {
    seed(); const length = routeLengthM(decodeRoute(current()));
    trimRouteEnd(current(), 200, 'start');
    expect(routeLengthM(decodeRoute(current()))).toBeCloseTo(length - 200, 0);
    const trimmed = current(); trimRouteEnd(trimmed, length, 'end');
    expect(current().lines).toEqual(trimmed.lines);
  });

  it('removes a fully cut route and undo restores its geometry', () => {
    const route = seed(); cutSection(route, { line: 0, from: 0, to: 4 });
    expect(useApp.getState().routes.items).toHaveLength(0);
    undoChange(); expect(current().lines).toEqual(route.lines);
  });

  it('draws a new route and extends its selected start', () => {
    const space = editSpace()!; const { wx, wy } = space.transform;
    drawTo([wx, wy], null, space); expect(useApp.getState().routes.items).toHaveLength(0);
    drawTo([wx + 10, wy], null, space); expect(decodeRoute(current())[0]).toHaveLength(2);
    selectRoutePoint({ line: 0, index: 0 });
    drawTo([wx, wy + 10], null, space);
    expect(decodeRoute(current())[0]).toHaveLength(3);
    expect(useRouteEdit.getState().selected).toEqual({ line: 0, index: 0 });
  });

  it('does not add an empty route when the second click repeats the first', () => {
    const space = editSpace()!; const at: Point = [space.transform.wx, space.transform.wy];
    drawTo(at, null, space); drawTo(at, null, space);
    expect(useApp.getState().routes.items).toHaveLength(0);
    expect(useRouteEdit.getState().draft).not.toBeNull();
    expect(useUndo.getState().past).toHaveLength(0);
  });

  it('removes lines collapsed onto a single location by an edit', () => {
    const route = seed(); const p: LonLat = [0, 0];
    commitLines(route, [[p, p]], 'Move route point', p);
    expect(useApp.getState().routes.items).toHaveLength(0);
    undoChange(); expect(current().lines).toEqual(route.lines);
  });
});

function graphPick(): PickLines {
  return {
    points: new Float32Array([0, 0, 100, 0, 50, -50, 50, 50]), starts: new Uint32Array([0, 2, 4]),
    layers: new Uint8Array([0, 0]), owners: new Int8Array([-2, -2]), classes: ['minor', 'minor'], levels: new Uint8Array([0, 0]),
    transform: { zoom: 14, cx: 0, cy: 0, wx: 0, wy: 0, cos: 1, sin: 0, mmPerUnit: 1 },
  };
}
function graphSpace(bearing = 0) {
  const transform = makeTransform({ lon: -180, lat: 85.05112878, widthM: 100, bearing }, 14, [0, 0], 100);
  return { transform: { ...transform, cx: 0, cy: 0, mmPerUnit: 1, metresPerMm: 1, toCanvas: (x: number, y: number): Point => [x * transform.cos + y * transform.sin, y * transform.cos - x * transform.sin] }, metresPerMm: 1, toMm: (p: LonLat): Point => p, toLonLat: (p: Point): LonLat => p };
}
describe('road graph cache', () => {
  it('updates geometry even when the old weighted checksum would be unchanged', () => {
    const pick = graphPick(); const first = roadGraphFor(pick, graphSpace());
    const points = pick.points.slice(); points[0] += 5; points[1] -= 2.5;
    expect(roadGraphFor({ ...pick, points }, graphSpace())).not.toBe(first);
  });

  it('updates when identical points are divided into different lines', () => {
    const pick = graphPick(); roadGraphFor(pick, graphSpace());
    const graph = roadGraphFor({ ...pick, starts: new Uint32Array([0, 3, 4]) }, graphSpace())!;
    expect(nearestRoad(graph, [50, 50], 1)).toBeNull();
  });

  it('updates when the rendered pick origin changes', () => {
    const pick = graphPick(); const first = roadGraphFor(pick, graphSpace());
    expect(roadGraphFor({ ...pick, transform: { ...pick.transform, wx: 10 } }, graphSpace())).not.toBe(first);
  });
  it('updates when the bearing switches between opposite angles', () => {
    const pick = graphPick(); const first = roadGraphFor(pick, graphSpace(45))!;
    const second = roadGraphFor(pick, graphSpace(-45))!;
    expect(second).not.toBe(first);
    expect(nearestRoad(second, [Math.SQRT1_2 * 100, Math.SQRT1_2 * 100], 0.01)).not.toBeNull();
  });
  it('updates when roads become railways', () => {
    const pick = graphPick(); const first = roadGraphFor(pick, graphSpace()); expect(first).not.toBeNull();
    expect(roadGraphFor({ ...pick, layers: new Uint8Array([PICK_LAYERS.indexOf('railways'), PICK_LAYERS.indexOf('railways')]) }, graphSpace())).toBeNull();
  });
  it('updates bridge levels before routing at crossings', () => {
    const pick = graphPick(); roadGraphFor(pick, graphSpace());
    const graph = roadGraphFor({ ...pick, levels: new Uint8Array([0, 1]) }, graphSpace())!;
    expect(routeBetween(graph, nearestRoad(graph, [0, 0], 1)!, nearestRoad(graph, [50, 50], 1)!)).toBeNull();
  });
  it('reuses identical road geometry from a later render', () => {
    const pick = graphPick(); const first = roadGraphFor(pick, graphSpace());
    expect(roadGraphFor(graphPick(), graphSpace())).toBe(first);
  });
});
