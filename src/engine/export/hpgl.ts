// HPGL for vinyl cutters and older pen plotters. 40 plotter units to the
// millimetre, with the origin at the bottom left. Each colour is a pen, in
// the order they first come up, and filled areas are their outlines.
import type { Point } from '../lines/geometry.ts';
import type { RenderResult } from '../result.ts';
import { type ExportOptions, flatten, parsePath } from './paths.ts';

const UNITS_PER_MM = 40;
// Some cutters only take so many points in one PD.
const POINTS_PER_PD = 64;

export function toHpgl(result: RenderResult, options: ExportOptions = {}): string {
  const { width, height } = result;
  const unit = ([x, y]: Point) => `${Math.round((options.mirror ? width - x : x) * UNITS_PER_MM)},${Math.round((height - y) * UNITS_PER_MM)}`;
  const pens = hpglPens(result);
  const out: string[] = ['IN;'];
  pens.forEach((color, i) => {
    out.push(`SP${i + 1};`);
    for (const group of result.groups) {
      if (group.color !== color) continue;
      for (const path of group.paths) {
        for (const sub of parsePath(path.d)) {
          const points = flatten(sub);
          if (points.length < 2) continue;
          out.push(`PU${unit(points[0])};`);
          for (let at = 1; at < points.length; at += POINTS_PER_PD) out.push(`PD${points.slice(at, at + POINTS_PER_PD).map(unit).join(',')};`);
        }
      }
    }
    out.push('PU;');
  });
  out.push('SP0;');
  return out.join('\n') + '\n';
}

/** The pens in the order the file uses them, for saying which is which. */
export function hpglPens(result: RenderResult): string[] {
  const pens: string[] = [];
  for (const g of result.groups) if (!pens.includes(g.color)) pens.push(g.color);
  return pens;
}
