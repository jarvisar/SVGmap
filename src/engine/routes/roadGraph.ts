// Roads and paths from a render as a graph, for snapping a route onto them and
// routing along them in the preview's route editor.
//
// The tiles carry no junctions. Ways with the same tags are merged into long
// lines, and a junction on a straight street is often simplified away, so
// junctions are found again where lines share a point, cross, or end against
// another line. Bridges and tunnels only join at shared points, so a route
// can't drop off a bridge onto the road under it.

import { type Point, cellKey } from '../lines/geometry.ts';
import { PICK_LAYERS, type PickLines, pickToWorld } from './picks.ts';

// Railways and raceways aren't something a route follows.
const FOLLOW_LAYERS = new Set([PICK_LAYERS.indexOf('roads'), PICK_LAYERS.indexOf('paths')]);

// In metres, turned into mm for the scale.
const MERGE_M = 0.5;
const DANGLE_M = 4;
const CELL_M = 25;

export interface RoadGraph {
  readonly nodes: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Per node, where its edges start in `to` and `cost`, with the total at the end. */
  readonly first: Uint32Array;
  readonly to: Uint32Array;
  readonly cost: Float64Array;
  /** Both ends of every edge, for finding the nearest road. */
  readonly edgeA: Uint32Array;
  readonly edgeB: Uint32Array;
  readonly cells: Map<number, number[]>;
  readonly cell: number;
}

/** A spot on the network: an edge and how far along it from edgeA. */
export interface RoadSpot {
  edge: number;
  t: number;
  point: Point;
  distance: number;
}

/**
 * Builds the graph from a render's pick lines. toMm takes world units at the
 * pick's zoom to mm in the space the editor works in, and metresPerMm sets the
 * tolerances.
 */
