// Marks as engraved areas and strokes on the piece, and the space they clear
// in the map. Each mark keeps its own colour, so it can be its own process or
// pen, and is cut off at the edge of the map window like the rest of the map.
import type { Paths64 } from 'clipper2-ts';
import { SCALE, bufferLines, dilate, intersectWith, linesOutside, subtract, toPath64, unionAll } from '../fills.ts';
import { clipPolylineInside } from '../geo/clip.ts';
import type { MapTransform } from '../geo/transform.ts';
import { type Shape, shapePolygon } from '../layout/shapes.ts';
import { type Path, pathLength } from '../lines/geometry.ts';
import type { HatchSettings } from '../plotter.ts';
import { type LoadedFont, missingGlyphs } from '../text/outline.ts';
import { type MapMark, type MarkFill, hasText, layoutMark, markFont, markName, markPoint, markTextFill, placeMark } from './marks.ts';
import { MARK_SHAPES } from './shapes.ts';

export interface MarkPiece {
  id: string;
  label: string;
  color: string;
  fill: MarkFill;
  hatch: HatchSettings;
  area: Paths64;
  // Outline letters beside the shape when they're drawn differently from it.
  // Otherwise they're part of area.
  textFill: MarkFill;
  textArea: Paths64;
  // Single-line letters.
  strokes: Path[];
}

export interface DrawnMarks {
  pieces: MarkPiece[];
  // Left out of the map.
  clear: Paths64;
  warnings: string[];
}

/** The layer name in the file, like "Pin: Home". */
export function markLabel(mark: MapMark): string {
  const kind = mark.shape === 'none' ? 'Text' : MARK_SHAPES[mark.shape].name;
  return hasText(mark) ? `${kind}: ${markName(mark)}` : kind;
}

// strokeWidth is what single-line letters are drawn at. Letters cut out of a
// shape get at least 0.4 mm, so they still show once cut.
export function drawMarks(
  marks: readonly MapMark[],
  fonts: ReadonlyMap<string, LoadedFont>,
  titleFont: string,
  titleColor: string,
  transform: MapTransform,
  window: Shape,
  strokeWidth: number,
): DrawnMarks {
  const pieces: MarkPiece[] = [];
  const clear: Paths64 = [];
  const warnings: string[] = [];
  const windowPoly = shapePolygon(window);
  const windowClip = [toPath64(windowPoly)];
  for (const mark of marks) {
    const font = hasText(mark) ? (fonts.get(markFont(mark, titleFont)) ?? null) : null;
    const art = layoutMark(mark, font);
    if (art.empty) continue;
    const name = markName(mark);
    if (font) {
      const missing = missingGlyphs(mark.text, font);
      if (missing) warnings.push(`The font for “${name}” has no ${missing.chars.map((c) => `“${c}”`).join(' ')}.`);
    }
    const placed = placeMark(art, markPoint(mark, transform, window));
    const letters = unionAll(placed.text.rings.map(toPath64));
    const outer = unionAll([...placed.fill, ...placed.extra].map(toPath64));
    const shape = placed.holes.length ? unionAll([...subtract(unionAll(placed.fill.map(toPath64)), unionAll(placed.holes.map(toPath64))), ...unionAll(placed.extra.map(toPath64))]) : outer;
    let strokes = placed.text.strokes;
    const textFill = markTextFill(mark);
    let area: Paths64;
    let textArea: Paths64 = [];
    if (art.inside) {
      const cut = unionAll([...letters, ...bufferLines(strokes, Math.max(strokeWidth, 0.4) / 2, true)]);
      area = subtract(shape, cut);
      strokes = [];
    } else if (textFill !== mark.fill) {
      area = shape;
      textArea = intersectWith(letters, windowClip);
    } else {
      area = letters.length ? unionAll([...shape, ...letters]) : shape;
    }
    area = intersectWith(area, windowClip);
    strokes = strokes.flatMap((s) => clipPolylineInside(s, windowPoly));
    if (!area.length && !textArea.length && !strokes.length) {
      warnings.push(`“${name}” is outside the map. Move it or the map to show it.`);
      continue;
    }
    pieces.push({ id: mark.id, label: markLabel(mark), color: mark.color || titleColor, fill: mark.fill, hatch: mark.hatch, area, textFill, textArea, strokes });
    if (mark.clear) {
      const footprint = unionAll([...outer, ...letters, ...bufferLines(placed.text.strokes, Math.max(strokeWidth, 0.3) / 2, true)]);
      clear.push(...(mark.gap > 0 ? dilate(footprint, mark.gap) : footprint));
    }
  }
  return { pieces, clear: clear.length ? unionAll(clear) : [], warnings };
}

/**
 * Takes lines out of the space the marks clear. Only lines whose boxes reach
 * it go through Clipper, since marks are small and maps have a lot of lines.
 * Bits shorter than 0.2 mm left at its edge are dropped too.
 */
export function makeMarkClearer(clear: Paths64): (paths: Path[]) => Path[] {
  if (clear.length === 0) return (paths) => paths;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of clear) {
    for (const p of ring) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  [x0, y0, x1, y1] = [x0 / SCALE, y0 / SCALE, x1 / SCALE, y1 / SCALE];
  return (paths) => {
    const kept: Path[] = [];
    const touched: Path[] = [];
    for (const path of paths) {
      let px0 = Infinity;
      let py0 = Infinity;
      let px1 = -Infinity;
      let py1 = -Infinity;
      for (const [x, y] of path) {
        px0 = Math.min(px0, x);
        py0 = Math.min(py0, y);
        px1 = Math.max(px1, x);
        py1 = Math.max(py1, y);
      }
      (px1 >= x0 && px0 <= x1 && py1 >= y0 && py0 <= y1 ? touched : kept).push(path);
    }
    if (touched.length === 0) return paths;
    for (const piece of linesOutside(touched, clear)) if (pathLength(piece) >= 0.2) kept.push(piece);
    return kept;
  };
}
