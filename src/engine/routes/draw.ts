// Imported routes on the piece. They skip the line cleanup and the layer
// filters and are drawn as imported. The map gives way to them instead: lines
// and areas closer than the gap are left out, so the route reads clearly and
// nothing is scored again inside an engraved band.
import type { Paths64 } from 'clipper2-ts';
import { SCALE, bufferLines, dilate, intersectWith, linesOutside, makeFillTester, subtract, toPath64, unionAll } from '../fills.ts';
import { clipPolylineInside } from '../geo/clip.ts';
import { lonLatToWorld, worldSize } from '../geo/mercator.ts';
import type { MapTransform } from '../geo/transform.ts';
import { type Shape, shapePolygon } from '../layout/shapes.ts';
import { type Path, type Point, pathLength } from '../lines/geometry.ts';
import type { RouteDraw, RouteSettings } from '../settings.ts';
import { decodeRoute, simplifyPath } from './route.ts';

export interface RouteArtwork {
  // Centrelines, inside the window and out from under the title.
  lines: Path[];
  // The band and markers, or only the markers when the route is a line.
  shape: Paths64;
  // Lines and areas in here are left out of the map.
  clear: Paths64;
  // Route on the piece, and how much of it the title covers, mm.
  drawnMm: number;
  underTitleMm: number;
}

// Finer than any beam or pen. A zoomed out marathon has several GPS points per
// millimetre, which only slow down the offsetting.
const SIMPLIFY_MM = 0.01;

function circle([cx, cy]: Point, r: number): Path {
  const step = 2 * Math.acos(Math.max(-1, 1 - 0.005 / r));
  const n = Math.min(256, Math.max(16, Math.ceil((2 * Math.PI) / step)));
  const out: Path = [];
  for (let i = 0; i < n; i++) out.push([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
  return out;
}

// Direction of travel into the end, measured over a short stretch so GPS
// wobble right at the finish doesn't tilt the bar.
function finishDirection(line: Path, reach: number): Point {
  const end = line[line.length - 1];
  for (let i = line.length - 2; i >= 0; i--) {
    const d = Math.hypot(end[0] - line[i][0], end[1] - line[i][1]);
    if (d >= reach || (i === 0 && d > 1e-9)) return [(end[0] - line[i][0]) / d, (end[1] - line[i][1]) / d];
  }
  return [1, 0];
}

// A dot at the start and a bar across the finish, like a finish line. A loop
// starts and finishes in the same place, so it only gets the dot.
function markerShapes(lines: Path[], size: number): Path[] {
  const start = lines[0][0];
  const last = lines[lines.length - 1];
  const end = last[last.length - 1];
  const shapes = [circle(start, size / 2)];
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) >= size) {
    const [dx, dy] = finishDirection(last, size / 2);
    const along = size * 0.2;
    const across = size * 0.6;
    const corner = (a: number, b: number): Point => [end[0] - dy * across * a + dx * along * b, end[1] + dx * across * a + dy * along * b];
    shapes.push([corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)]);
  }
  return shapes;
}

const totalLength = (paths: readonly Path[]) => paths.reduce((sum, p) => sum + pathLength(p), 0);

// lineWidth is what a route drawn as a line is stroked at: a hairline, the pen
// or the print width. title is the area the map leaves empty for the title.
export function buildRoutes(
  routes: RouteSettings,
  draw: RouteDraw,
  lineWidth: number,
  transform: MapTransform,
  window: Shape,
  title: Paths64,
): RouteArtwork | null {
  const visible = routes.items.filter((r) => r.visible);
  if (visible.length === 0) return null;
  const world = worldSize(transform.zoom);
  const project = ([lon, lat]: [number, number]): Point => {
    const [x, y] = lonLatToWorld(lon, lat, transform.zoom);
    // The copy of the world nearest the map, as with the tiles.
    return transform.toCanvas(x + world * Math.round((transform.cx - x) / world), y);
  };
  const windowPoly = shapePolygon(window);
  const markers: Path[] = [];
  const inside: Path[] = [];
  for (const route of visible) {
    const lines = decodeRoute(route).map((line) => simplifyPath(line.map(project), SIMPLIFY_MM));
    if (lines.length === 0) continue;
    if (routes.markers) markers.push(...markerShapes(lines, routes.markerSize));
    for (const line of lines) inside.push(...clipPolylineInside(line, windowPoly));
  }
  const shown = linesOutside(inside, title);
  const drawnMm = totalLength(shown);
  const underTitleMm = totalLength(inside) - drawnMm;

  const windowClip = [toPath64(windowPoly)];
  const onPiece = (paths: Paths64) => subtract(intersectWith(paths, windowClip), title);
  let shape: Paths64;
  let footprint: Paths64;
  if (draw === 'line') {
    shape = markers.length ? onPiece(unionAll(markers.map(toPath64))) : [];
    footprint = unionAll([...bufferLines(shown, lineWidth / 2, true), ...shape]);
  } else {
    // Buffered before the title is cut out, so the band stops square at its edge.
    const band = bufferLines(inside, routes.width / 2, true);
    shape = onPiece(unionAll([...band, ...markers.map(toPath64)]));
    footprint = shape;
  }
  const clear = routes.gap > 0 ? dilate(footprint, routes.gap) : footprint;
  return { lines: shown, shape, clear, drawnMm, underTitleMm };
}

