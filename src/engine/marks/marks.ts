// Pins, shapes and text the user puts on the map. Each mark is a shape, a bit
// of text or both, stuck to a spot on the map (it follows the map as that
// moves) or to the page. Like the title, the map is left out under it.
//
// Marks are laid out around their spot, which is 0, 0, and already turned.
// Whoever draws them moves them to where the spot is on the piece, so moving
// the map doesn't lay out the text again.
import { lonLatToWorld, worldSize, worldToLonLat } from '../geo/mercator.ts';
import type { MapTransform } from '../geo/transform.ts';
import type { Shape } from '../layout/shapes.ts';
import type { Path, Point } from '../lines/geometry.ts';
import { CUSTOM_FONT_ID, FONTS } from '../text/fonts.ts';
import { type LoadedFont, type TextGeometry, geometryBounds, textGeometry } from '../text/outline.ts';
import { MARK_SHAPES, type MarkShape, SHAPE_ORDER } from './shapes.ts';

export type { MarkShape };

export type MarkSide = 'right' | 'left' | 'above' | 'below' | 'inside';
export type MarkAnchor = 'map' | 'page';
export type MarkFill = 'fill' | 'outline' | 'hatch' | 'hatch-outline';

export interface MapMark {
  id: string;
  shape: MarkShape;
  // Up to MAX_MARK_LINES lines.
  text: string;
  // Where the text goes around the shape.
  side: MarkSide;
  anchor: MarkAnchor;
  // The spot on the map, used when anchor is 'map'.
  lon: number;
  lat: number;
  // The spot on the page as a share of the map window from its centre, used
  // when anchor is 'page'. -0.5 is the left or top edge.
  x: number;
  y: number;
  // Height of the shape, mm.
  size: number;
  // Height of the capitals, mm.
  textSize: number;
  // Degrees clockwise, around the spot.
  rotation: number;
  // A font id, or '' for the title's font.
  font: string;
  // #RRGGBB, or '' for the title's colour in each output mode.
  color: string;
  fill: MarkFill;
  // Leave the map out under it, and this far around it.
  clear: boolean;
  gap: number;
}

export const MAX_MARKS = 60;
export const MAX_MARK_TEXT = 120;
export const MAX_MARK_LINES = 4;

export const MARK_RANGES = {
  size: { min: 1, max: 150 },
  textSize: { min: 0.8, max: 60 },
  rotation: { min: -180, max: 180 },
  gap: { min: 0, max: 10 },
} as const;

export const MARK_SIDES: MarkSide[] = ['right', 'left', 'above', 'below', 'inside'];
const ANCHORS: MarkAnchor[] = ['map', 'page'];
const FILLS: MarkFill[] = ['fill', 'outline', 'hatch', 'hatch-outline'];
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9]{1,24}$/i;

export const DEFAULT_MARK: Omit<MapMark, 'id'> = {
  shape: 'pin',
  text: '',
  side: 'right',
  anchor: 'map',
  lon: 0,
  lat: 0,
  x: 0,
  y: 0,
  size: 7,
  textSize: 3,
  rotation: 0,
  font: '',
  color: '',
  fill: 'fill',
  clear: true,
  gap: 0.6,
};

const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value));
const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);

// Turned into -180 to 180.
export function wrapDegrees(degrees: number): number {
  const d = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

export function markText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_MARK_LINES).join('\n').slice(0, MAX_MARK_TEXT);
}

/**
 * Marks from saved settings or a link, with anything unknown dropped and
 * numbers brought into range. Fields a mark is missing get the defaults, so
 * marks saved by an older build still load. A mark without a usable id is
 * dropped, since the id ties it to its layer in the file.
 */