export function buildRoadGraph(pick: PickLines, toMm: (x: number, y: number) => Point, metresPerMm: number): RoadGraph {
  const mm = (metres: number) => metres / metresPerMm;
  const quantum = mm(MERGE_M);
  const dangle = mm(DANGLE_M);
  const cell = Math.max(mm(CELL_M), dangle * 2);

  const xs: number[] = [];
  const ys: number[] = [];
  const nodeAt = new Map<number, number>();
  // Points this close are one node. The neighbouring cells are checked too, so
  // two points either side of a rounding edge still meet.
  const node = (x: number, y: number): number => {
    const ix = Math.round(x / quantum);
    const iy = Math.round(y / quantum);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const n = nodeAt.get(cellKey(ix + dx, iy + dy));
        if (n !== undefined && Math.hypot(xs[n] - x, ys[n] - y) <= quantum) return n;
      }
    }
    const id = xs.length;
    xs.push(x);
    ys.push(y);
    nodeAt.set(cellKey(ix, iy), id);
    return id;
  };

  // Segments of the pick lines between nodes.
  const segA: number[] = [];
  const segB: number[] = [];
  const segLine: number[] = [];
  const segLevel: number[] = [];
  const { starts, points, layers, transform } = pick;
  const levels = pick.levels ?? new Uint8Array(layers.length);
  for (let line = 0; line < starts.length - 1; line++) {
    if (!FOLLOW_LAYERS.has(layers[line])) continue;
    let previous = -1;
    for (let p = starts[line]; p < starts[line + 1]; p++) {
      const [x, y] = toMm(...pickToWorld(transform, points[p * 2], points[p * 2 + 1]));
      const n = node(x, y);
      if (previous >= 0 && n !== previous) {
        segA.push(previous);
        segB.push(n);
        segLine.push(line);
        segLevel.push(levels[line]);
      }
      previous = n;
    }
  }

  const segCells = new Map<number, number[]>();
  const addToCells = (cells: Map<number, number[]>, id: number, ax: number, ay: number, bx: number, by: number) => {
    const x0 = Math.floor(Math.min(ax, bx) / cell);
    const x1 = Math.floor(Math.max(ax, bx) / cell);
    const y0 = Math.floor(Math.min(ay, by) / cell);
    const y1 = Math.floor(Math.max(ay, by) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cellKey(cx, cy);
        const list = cells.get(key);
        if (list) list.push(id);
        else cells.set(key, [id]);
      }
    }
  };
  for (let s = 0; s < segA.length; s++) addToCells(segCells, s, xs[segA[s]], ys[segA[s]], xs[segB[s]], ys[segB[s]]);

  // Extra nodes along segments, as [t, node] pairs.
  const splits = new Map<number, [number, number][]>();
  const split = (s: number, t: number, n: number) => {
    if (n === segA[s] || n === segB[s]) return;
    const list = splits.get(s);
    if (list) list.push([t, n]);
    else splits.set(s, [[t, n]]);
  };
  const extraA: number[] = [];
  const extraB: number[] = [];

  // Crossings at ground level, including a line ending exactly on another.
  const EPS = 1e-9;
  const seen = new Set<number>();
  const segCount = segA.length;
  for (const list of segCells.values()) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (segLevel[s]) continue;
      for (let j = i + 1; j < list.length; j++) {
        const u = list[j];
        if (segLevel[u]) continue;
        const a = segA[s];
        const b = segB[s];
        const c = segA[u];
        const d = segB[u];
        if (a === c || a === d || b === c || b === d) continue;
        const key = s < u ? s * segCount + u : u * segCount + s;
        if (seen.has(key)) continue;
        seen.add(key);
        const rx = xs[b] - xs[a];
        const ry = ys[b] - ys[a];
        const qx = xs[d] - xs[c];
        const qy = ys[d] - ys[c];
        const denom = rx * qy - ry * qx;
        if (Math.abs(denom) < EPS) continue;
        const wx = xs[c] - xs[a];
        const wy = ys[c] - ys[a];
        const t = (wx * qy - wy * qx) / denom;
        const v = (wx * ry - wy * rx) / denom;
        if (t < -EPS || t > 1 + EPS || v < -EPS || v > 1 + EPS) continue;
        const n = node(xs[a] + rx * t, ys[a] + ry * t);
        split(s, t, n);
        split(u, v, n);
      }
    }
  }

  // Ends that stop just short of another line, like a side street cut at a
  // tile edge, are joined to it.
  const degree = new Uint32Array(xs.length);
  for (let s = 0; s < segA.length; s++) {
    degree[segA[s]]++;
    degree[segB[s]]++;
  }
  const endLevel = new Map<number, number>();
  for (let s = 0; s < segA.length; s++) {
    for (const n of [segA[s], segB[s]]) if (degree[n] === 1) endLevel.set(n, segLevel[s]);
  }
  for (const [n, level] of endLevel) {
    const x = xs[n];
    const y = ys[n];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let best = -1;
    let bestT = 0;
    let bestDistance = dangle;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of segCells.get(cellKey(cx + dx, cy + dy)) ?? []) {
          if (segA[s] === n || segB[s] === n || segLevel[s] !== level) continue;
          const [t, distance] = project(x, y, xs[segA[s]], ys[segA[s]], xs[segB[s]], ys[segB[s]]);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = s;
            bestT = t;
          }
        }
      }
    }
    if (best < 0) continue;
    const a = segA[best];
    const b = segB[best];
    const target = bestT <= 0 ? a : bestT >= 1 ? b : node(xs[a] + (xs[b] - xs[a]) * bestT, ys[a] + (ys[b] - ys[a]) * bestT);
    split(best, bestT, target);
    if (target !== n) {
      extraA.push(n);
      extraB.push(target);
    }
  }

  // Segments cut at their splits become the edges.
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    edgeA.push(a);
    edgeB.push(b);
  };
  for (let s = 0; s < segA.length; s++) {
    const list = splits.get(s);
    if (!list) {
      addEdge(segA[s], segB[s]);
      continue;
    }
    list.sort((p, q) => p[0] - q[0]);
    let from = segA[s];
    for (const [, n] of list) {
      addEdge(from, n);
      from = n;
    }
    addEdge(from, segB[s]);
  }
  for (let i = 0; i < extraA.length; i++) addEdge(extraA[i], extraB[i]);

  const nodes = xs.length;
  const first = new Uint32Array(nodes + 1);
  for (let e = 0; e < edgeA.length; e++) {
    first[edgeA[e] + 1]++;
    first[edgeB[e] + 1]++;
  }
  for (let n = 0; n < nodes; n++) first[n + 1] += first[n];
  const fill = first.slice(0, nodes);
  const to = new Uint32Array(edgeA.length * 2);
  const cost = new Float64Array(edgeA.length * 2);
  const cells = new Map<number, number[]>();
  for (let e = 0; e < edgeA.length; e++) {
    const a = edgeA[e];
    const b = edgeB[e];
    const length = Math.hypot(xs[b] - xs[a], ys[b] - ys[a]);
    to[fill[a]] = b;
    cost[fill[a]++] = length;
    to[fill[b]] = a;
    cost[fill[b]++] = length;
    addToCells(cells, e, xs[a], ys[a], xs[b], ys[b]);
  }
  return {
    nodes,
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    first,
    to,
    cost,
    edgeA: Uint32Array.from(edgeA),
    edgeB: Uint32Array.from(edgeB),
    cells,
    cell,
  };
}