// Cells the clear space touches, padded by one, so most of the map's lines can
// skip the Clipper pass.
class CoverMask {
  private readonly cell: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly marked: Uint8Array;

  constructor(paths: Paths64, cell: number) {
    this.cell = cell;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const path of paths) {
      for (const p of path) {
        minX = Math.min(minX, p.x / SCALE);
        minY = Math.min(minY, p.y / SCALE);
        maxX = Math.max(maxX, p.x / SCALE);
        maxY = Math.max(maxY, p.y / SCALE);
      }
    }
    this.x0 = minX - cell;
    this.y0 = minY - cell;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 3);
    this.rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 3);
    const raw = new Uint8Array(this.cols * this.rows);
    for (const path of paths) {
      for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        this.walk([path[j].x / SCALE, path[j].y / SCALE], [path[i].x / SCALE, path[i].y / SCALE], (index) => {
          raw[index] = 1;
          return false;
        });
      }
    }
    const inside = makeFillTester([paths]);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const index = row * this.cols + col;
        if (!raw[index] && inside?.([this.x0 + (col + 0.5) * cell, this.y0 + (row + 0.5) * cell])) raw[index] = 1;
      }
    }
    this.marked = new Uint8Array(raw.length);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (!raw[row * this.cols + col]) continue;
        for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++) {
          for (let c = Math.max(0, col - 1); c <= Math.min(this.cols - 1, col + 1); c++) this.marked[r * this.cols + c] = 1;
        }
      }
    }
  }

  // Visits the cells along a segment, every half cell. Stops when visit returns true.
  private walk(a: Point, b: Point, visit: (index: number) => boolean): boolean {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.cell / 2)) + 1;
    for (let k = 0; k <= n; k++) {
      const col = Math.floor((a[0] + ((b[0] - a[0]) * k) / n - this.x0) / this.cell);
      const row = Math.floor((a[1] + ((b[1] - a[1]) * k) / n - this.y0) / this.cell);
      if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) continue;
      if (visit(row * this.cols + col)) return true;
    }
    return false;
  }

  touches(path: Path): boolean {
    for (let i = 1; i < path.length; i++) {
      if (this.walk(path[i - 1], path[i], (index) => this.marked[index] === 1)) return true;
    }
    return false;
  }
}

// Length-weighted share of the path inside.
function shareInside(path: Path, inside: (p: Point) => boolean, step: number): number {
  let total = 0;
  let hit = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const n = Math.min(1000, Math.ceil(length / step));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      total += length / n;
      if (inside([ax + (bx - ax) * t, ay + (by - ay) * t])) hit += length / n;
    }
  }
  return total > 0 ? hit / total : 1;
}

// Cuts the map's lines back to the edge of the clear space. A piece left
// touching it is dropped too when most of it runs within spacing of the edge:
// short stubs, and roads the route follows that wander in and out of the gap,
// which would otherwise read as a dashed line beside it.
export function makeRouteClearer(clear: Paths64, spacing: number): (paths: Path[]) => Path[] {
  if (clear.length === 0) return (paths) => paths;
  const mask = new CoverMask(clear, 1);
  const alongside = Math.max(spacing, 0.2);
  const onEdge = makeFillTester([dilate(clear, 0.01)]) ?? (() => false);
  const near = makeFillTester([dilate(clear, alongside)]) ?? (() => false);
  return (paths) => {
    const kept: Path[] = [];
    const touched: Path[] = [];
    for (const path of paths) (mask.touches(path) ? touched : kept).push(path);
    if (touched.length === 0) return paths;
    for (const piece of linesOutside(touched, clear)) {
      const cut = onEdge(piece[0]) || onEdge(piece[piece.length - 1]);
      if (!cut || shareInside(piece, near, alongside / 2) < 0.5) kept.push(piece);
    }
    return kept;
  };
}