export function sanitizeMarks(value: unknown): MapMark[] {
  if (!Array.isArray(value)) return [];
  const out: MapMark[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (out.length >= MAX_MARKS) break;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const m = item as Record<string, unknown>;
    if (typeof m.id !== 'string' || !ID.test(m.id) || ids.has(m.id)) continue;
    ids.add(m.id);
    const d = DEFAULT_MARK;
    const font = typeof m.font === 'string' && (m.font === '' || m.font === CUSTOM_FONT_ID || FONTS.some((f) => f.id === m.font)) ? m.font : d.font;
    const lat = number(m.lat, d.lat);
    out.push({
      id: m.id,
      shape: oneOf(m.shape, SHAPE_ORDER, d.shape),
      text: typeof m.text === 'string' ? markText(m.text) : d.text,
      side: oneOf(m.side, MARK_SIDES, d.side),
      anchor: oneOf(m.anchor, ANCHORS, d.anchor),
      lon: wrapDegrees(number(m.lon, d.lon)),
      lat: Math.abs(lat) <= 85 ? lat : d.lat,
      x: clamp(number(m.x, d.x), { min: -0.5, max: 0.5 }),
      y: clamp(number(m.y, d.y), { min: -0.5, max: 0.5 }),
      size: clamp(number(m.size, d.size), MARK_RANGES.size),
      textSize: clamp(number(m.textSize, d.textSize), MARK_RANGES.textSize),
      rotation: wrapDegrees(number(m.rotation, d.rotation)),
      font,
      color: typeof m.color === 'string' && (m.color === '' || HEX.test(m.color)) ? m.color.toUpperCase() : d.color,
      fill: oneOf(m.fill, FILLS, d.fill),
      clear: typeof m.clear === 'boolean' ? m.clear : d.clear,
      gap: clamp(number(m.gap, d.gap), MARK_RANGES.gap),
    });
  }
  return out;
}

/** The font a mark's text is set in, given the title's. */
export const markFont = (mark: MapMark, titleFont: string): string => mark.font || titleFont;

export const hasText = (mark: MapMark): boolean => mark.text.trim() !== '';

/** What to call a mark: its text, or the shape's name. */
export function markName(mark: MapMark): string {
  const line = mark.text.split('\n').find((l) => l.trim())?.trim();
  if (line) return line.length > 28 ? `${line.slice(0, 27)}…` : line;
  return MARK_SHAPES[mark.shape].name;
}

/** A mark as a noun in an undo step, like 'Move heart' or 'Edit text'. */
export function markNoun(mark: MapMark): string {
  return mark.shape === 'none' ? 'text' : MARK_SHAPES[mark.shape].name.toLowerCase();
}

/** An undo step's name for a change to the marks, like 'Move heart'. */
export function describeMarksChange(from: readonly MapMark[], to: readonly MapMark[]): string {
  if (to.length > from.length) {
    const added = to.filter((m) => !from.some((f) => f.id === m.id));
    return added.length === 1 ? `Add ${markNoun(added[0])}` : 'Add pins and text';
  }
  if (to.length < from.length) {
    const gone = from.filter((m) => !to.some((t) => t.id === m.id));
    return gone.length === 1 ? `Delete ${markNoun(gone[0])}` : 'Delete pins and text';
  }
  const i = to.findIndex((m, n) => m !== from[n]);
  const [a, b] = [from[i], to[i]];
  if (!a || !b || a.id !== b.id) return 'Change pins and text';
  const noun = markNoun(b);
  if (a.lon !== b.lon || a.lat !== b.lat || a.x !== b.x || a.y !== b.y) return `Move ${noun}`;
  if (a.size !== b.size || a.textSize !== b.textSize) return `Resize ${noun}`;
  if (a.rotation !== b.rotation) return `Turn ${noun}`;
  if (a.text !== b.text) return `Edit ${noun}`;
  return `Change ${noun}`;
}

// ------------------------------------------------------------ placing

/** Where a mark's spot is on the piece, mm. */
export function markPoint(mark: MapMark, transform: MapTransform, window: Shape): Point {
  if (mark.anchor === 'page') return [window.x + window.w * (0.5 + mark.x), window.y + window.h * (0.5 + mark.y)];
  const [x, y] = lonLatToWorld(mark.lon, mark.lat, transform.zoom);
  // The copy of the world nearest the map, as with the routes.
  const world = worldSize(transform.zoom);
  return transform.toCanvas(x + world * Math.round((transform.cx - x) / world), y);
}