// How far along a-b the point nearest p is, clamped to the segment, and how far away it is.
function project(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  let t = length2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / length2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [t, Math.hypot(px - (ax + dx * t), py - (ay + dy * t))];
}

/** Up to `count` spots on different edges within `reach` of p, nearest first. */
export function nearbyRoads(graph: RoadGraph, p: Point, reach: number, count = 1): RoadSpot[] {
  const { xs, ys, edgeA, edgeB, cells, cell } = graph;
  const r = Math.ceil(reach / cell);
  const cx = Math.floor(p[0] / cell);
  const cy = Math.floor(p[1] / cell);
  const found: RoadSpot[] = [];
  const seen = new Set<number>();
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (const e of cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
        if (seen.has(e)) continue;
        seen.add(e);
        const a = edgeA[e];
        const b = edgeB[e];
        const [t, distance] = project(p[0], p[1], xs[a], ys[a], xs[b], ys[b]);
        if (distance > reach) continue;
        found.push({ edge: e, t, point: [xs[a] + (xs[b] - xs[a]) * t, ys[a] + (ys[b] - ys[a]) * t], distance });
      }
    }
  }
  found.sort((x, y) => x.distance - y.distance);
  return found.slice(0, count);
}

export function nearestRoad(graph: RoadGraph, p: Point, reach: number): RoadSpot | null {
  return nearbyRoads(graph, p, reach, 1)[0] ?? null;
}

// A* needs these for every node, so one set is kept per graph and stamped
// with the search it belongs to instead of being cleared.
interface Scratch {
  stamp: Uint32Array;
  done: Uint32Array;
  g: Float64Array;
  prev: Int32Array;
  search: number;
}
const scratches = new WeakMap<RoadGraph, Scratch>();

function scratchFor(graph: RoadGraph): Scratch {
  let s = scratches.get(graph);
  if (!s) {
    s = {
      stamp: new Uint32Array(graph.nodes),
      done: new Uint32Array(graph.nodes),
      g: new Float64Array(graph.nodes),
      prev: new Int32Array(graph.nodes),
      search: 0,
    };
    scratches.set(graph, s);
  }
  return s;
}

