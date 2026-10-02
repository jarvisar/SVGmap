// DXF for CAD and laser software that prefers it. R12, the version nearly
// everything reads, in millimetres with y up. Each group is a layer of its
// own. DXF has no fills, so filled areas come out as their outlines, which
// laser software fills in a fill layer.
//
// R12 layers only have AutoCAD's 255 indexed colours, so each colour gets the
// nearest one nobody else has taken. Two groups in different colours never
// end up on the same colour that way, which would merge their processes.
import type { Point } from '../lines/geometry.ts';
import type { RenderResult } from '../result.ts';
import { fmt } from '../svg/format.ts';
import { type ExportOptions, flatten, parsePath } from './paths.ts';

type Rgb = [number, number, number];

// AutoCAD's colour index. 1 to 9 are named colours, 10 to 249 go round the
// hues in 10 shades each, and 250 to 255 are greys. 7 prints black on paper,
// so black matches it.
const ACI: Rgb[] = (() => {
  const table: Rgb[] = [[0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [0, 0, 0], [128, 128, 128], [192, 192, 192]];
  const levels = [1, 0.8, 0.6, 0.5, 0.3];
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15;
    const shade = (i - 10) % 10;
    const v = levels[Math.floor(shade / 2)];
    const s = shade % 2 ? 0.5 : 1;
    const f = (n: number) => {
      const k = (n + hue / 60) % 6;
      return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    table.push([f(5), f(3), f(1)]);
  }
  for (const g of [51, 91, 132, 173, 214, 255]) table.push([g, g, g]);
  return table;
})();

const rgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** An indexed colour for each hex colour, the nearest one not already taken. */
export function aciColours(colours: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const hex of colours) {
    const key = hex.toUpperCase();
    if (out.has(key)) continue;
    const [r, g, b] = /^#[0-9A-F]{6}$/.test(key) ? rgb(key) : [0, 0, 0];
    let best = 7;
    let bestD = Infinity;
    for (let i = 1; i <= 255; i++) {
      if (taken.has(i)) continue;
      const [cr, cg, cb] = ACI[i];
      // Weighted for how the eye sees it.
      const d = 2 * (r - cr) ** 2 + 4 * (g - cg) ** 2 + 3 * (b - cb) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    taken.add(best);
    out.set(key, best);
  }
  return out;
}

// Letters, digits, $, - and _ only, at most 31 of them, for R12.
function layerName(label: string, used: Set<string>): string {
  const base = label.toUpperCase().replace(/[^A-Z0-9$_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'LAYER';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
  used.add(name);
  return name;
}

export function toDxf(result: RenderResult, options: ExportOptions = {}): string {
  const { width, height } = result;
  const place = ([x, y]: Point): Point => [options.mirror ? width - x : x, height - y];
  const colours = aciColours(result.groups.map((g) => g.color));
  const used = new Set<string>();
  const layers = result.groups.map((g) => ({ group: g, name: layerName(g.label, used), colour: colours.get(g.color.toUpperCase()) ?? 7 }));

  const out: string[] = [];
  const pair = (code: number, value: string | number) => out.push(String(code), String(value));
  const xy = (p: Point, codeX = 10) => {
    pair(codeX, fmt(p[0]));
    pair(codeX + 10, fmt(p[1]));
    pair(codeX + 20, 0);
  };

  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1009');
  // Millimetres. Newer readers use it, R12 ones ignore it.
  pair(9, '$INSUNITS');
  pair(70, 4);
  pair(9, '$EXTMIN');
  xy([0, 0]);
  pair(9, '$EXTMAX');
  xy([width, height]);
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'TABLES');
  pair(0, 'TABLE');
  pair(2, 'LTYPE');
  pair(70, 1);
  pair(0, 'LTYPE');
  pair(2, 'CONTINUOUS');
  pair(70, 0);
  pair(3, 'Solid line');
  pair(72, 65);
  pair(73, 0);
  pair(40, 0);
  pair(0, 'ENDTAB');
  pair(0, 'TABLE');
  pair(2, 'LAYER');
  pair(70, layers.length);
  for (const layer of layers) {
    pair(0, 'LAYER');
    pair(2, layer.name);
    pair(70, 0);
    pair(62, layer.colour);
    pair(6, 'CONTINUOUS');
  }
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'ENTITIES');
  for (const { group, name } of layers) {
    for (const path of group.paths) {
      for (const sub of parsePath(path.d)) {
        const points = flatten(sub).map(place);
        if (points.length < 2) continue;
        if (points.length === 2 && !sub.closed) {
          pair(0, 'LINE');
          pair(8, name);
          xy(points[0]);
          xy(points[1], 11);
          continue;
        }
        // A closed polyline repeats no point: the flag closes it.
        const ring = sub.closed ? points.slice(0, -1) : points;
        pair(0, 'POLYLINE');
        pair(8, name);
        pair(66, 1);
        xy([0, 0]);
        pair(70, sub.closed ? 1 : 0);
        for (const p of ring) {
          pair(0, 'VERTEX');
          pair(8, name);
          xy(p);
        }
        pair(0, 'SEQEND');
        pair(8, name);
      }
    }
  }
  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return out.join('\n') + '\n';
}
