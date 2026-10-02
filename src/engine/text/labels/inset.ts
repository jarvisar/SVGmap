// The title set into the border, which breaks around it. A subtitle goes in
// the border on the other side. On a round piece the text follows the curve.
// Text that is too big for the border runs into the map, and the map makes
// room for it.
import type { Path, Point } from '../../lines/geometry.ts';
import type { Layout } from '../../layout/layout.ts';
import { shapeCentre } from '../../layout/shapes.ts';
import type { TextGeometry } from '../outline.ts';
import type { LabelSettings } from '../label.ts';
import {
  type LabelArtwork,
  LabelError,
  NO_TEXT,
  artwork,
  availableWidthAt,
  bendText,
  boundsOf,
  diamond,
  mergeGeometry,
  moved,
  rect,
  rotate,
  scaled,
  sized,
} from './common.ts';

// Longest the text can run around a round piece.
const MAX_SWEEP = (Math.PI * 5) / 6;

export function layoutInsetLabel(layout: Layout, s: LabelSettings, title: TextGeometry, subtitle: TextGeometry | null): LabelArtwork {
  const { artwork: art, window: win } = layout;
  const k = s.size / 100;
  const round = art.kind === 'circle';
  const [cx, cy] = shapeCentre(art);
  let lettering: TextGeometry = NO_TEXT;
  const clear: Path[] = [];
  const breaks: Path[] = [];
  const solid: Path[] = [];
  const boxes: Path[] = [];

  const put = (g: TextGeometry, height: number, atTop: boolean) => {
    const row = sized(g, height);
    // Between the edge of the artwork and the map.
    const zone = round ? art.r - win.r : atTop ? win.y - art.y : art.y + art.h - (win.y + win.h);
    let h = row.h;
    let w = row.w;
    const pad = h * 0.18;
    // Centred in the border when it fits, otherwise against the outer edge.
    const fromOuter = () => (h + 2 * pad <= zone ? (zone - h) / 2 : pad);
    const space = () => h * 0.7;
    const dot = () => Math.max(0.6, h * 0.22);

    if (round) {
      let mid = art.r - fromOuter() - h / 2;
      if (w / mid > MAX_SWEEP) {
        h *= (MAX_SWEEP * mid) / w;
        w = MAX_SWEEP * mid;
        mid = art.r - fromOuter() - h / 2;
      }
      lettering = mergeGeometry(lettering, bendText(scaled(row.g, h / row.h), w, h, cx, cy, mid, atTop));
      const centre = atTop ? -Math.PI / 2 : Math.PI / 2;
      const half = (w / 2 + space()) / mid;
      const arc = (r: number, from: number, to: number) => {
        const n = Math.max(8, Math.ceil(((to - from) * r) / 0.3));
        return Array.from({ length: n + 1 }, (_, i): Point => [cx + r * Math.cos(from + ((to - from) * i) / n), cy + r * Math.sin(from + ((to - from) * i) / n)]);
      };
      // A wedge from the centre, convex while it spans less than half the circle.
      breaks.push([[cx, cy], ...arc(art.r + 1, centre - half, centre + half)]);
      boxes.push([...arc(mid + h / 2, centre - half, centre + half), ...arc(mid - h / 2, centre - half, centre + half).reverse()]);
      if (layout.thinLine) {
        for (const a of [centre - half, centre + half]) {
          const r = layout.thinLine.r;
          const p: Point = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
          solid.push(diamond(p[0], p[1], dot(), dot()).map((q) => rotate(q, p, (a * 180) / Math.PI)));
        }
      }
      const inner = mid - h / 2 - pad;
      if (inner < win.r) clear.push([...arc(win.r, centre - half, centre + half), ...arc(inner, centre - half, centre + half).reverse()]);
      return;
    }

    const outer = atTop ? art.y : art.y + art.h;
    const edge = atTop ? win.y : win.y + win.h;
    let y = 0;
    for (let pass = 0; pass < 3; pass++) {
      y = atTop ? outer + fromOuter() : outer - fromOuter() - h;
      const [a, b] = availableWidthAt(art, y, y + h);
      const room = b - a - 2 * h;
      if (room <= 0) throw new LabelError('There is no room for the title in the border here.');
      if (w > room) {
        h *= room / w;
        w = room;
      }
    }
    const x = cx - w / 2;
    lettering = mergeGeometry(lettering, moved(scaled(row.g, h / row.h), x, y));
    breaks.push(rect(x - space(), Math.min(outer, edge) - 1, w + 2 * space(), zone + 2));
    boxes.push(rect(x - space(), y, w + 2 * space(), h));
    // Small diamonds where the thin line stops.
    if (layout.thinLine) {
      const lineY = atTop ? layout.thinLine.y : layout.thinLine.y + layout.thinLine.h;
      solid.push(diamond(x - space(), lineY, dot(), dot()), diamond(x + w + space(), lineY, dot(), dot()));
    }
    const intoMap = atTop ? y + h + pad - edge : edge - (y - pad);
    if (intoMap > 0) clear.push(rect(x - space(), atTop ? edge : y - pad, w + 2 * space(), intoMap));
  };

  const atTop = s.bandPosition === 'top';
  const height = s.textHeight * k * 0.62;
  put(title, height, atTop);
  if (subtitle) put(subtitle, height * 0.6, !atTop);

  return artwork({
    // Only the title's, so fitting a route doesn't steer around the subtitle too.
    knockout: boundsOf([boxes[0]]),
    clear,
    text: lettering,
    solid,
    borderBreaks: breaks,
  });
}