// A plain binary heap of node ids by priority.
class Heap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      ids[i] = ids[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    ids[i] = id;
    keys[i] = key;
  }

  /** The smallest key, and its id in `out`. */
  pop(out: { id: number }): number {
    const { ids, keys } = this;
    const top = keys[0];
    out.id = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= ids.length) break;
        if (child + 1 < ids.length && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        ids[i] = ids[child];
        keys[i] = keys[child];
        i = child;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

// Searches past this many nodes give up. A route across a whole city map is
// well under it.
const MAX_VISITS = 400_000;

/**
 * The shortest way along the network from one spot to another, from
 * from.point to to.point. Null when they aren't connected within maxCost mm.
 */
export function routeBetween(graph: RoadGraph, from: RoadSpot, to: RoadSpot, maxCost = Infinity): Point[] | null {
  const { xs, ys, first, cost, edgeA, edgeB } = graph;
  if (from.edge === to.edge) return [from.point, to.point];
  const s = scratchFor(graph);
  const search = ++s.search;
  if (search === 0xffffffff) {
    s.stamp.fill(0);
    s.done.fill(0);
    s.search = 1;
  }
  const id = s.search;
  const [tx, ty] = to.point;
  const heap = new Heap();
  const seed = (n: number, g: number) => {
    if (s.stamp[n] === id && s.g[n] <= g) return;
    s.stamp[n] = id;
    s.g[n] = g;
    s.prev[n] = -1;
    heap.push(n, g + Math.hypot(xs[n] - tx, ys[n] - ty));
  };
  const fromLength = edgeLength(graph, from.edge);
  seed(edgeA[from.edge], from.t * fromLength);
  seed(edgeB[from.edge], (1 - from.t) * fromLength);
  const toLength = edgeLength(graph, to.edge);
  const endA = edgeA[to.edge];
  const endB = edgeB[to.edge];
  const finishA = to.t * toLength;
  const finishB = (1 - to.t) * toLength;

  let best = Infinity;
  let bestEnd = -1;
  let visits = 0;
  const out = { id: 0 };
  while (heap.size) {
    const f = heap.pop(out);
    if (f >= best || f > maxCost || ++visits > MAX_VISITS) break;
    const n = out.id;
    if (s.done[n] === id) continue;
    s.done[n] = id;
    const g = s.g[n];
    if (n === endA && g + finishA < best) {
      best = g + finishA;
      bestEnd = n;
    }
    if (n === endB && g + finishB < best) {
      best = g + finishB;
      bestEnd = n;
    }
    for (let k = first[n]; k < first[n + 1]; k++) {
      const m = graph.to[k];
      const gm = g + cost[k];
      if (s.stamp[m] === id && (s.done[m] === id || s.g[m] <= gm)) continue;
      s.stamp[m] = id;
      s.g[m] = gm;
      s.prev[m] = n;
      heap.push(m, gm + Math.hypot(xs[m] - tx, ys[m] - ty));
    }
  }
  if (bestEnd < 0 || best > maxCost) return null;
  const path: Point[] = [to.point];
  for (let n = bestEnd; n >= 0; n = s.prev[n]) path.push([xs[n], ys[n]]);
  path.push(from.point);
  path.reverse();
  return dedupe(path);
}

/**
 * The shortest ways from one spot to each of several, from one search. Used
 * by matching, which needs every pair of spots between two track points.
 * Null for a spot not reached within maxCost.
 */
export function routesFrom(graph: RoadGraph, from: RoadSpot, targets: readonly RoadSpot[], maxCost: number): (Point[] | null)[] {
  const { xs, ys, first, cost, edgeA, edgeB } = graph;
  const s = scratchFor(graph);
  const search = ++s.search;
  if (search === 0xffffffff) {
    s.stamp.fill(0);
    s.done.fill(0);
    s.search = 1;
  }
  const id = s.search;
  const heap = new Heap();
  const seed = (n: number, g: number) => {
    if (s.stamp[n] === id && s.g[n] <= g) return;
    s.stamp[n] = id;
    s.g[n] = g;
    s.prev[n] = -1;
    heap.push(n, g);
  };
  const fromLength = edgeLength(graph, from.edge);
  seed(edgeA[from.edge], from.t * fromLength);
  seed(edgeB[from.edge], (1 - from.t) * fromLength);
  // Each target is reached through either end of its edge.
  const ends = new Map<number, { target: number; extra: number }[]>();
  targets.forEach((to, target) => {
    if (to.edge === from.edge) return;
    const length = edgeLength(graph, to.edge);
    for (const [n, extra] of [
      [edgeA[to.edge], to.t * length],
      [edgeB[to.edge], (1 - to.t) * length],
    ] as const) {
      const list = ends.get(n);
      if (list) list.push({ target, extra });
      else ends.set(n, [{ target, extra }]);
    }
  });
  const best = targets.map((to) => (to.edge === from.edge ? Math.hypot(to.point[0] - from.point[0], to.point[1] - from.point[1]) : Infinity));
  const bestEnd = targets.map(() => -1);
  let open = targets.filter((to) => to.edge !== from.edge).length;
  let visits = 0;
  const out = { id: 0 };
  while (heap.size && open > 0) {
    const g = heap.pop(out);
    if (g > maxCost || ++visits > MAX_VISITS) break;
    const n = out.id;
    if (s.done[n] === id) continue;
    s.done[n] = id;
    for (const { target, extra } of ends.get(n) ?? []) {
      if (g + extra < best[target]) {
        best[target] = g + extra;
        bestEnd[target] = n;
      }
    }
    // A target is settled once nothing left in the heap could beat it.
    open = 0;
    for (let i = 0; i < targets.length; i++) if (targets[i].edge !== from.edge && !(best[i] <= g)) open++;
    for (let k = first[n]; k < first[n + 1]; k++) {
      const m = graph.to[k];
      const gm = g + cost[k];
      if (s.stamp[m] === id && (s.done[m] === id || s.g[m] <= gm)) continue;
      s.stamp[m] = id;
      s.g[m] = gm;
      s.prev[m] = n;
      heap.push(m, gm);
    }
  }
  return targets.map((to, i) => {
    if (to.edge === from.edge) return [from.point, to.point];
    if (bestEnd[i] < 0 || best[i] > maxCost) return null;
    const path: Point[] = [to.point];
    for (let n = bestEnd[i]; n >= 0; n = s.prev[n]) path.push([xs[n], ys[n]]);
    path.push(from.point);
    path.reverse();
    return dedupe(path);
  });
}

function edgeLength(graph: RoadGraph, e: number): number {
  const a = graph.edgeA[e];
  const b = graph.edgeB[e];
  return Math.hypot(graph.xs[b] - graph.xs[a], graph.ys[b] - graph.ys[a]);
}

function dedupe(path: Point[]): Point[] {
  return path.filter((p, i) => i === 0 || Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) > 1e-6);
}