/** The settings that put a mark's spot at a point on the piece. */
export function markPlacedAt(point: Point, transform: MapTransform, window: Shape): Pick<MapMark, 'lon' | 'lat' | 'x' | 'y'> {
  const x = clamp((point[0] - window.x) / window.w - 0.5, { min: -0.5, max: 0.5 });
  const y = clamp((point[1] - window.y) / window.h - 0.5, { min: -0.5, max: 0.5 });
  const [wx, wy] = transform.toWorld(point[0], point[1]);
  const { lon, lat } = worldToLonLat(wx, wy, transform.zoom);
  const round = (v: number) => Math.round(v * 1e7) / 1e7;
  // Both are kept up to date, so switching what it stays with keeps it where it is.
  return { lon: round(wrapDegrees(lon)), lat: round(Math.max(-85, Math.min(85, lat))), x: round(x), y: round(y) };
}

// ------------------------------------------------------------ laying out

export interface MarkArtwork {
  // Around the spot, which is 0, 0, and already turned.
  fill: Path[];
  holes: Path[];
  extra: Path[];
  text: TextGeometry;
  // The text is cut out of the shape instead of drawn beside it.
  inside: boolean;
  // Everything drawn, before turning, as [x0, y0, x1, y1] around the spot.
  box: [number, number, number, number];
  rotation: number;
  // Nothing to draw: no shape and no text.
  empty: boolean;
}

const capHeights = new WeakMap<object, number>();

// Height of a capital H at one em, which the text size is measured by.
function capHeight(font: LoadedFont): number {
  let cap = capHeights.get(font.font);
  if (cap === undefined) {
    const b = geometryBounds(textGeometry(font, 'H'));
    cap = b ? b[3] - b[1] : 0.7;
    capHeights.set(font.font, cap);
  }
  return cap;
}

const mapGeometry = (g: TextGeometry, f: (p: Point) => Point): TextGeometry => ({ rings: g.rings.map((r) => r.map(f)), strokes: g.strokes.map((s) => s.map(f)) });

