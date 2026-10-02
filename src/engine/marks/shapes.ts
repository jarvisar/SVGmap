// Shapes for pins and the other marks, drawn 1 unit tall with y down. The same
// outlines go into the SVG, the preview while a mark is dragged, the map view
// and the buttons that pick them, so they always match.
//
// A shape is its filled rings with holes cut out of them, then `extra` rings
// added back on top, which is how a target gets a dot inside its ring.
import type { Path, Point } from '../lines/geometry.ts';

export type MarkShape = 'none' | 'pin' | 'dot' | 'target' | 'heart' | 'star' | 'sparkle' | 'house' | 'flag' | 'cross' | 'arrow' | 'peak' | 'tree';

export interface ShapeDef {
  name: string;
  fill: Path[];
  holes: Path[];
  extra: Path[];
  // The point that sits on the spot it marks, like the tip of a pin. Turning
  // and resizing keep it there.
  anchor: Point;
  // Where text beside it lines up, and where text inside it is centred.
  focus: Point;
  // Width and height of the room for text inside it.
  room: [number, number];
}

function circle(cx: number, cy: number, r: number, n = 72): Path {
  const out: Path = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

const box = (x0: number, y0: number, x1: number, y1: number): Path => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

// A bar from a to b with round ends.
function stadium(a: Point, b: Point, r: number, n = 16): Path {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const out: Path = [];
  for (const [end, start] of [
    [b, angle - Math.PI / 2],
    [a, angle + Math.PI / 2],
  ] as const) {
    for (let i = 0; i <= n; i++) {
      const t = start + (Math.PI * i) / n;
      out.push([end[0] + r * Math.cos(t), end[1] + r * Math.sin(t)]);
    }
  }
  return out;
}

// A teardrop: a round head and the tangents from it down to the tip.
function teardrop(head: Point, r: number, tip: Point, n = 72): Path {
  const d = Math.hypot(tip[0] - head[0], tip[1] - head[1]);
  const toTip = Math.atan2(tip[1] - head[1], tip[0] - head[0]);
  const spread = Math.acos(r / d);
  const out: Path = [];
  for (let i = 0; i <= n; i++) {
    const a = toTip + spread + ((2 * Math.PI - 2 * spread) * i) / n;
    out.push([head[0] + r * Math.cos(a), head[1] + r * Math.sin(a)]);
  }
  out.push(tip);
  return out;
}

// Rings scaled to 1 tall and centred on 0, 0.
function normalised(rings: Path[]): Path[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const k = 1 / (maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return rings.map((ring) => ring.map(([x, y]): Point => [(x - cx) * k, (y - cy) * k]));
}

function heart(n = 120): Path {
  const out: Path = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  }
  return normalised([out])[0];
}

function star(points: number, inner: number): Path {
  const out: Path = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : 1;
    const a = -Math.PI / 2 + (Math.PI * i) / points;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return normalised([out])[0];
}

// An astroid: four points joined by curves bowed in towards the middle.
function sparkle(n = 96): Path {
  const out: Path = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push([0.5 * Math.cos(t) ** 3, 0.5 * Math.sin(t) ** 3]);
  }
  return out;
}

// A pennant with a slight wave, on a pole planted at the anchor.
function flagCloth(n = 24): Path {
  const top: Path = [];
  const bottom: Path = [];
  for (let i = 0; i <= n; i++) {
    const x = -0.34 + (0.8 * i) / n;
    const wave = 0.035 * Math.sin((i / n) * 2 * Math.PI);
    top.push([x, -0.5 + wave]);
    bottom.push([x, -0.06 + wave]);
  }
  return [...top, ...bottom.reverse()];
}

const shape = (def: Partial<ShapeDef> & Pick<ShapeDef, 'name' | 'fill'>): ShapeDef => ({
  holes: [],
  extra: [],
  anchor: [0, 0],
  focus: [0, 0],
  room: [0.6, 0.4],
  ...def,
});

export const MARK_SHAPES: Record<MarkShape, ShapeDef> = {
  none: shape({ name: 'Text only', fill: [], room: [0, 0] }),
  pin: shape({
    name: 'Pin',
    fill: [teardrop([0, -0.15], 0.35, [0, 0.5])],
    holes: [circle(0, -0.15, 0.13)],
    anchor: [0, 0.5],
    focus: [0, -0.15],
    room: [0.46, 0.36],
  }),
  dot: shape({ name: 'Dot', fill: [circle(0, 0, 0.5)], room: [0.66, 0.5] }),
  target: shape({ name: 'Target', fill: [circle(0, 0, 0.5)], holes: [circle(0, 0, 0.34)], extra: [circle(0, 0, 0.17)], room: [0.66, 0.5] }),
  heart: shape({ name: 'Heart', fill: [heart()], focus: [0, -0.08], room: [0.56, 0.32] }),
  star: shape({ name: 'Star', fill: [star(5, 0.4)], focus: [0, 0.06], room: [0.3, 0.22] }),
  sparkle: shape({ name: 'Sparkle', fill: [sparkle()], room: [0.16, 0.16] }),
  house: shape({
    name: 'House',
    fill: [
      [
        [-0.5, -0.02],
        [0, -0.5],
        [0.5, -0.02],
      ],
      box(-0.36, -0.06, 0.36, 0.5),
      box(0.18, -0.42, 0.3, -0.2),
    ],
    holes: [box(-0.09, 0.2, 0.09, 0.5)],
    focus: [0, 0.18],
    room: [0.6, 0.4],
  }),
  flag: shape({ name: 'Flag', fill: [box(-0.42, -0.5, -0.34, 0.5), flagCloth()], anchor: [-0.38, 0.5], focus: [0.06, -0.28], room: [0.66, 0.32] }),
  cross: shape({
    name: 'Cross',
    fill: [stadium([-0.39, -0.39], [0.39, 0.39], 0.11), stadium([-0.39, 0.39], [0.39, -0.39], 0.11)],
    room: [0.2, 0.2],
  }),
  arrow: shape({
    name: 'Arrow',
    fill: [
      [
        [-0.42, -0.02],
        [0, -0.5],
        [0.42, -0.02],
      ],
      box(-0.13, -0.06, 0.13, 0.5),
    ],
    anchor: [0, -0.5],
    focus: [0, 0],
    room: [0.2, 0.3],
  }),
  peak: shape({
    name: 'Mountain',
    fill: [
      [
        [-0.52, 0.5],
        [-0.08, -0.5],
        [0.36, 0.5],
      ],
      [
        [0.02, 0.5],
        [0.27, 0.02],
        [0.52, 0.5],
      ],
    ],
    focus: [-0.08, 0.2],
    room: [0.34, 0.28],
  }),
  tree: shape({
    name: 'Tree',
    fill: [
      [
        [-0.28, -0.14],
        [0, -0.5],
        [0.28, -0.14],
      ],
      [
        [-0.36, 0.1],
        [0, -0.32],
        [0.36, 0.1],
      ],
      [
        [-0.44, 0.36],
        [0, -0.1],
        [0.44, 0.36],
      ],
      box(-0.07, 0.3, 0.07, 0.5),
    ],
    focus: [0, 0.12],
    room: [0.3, 0.2],
  }),
};

// In the order they're offered.
export const SHAPE_ORDER: MarkShape[] = ['pin', 'dot', 'target', 'heart', 'star', 'sparkle', 'house', 'flag', 'cross', 'arrow', 'peak', 'tree', 'none'];