export function lengthOf(path: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return total;
}

/**
 * Drops short out-and-back spikes, where the path turns almost straight back
 * on itself within `reach` mm. Matching leaves these where it picks a spot a
 * little past a corner. Real out-and-backs are longer and stay.
 */
export function removeSpurs(path: readonly Point[], reach: number): Point[] {
  const out: Point[] = [];
  for (const p of path) {
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const vx = c[0] - b[0];
      const vy = c[1] - b[1];
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      if (lu < 1e-9 || lv < 1e-9) {
        out.splice(out.length - 2, 1);
        continue;
      }
      const turn = (ux * vx + uy * vy) / (lu * lv);
      if (turn > -0.97 || Math.min(lu, lv) > reach) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

export interface MatchOptions {
  /** Distance between the points that are matched, mm. */
  spacing: number;
  /** How far from a road a point can still be matched to it, mm. */
  reach: number;
  /** About how far GPS points stray from the road, mm. */
  sigma: number;
  /** Spikes shorter than this are dropped afterwards, mm. */
  spur: number;
}

/**
 * Moves a path onto the roads, the way a GPS track is matched to a map: points
 * along it are tried against the roads near them, and the chain of roads with
 * the least wandering from the track and the fewest detours wins (Newson and
 * Krumm's hidden Markov model). Stretches away from any road keep their own
 * points, so a run across a park or a beach stays as it was.
 */
export function matchToRoads(graph: RoadGraph, path: readonly Point[], options: MatchOptions): Point[] {
  if (path.length < 2) return [...path];
  const { spacing, reach, sigma } = options;
  const samples = resample(path, spacing);
  const candidates = samples.map((sample) => nearbyRoads(graph, sample.point, reach, 4));

  // A chain is a run of samples matched one after another. Each sample keeps
  // the cost of the best way to each of its candidates and where it came from.
  interface Step {
    cost: number[];
    from: number[];
    via: (Point[] | null)[];
  }
  const chains: { start: number; steps: Step[] }[] = [];
  let chain: { start: number; steps: Step[] } | null = null;
  const emission = (d: number) => (d / sigma) ** 2 / 2;
  for (let k = 0; k < samples.length; k++) {
    const here = candidates[k];
    if (!here.length) {
      chain = null;
      continue;
    }
    if (!chain) {
      chain = { start: k, steps: [{ cost: here.map((c) => emission(c.distance)), from: here.map(() => -1), via: here.map(() => null) }] };
      chains.push(chain);
      continue;
    }
    const before = candidates[k - 1];
    const last = chain.steps[chain.steps.length - 1];
    const straight = Math.hypot(samples[k].point[0] - samples[k - 1].point[0], samples[k].point[1] - samples[k - 1].point[1]);
    const step: Step = { cost: here.map(() => Infinity), from: here.map(() => -1), via: here.map(() => null) };
    for (let i = 0; i < before.length; i++) {
      if (!Number.isFinite(last.cost[i])) continue;
      const ways = routesFrom(graph, before[i], here, straight * 3 + reach * 2);
      for (let j = 0; j < here.length; j++) {
        const way = ways[j];
        if (!way) continue;
        const detour = Math.abs(lengthOf(way) - straight) / sigma;
        const cost = last.cost[i] + detour + emission(here[j].distance);
        if (cost < step.cost[j]) {
          step.cost[j] = cost;
          step.from[j] = i;
          step.via[j] = way;
        }
      }
    }
    if (step.cost.every((c) => !Number.isFinite(c))) {
      // The roads don't connect here, so a new chain starts.
      chain = { start: k, steps: [{ cost: here.map((c) => emission(c.distance)), from: here.map(() => -1), via: here.map(() => null) }] };
      chains.push(chain);
      continue;
    }
    chain.steps.push(step);
  }

  // Each chain's road geometry, back from its best last candidate.
  const matched = chains
    .filter((c) => c.steps.length >= 2)
    .map((c) => {
      const steps = c.steps;
      let j = 0;
      const lastCost = steps[steps.length - 1].cost;
      for (let i = 1; i < lastCost.length; i++) if (lastCost[i] < lastCost[j]) j = i;
      const pieces: Point[][] = [];
      for (let k = steps.length - 1; k > 0; k--) {
        pieces.push(steps[k].via[j]!);
        j = steps[k].from[j];
      }
      pieces.reverse();
      const points: Point[] = [];
      for (const piece of pieces) points.push(...(points.length ? piece.slice(1) : piece));
      return { from: samples[c.start].along, to: samples[c.start + steps.length - 1].along, points: removeSpurs(points, options.spur) };
    });

  // Between and around the matched stretches, the track's own points.
  // The first point counts from the very start, or an unmatched start lost it.
  const out: Point[] = [];
  let at = -1;
  for (const m of matched) {
    out.push(...slice(path, at, m.from));
    out.push(...m.points);
    at = m.to;
  }
  out.push(...slice(path, at, Infinity));
  return dedupe(out);
}

interface Sample {
  point: Point;
  along: number;
}

// Points every `spacing` along the path, with both ends.
function resample(path: readonly Point[], spacing: number): Sample[] {
  const out: Sample[] = [{ point: path[0], along: 0 }];
  let along = 0;
  let next = spacing;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const length = Math.hypot(bx - ax, by - ay);
    while (length > 0 && next <= along + length) {
      const t = (next - along) / length;
      out.push({ point: [ax + (bx - ax) * t, ay + (by - ay) * t], along: next });
      next += spacing;
    }
    along += length;
  }
  if (out.length === 1 || along - out[out.length - 1].along > spacing * 0.25) out.push({ point: path[path.length - 1], along });
  else out[out.length - 1] = { point: path[path.length - 1], along };
  return out;
}

// The path's own points strictly between two distances along it.
function slice(path: readonly Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  let along = 0;
  for (let i = 0; i < path.length; i++) {
    if (i) along += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (along > from && along < to) out.push(path[i]);
    if (along >= to) break;
  }
  return out;
}
