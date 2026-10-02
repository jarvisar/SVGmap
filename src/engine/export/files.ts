// Files made from a render, beyond the one SVG: a mirrored copy, one SVG per
// layer or pen, and their names.
import type { OutputGroup, RenderResult } from '../result.ts';
import { toSvg } from '../svg/writer.ts';
import { mirrorPath } from './paths.ts';

/** Lower case, accents dropped, anything else a dash. */
export function slug(text: string, fallback = 'map'): string {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

/** The render flipped left to right, for engraving the back of clear acrylic or glass. */
export function mirrorResult(result: RenderResult): RenderResult {
  const flip = (d: string) => mirrorPath(d, result.width);
  return {
    ...result,
    outline: flip(result.outline),
    groups: result.groups.map((g) => ({ ...g, paths: g.paths.map((p) => ({ ...p, d: flip(p.d) })) })),
  };
}

/**
 * One SVG per layer, or per pen for a plotter, each the size of the whole
 * piece so they line up. Numbered in drawing order. A print's background is
 * a file of its own.
 */
export function layerFiles(result: RenderResult): { name: string; svg: string }[] {
  const sets: { name: string; groups: OutputGroup[] }[] = [];
  if (result.mode === 'plotter') {
    for (const g of result.groups) {
      const pen = sets.find((s) => s.groups[0].color === g.color);
      if (pen) pen.groups.push(g);
      else sets.push({ name: `pen-${g.color.slice(1).toLowerCase()}`, groups: [g] });
    }
  } else {
    for (const g of result.groups) sets.push({ name: slug(g.label, g.id), groups: [g] });
  }
  const width = String(sets.length + 1).length;
  const files = sets.map((set, i) => ({
    name: `${String(i + 1).padStart(width, '0')}-${set.name}.svg`,
    svg: toSvg({ ...result, groups: set.groups, background: null }),
  }));
  if (result.background) files.unshift({ name: `${'0'.repeat(width)}-background.svg`, svg: toSvg({ ...result, groups: [] }) });
  return files;
}
