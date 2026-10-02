// One line in a bordered box in a corner or centred at the top or bottom.
import type { Path } from '../../lines/geometry.ts';
import { insetShape } from '../../layout/shapes.ts';
import type { Layout } from '../../layout/layout.ts';
import { type TextGeometry, geometryBounds } from '../outline.ts';
import type { LabelSettings } from '../label.ts';
import { type LabelArtwork, LabelError, artwork, fitScale, place, placeBlock, rect } from './common.ts';

export function layoutBoxLabel(layout: Layout, s: LabelSettings, text: TextGeometry): LabelArtwork {
  const bounds = geometryBounds(text);
  if (!bounds) throw new LabelError('The title font has no visible letters for this text.');
  const [minX, minY, maxX, maxY] = bounds;
  const rawW = maxX - minX;
  const rawH = maxY - minY;
  const k = s.size / 100;
  const textHeight = s.textHeight * k;
  const maxWidth = s.maxWidth * k;
  const padX = s.paddingX * k;
  const padY = s.paddingY * k;
  let border = s.boxBorder && !s.solid ? s.borderWidth * k : 0;

  // boxScale is the room for the text inside the padding, and the text takes
  // textScale of it. A resized side is set, and the text shrinks to fit it,
  // or with autofit grows to fill it. A side that wasn't resized follows the
  // text.
  const setW = s.boxWidth > 0 ? s.boxWidth * k : 0;
  const setH = s.boxHeight > 0 ? s.boxHeight * k : 0;
  const room = Math.min(setW ? (setW - 2 * (padX + border)) / rawW : Infinity, setH ? (setH - 2 * (padY + border)) / rawH : Infinity);
  if (!(room > 0)) throw new LabelError('The title box is too small for its padding. Make it bigger or reduce the padding.');
  const natural = Math.min(textHeight / rawH, maxWidth / rawW);
  let boxScale = s.autofit && Number.isFinite(room) ? room : Math.min(natural, room);
  let boxW = setW || rawW * boxScale + 2 * (padX + border);
  let boxH = setH || rawH * boxScale + 2 * (padY + border);
  const rotation = ((s.rotation % 360) + 360) % 360;
  if (rotation === 90 || rotation === 270) [boxW, boxH] = [boxH, boxW];

  const limit = insetShape(layout.labelAnchor, s.gap);
  // Too big for the piece: shrink the whole box, padding and all, until it fits.
  const scale = fitScale(limit, (f) => [boxW * f, boxH * f]);
  if (scale < 0.02) throw new LabelError('The title does not fit inside the border. Make the border smaller or the piece bigger.');
  boxW *= scale;
  boxH *= scale;
  boxScale *= scale;
  border *= scale;
  const placed = placeBlock(limit, layout.labelAnchor, s, boxW, boxH);
  if (!placed) throw new LabelError('The title does not fit inside the border. Make the border smaller or the piece bigger.');
  const [left, top] = placed.at;

  const textScale = boxScale * s.textScale;
  const textW = rawW * textScale;
  const textH = rawH * textScale;
  const cx = left + boxW / 2;
  const cy = top + boxH / 2;
  const cos = Math.round(Math.cos((rotation * Math.PI) / 180));
  const sin = Math.round(Math.sin((rotation * Math.PI) / 180));
  const lettering = place(text, ([x, y]) => {
    const ox = (x - minX) * textScale - textW / 2;
    const oy = (y - minY) * textScale - textH / 2;
    return [cx + ox * cos - oy * sin, cy + ox * sin + oy * cos];
  });
  const x2 = left + boxW;
  const y2 = top + boxH;
  // Four open segments instead of a closed path. Some laser software treats a
  // closed path as a shape to fill.
  const frame: Path[] = border
    ? [
        [
          [left, top],
          [x2, top],
        ],
        [
          [x2, top],
          [x2, y2],
        ],
        [
          [x2, y2],
          [left, y2],
        ],
        [
          [left, y2],
          [left, top],
        ],
      ]
    : [];
  const box = rect(left, top, boxW, boxH);
  return artwork({
    knockout: [left, top, boxW, boxH],
    clear: [box],
    text: lettering,
    solid: s.solid ? [box] : [],
    reversed: s.solid,
    frame,
    frameWidth: border,
    frameLabel: 'Title box',
    offset: placed.offset,
    scale,
  });
}