function boundsOf(paths: Path[]): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const path of paths) {
    for (const [x, y] of path) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

const join = (a: [number, number, number, number] | null, b: [number, number, number, number] | null) =>
  !a ? b : !b ? a : ([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] as [number, number, number, number]);

interface TextBlock {
  g: TextGeometry;
  w: number;
  // From the top of the first line's capitals to the last baseline.
  capTop: number;
  lastBaseline: number;
}

// Lines stacked with the first baseline at 0, each aligned in the block.
function textBlock(font: LoadedFont, text: string, height: number, align: 'left' | 'center' | 'right'): TextBlock | null {
  const k = height / capHeight(font);
  const lineGap = height * 1.6;
  const lines: { g: TextGeometry; x0: number; x1: number; baseline: number }[] = [];
  text.split('\n').forEach((line, i) => {
    const typed = line.trim();
    const baseline = i * lineGap;
    if (!typed) return;
    const g = textGeometry(font, typed);
    const b = geometryBounds(g);
    if (b) lines.push({ g, x0: b[0] * k, x1: b[2] * k, baseline });
  });
  if (!lines.length) return null;
  const w = Math.max(...lines.map((l) => l.x1 - l.x0));
  const rings: Path[] = [];
  const strokes: Path[] = [];
  for (const line of lines) {
    const lw = line.x1 - line.x0;
    const dx = (align === 'left' ? 0 : align === 'right' ? w - lw : (w - lw) / 2) - line.x0;
    const placed = mapGeometry(line.g, ([x, y]) => [x * k + dx, y * k + line.baseline]);
    rings.push(...placed.rings);
    strokes.push(...placed.strokes);
  }
  return { g: { rings, strokes }, w, capTop: lines[0].baseline - height, lastBaseline: lines[lines.length - 1].baseline };
}

/**
 * A mark laid out around its spot. font is null when its text can't be set
 * yet, which leaves the text out.
 */
export function layoutMark(mark: MapMark, font: LoadedFont | null): MarkArtwork {
  const def = MARK_SHAPES[mark.shape] ?? MARK_SHAPES.pin;
  const s = mark.size;
  const unit = ([x, y]: Point): Point => [(x - def.anchor[0]) * s, (y - def.anchor[1]) * s];
  const typed = font && hasText(mark);
  const inside = Boolean(typed) && mark.shape !== 'none' && mark.side === 'inside';
  const fill = def.fill.map((r) => r.map(unit));
  // Text inside a pin or a house takes the place of its hole or door.
  const holes = inside ? [] : def.holes.map((r) => r.map(unit));
  const extra = inside ? [] : def.extra.map((r) => r.map(unit));
  const shapeBox = boundsOf(fill);
  const [fx, fy] = unit(def.focus);

  let text: TextGeometry = { rings: [], strokes: [] };
  if (typed && font) {
    const side = mark.shape === 'none' ? 'none' : mark.side;
    const align = side === 'right' ? 'left' : side === 'left' ? 'right' : 'center';
    const block = textBlock(font, mark.text, mark.textSize, align);
    if (block) {
      const g = Math.max(0.4, mark.textSize * 0.35);
      const midY = (block.capTop + block.lastBaseline) / 2;
      // Descenders hang about a quarter of the cap height under the last line.
      const bottom = block.lastBaseline + mark.textSize * 0.28;
      let k = 1;
      let dx = -block.w / 2;
      let dy = -midY;
      if (shapeBox && side === 'right') [dx, dy] = [shapeBox[2] + g, fy - midY];
      else if (shapeBox && side === 'left') [dx, dy] = [shapeBox[0] - g - block.w, fy - midY];
      else if (shapeBox && side === 'above') [dx, dy] = [fx - block.w / 2, shapeBox[1] - g - bottom];
      else if (shapeBox && side === 'below') [dx, dy] = [fx - block.w / 2, shapeBox[3] + g - block.capTop];
      else if (shapeBox && side === 'inside') {
        // Shrunk to fit the room inside, never grown.
        const roomW = def.room[0] * s;
        const roomH = def.room[1] * s;
        k = Math.min(1, roomW / Math.max(block.w, 1e-6), roomH / Math.max(block.lastBaseline - block.capTop, 1e-6));
        [dx, dy] = [fx - (block.w / 2) * k, fy - midY * k];
      }
      text = mapGeometry(block.g, ([x, y]) => [x * k + dx, y * k + dy]);
    }
  }

  const textBox = geometryBounds(text);
  const box = join(shapeBox, textBox ? [textBox[0], textBox[1], textBox[2], textBox[3]] : null);
  const empty = !box;
  const turn = mark.rotation ? (p: Point): Point => rotate(p, mark.rotation) : null;
  return {
    fill: turn ? fill.map((r) => r.map(turn)) : fill,
    holes: turn ? holes.map((r) => r.map(turn)) : holes,
    extra: turn ? extra.map((r) => r.map(turn)) : extra,
    text: turn ? mapGeometry(text, turn) : text,
    inside,
    // An empty mark still gets a small box, so it can be found and picked.
    box: box ?? [-2, -2, 2, 2],
    rotation: mark.rotation,
    empty,
  };
}

function rotate([x, y]: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** A point on the piece in the mark's own frame: relative to its spot and turned back. */
export function toMarkFrame(point: Point, at: Point, rotation: number): Point {
  return rotate([point[0] - at[0], point[1] - at[1]], -rotation);
}

/** A point in the mark's own frame back on the piece. */
export function fromMarkFrame(point: Point, at: Point, rotation: number): Point {
  const [x, y] = rotate(point, rotation);
  return [x + at[0], y + at[1]];
}

/** The artwork moved to its spot on the piece. */
export function placeMark(art: MarkArtwork, at: Point): MarkArtwork {
  const move = ([x, y]: Point): Point => [x + at[0], y + at[1]];
  return {
    ...art,
    fill: art.fill.map((r) => r.map(move)),
    holes: art.holes.map((r) => r.map(move)),
    extra: art.extra.map((r) => r.map(move)),
    text: mapGeometry(art.text, move),
  };
}
