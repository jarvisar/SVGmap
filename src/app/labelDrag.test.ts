import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BORDER, computeLayout } from '../engine/layout/layout.ts';
import { PRODUCT_PRESETS } from '../engine/presets.ts';
import { DEFAULT_LABEL, type LabelSettings, buildLabel } from '../engine/text/label.ts';
import { parseOutlineFont } from '../engine/text/loadFont.ts';
import { type TitleGrip, dragTitle, droppedLabel, handleAt, resizeCursor, spacedHandles, titleAt, titleHandles } from './labelDrag.ts';

const bytes = readFileSync('public/fonts/Montserrat-SemiBold.ttf');
const font = parseOutlineFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const plaque = computeLayout(PRODUCT_PRESETS[0].product, DEFAULT_BORDER);
const map = { metresPerMm: 20, bearing: 0 };
const lay = (label: LabelSettings) => buildLabel(plaque, label, font, font, map).artwork;

function drag(label: LabelSettings, grip: TitleGrip, dx: number, dy: number) {
  const artwork = lay(label)!;
  const next = dragTitle(plaque, { grip, label, artwork }, dx, dy, lay);
  const after = lay(next)!;
  return { before: artwork.knockout, after: after.knockout, next, stored: droppedLabel(next, after) };
}

describe('moving the title', () => {
  it('moves a box by the drag and stores where it ended up', () => {
    const { before, after, stored } = drag(DEFAULT_LABEL, 'move', -20, -10);
    expect(after[0]).toBeCloseTo(before[0] - 20, 6);
    expect(after[1]).toBeCloseTo(before[1] - 10, 6);
    expect(lay(stored)!.knockout[0]).toBeCloseTo(after[0], 3);
  });

  it('only lets go of a drag back to the start as not moved', () => {
    const { stored } = drag(DEFAULT_LABEL, 'move', 0.001, 0);
    expect([stored.offsetX, stored.offsetY]).toEqual([0, 0]);
  });

  it('moves band text with the band offsets', () => {
    const band = { ...DEFAULT_LABEL, style: 'band' as const };
    const { next } = drag(band, 'move', -15, 0);
    expect(next.bandOffsetX).toBeLessThan(0);
    expect(next.offsetX).toBe(0);
  });

  it("can't grab big letters or a title in the border", () => {
    for (const style of ['letters', 'inset'] as const) {
      const label = { ...DEFAULT_LABEL, style };
      const artwork = lay(label)!;
      const [x, y, w, h] = artwork.knockout;
      expect(titleAt(label, artwork, x + w / 2, y + h / 2)).toBe(false);
      expect(titleHandles(plaque, label, artwork)).toEqual([]);
    }
  });
});

describe('resizing the title by its handles', () => {
  it('widens a box from its left side and keeps the right side put', () => {
    const { before, after, next } = drag(DEFAULT_LABEL, 'w', -10, 0);
    expect(after[2]).toBeCloseTo(before[2] + 10, 1);
    expect(after[0] + after[2]).toBeCloseTo(before[0] + before[2], 1);
    expect(next.boxWidth).toBeGreaterThan(0);
    expect(next.boxHeight).toBe(0);
  });

  it('makes a box taller from its top and keeps the bottom put', () => {
    const { before, after } = drag(DEFAULT_LABEL, 'n', 0, -6);
    expect(after[3]).toBeCloseTo(before[3] + 6, 1);
    expect(after[1] + after[3]).toBeCloseTo(before[1] + before[3], 6);
  });

  it('keeps a moved box where it was while it grows', () => {
    const moved = { ...DEFAULT_LABEL, offsetX: -0.3, offsetY: -0.3 };
    const { before, after, stored } = drag(moved, 'e', 12, 0);
    expect(after[0]).toBeCloseTo(before[0], 1);
    expect(after[2]).toBeCloseTo(before[2] + 12, 1);
    // What's stored lays out the same.
    expect(lay(stored)!.knockout[0]).toBeCloseTo(after[0], 1);
  });

  it('keeps a box flush with the bottom when a side squeezes its text', () => {
    const { before, after, next } = drag(DEFAULT_LABEL, 'w', 30, 0);
    expect(after[3]).toBeLessThan(before[3]);
    expect(after[1] + after[3]).toBeCloseTo(before[1] + before[3], 9);
    expect(next.offsetY).toBe(0);
  });

  it('scales the whole title from a corner', () => {
    const { before, after, next } = drag(DEFAULT_LABEL, 'nw', -20, -4);
    expect(next.size).toBeGreaterThan(DEFAULT_LABEL.size);
    expect(after[2] / before[2]).toBeCloseTo(next.size / DEFAULT_LABEL.size, 2);
    // The opposite corner stays in the lower right.
    expect(after[0] + after[2]).toBeCloseTo(before[0] + before[2], 6);
    expect(after[1] + after[3]).toBeCloseTo(before[1] + before[3], 6);
  });

  it('scales a ribbon, badge or legend from a corner and keeps the opposite one', () => {
    for (const style of ['ribbon', 'badge', 'legend'] as const) {
      const label = { ...DEFAULT_LABEL, style };
      expect(titleHandles(plaque, label, lay(label)!).map((h) => h.id)).toEqual(['nw', 'ne', 'se', 'sw']);
      const { before, after, next } = drag(label, 'nw', -12, -6);
      expect(next.size).toBeGreaterThan(label.size);
      expect(after[2]).toBeGreaterThan(before[2]);
      expect(after[0] + after[2]).toBeCloseTo(before[0] + before[2], 1);
      expect(after[1] + after[3]).toBeCloseTo(before[1] + before[3], 1);
    }
  });

  it('swaps the sides of a turned box', () => {
    const { next } = drag({ ...DEFAULT_LABEL, rotation: 90 }, 'n', 0, -10);
    expect(next.boxWidth).toBeGreaterThan(0);
    expect(next.boxHeight).toBe(0);
  });

  it('stops a box shrinking past its padding', () => {
    const { next } = drag(DEFAULT_LABEL, 'w', 500, 0);
    expect(lay(next)).not.toBeNull();
  });

  it('resizes a band from its divider', () => {
    const band = { ...DEFAULT_LABEL, style: 'band' as const };
    const artwork = lay(band)!;
    const edge = titleHandles(plaque, band, artwork).find((h) => h.id === 'band')!;
    // On the divider, not the edge of the knockout, which reaches past it to the map.
    expect(edge.y).toBeCloseTo(artwork.frame[artwork.frame.length - 1][0][1], 9);
    const { before, after, next } = drag(band, 'band', 0, -8);
    expect(after[3]).toBeCloseTo(before[3] + 8, 0);
    expect(next.bandHeight).toBeGreaterThan(band.bandHeight);
    // A drag of nothing keeps the height.
    expect(drag(band, 'band', 0, 0).next.bandHeight).toBe(band.bandHeight);
    const top = drag({ ...band, bandPosition: 'top' }, 'band', 0, -8);
    expect(top.next.bandHeight).toBeLessThan(band.bandHeight);
  });

  it('scales band text from its corners, unless autofit fills the band', () => {
    const band = { ...DEFAULT_LABEL, style: 'band' as const };
    expect(drag(band, 'text-se', -10, -2).next.size).toBeLessThan(band.size);
    expect(titleHandles(plaque, { ...band, autofit: true }, lay({ ...band, autofit: true })!).map((h) => h.id)).toEqual(['band']);
  });

  it('finds the handle under the pointer', () => {
    const handles = titleHandles(plaque, DEFAULT_LABEL, lay(DEFAULT_LABEL)!);
    const se = handles.find((h) => h.id === 'se')!;
    expect(handleAt(handles, se.x + 0.5, se.y - 0.5, 1)).toBe('se');
    expect(handleAt(handles, se.x + 5, se.y, 1)).toBeNull();
  });

  it('leaves out side handles crowding the corners of a small title', () => {
    const handles = titleHandles(plaque, DEFAULT_LABEL, lay(DEFAULT_LABEL)!);
    expect(spacedHandles(handles, (x, y) => [x * 10, y * 10], 18)).toHaveLength(8);
    // About 3 px a millimetre: the box is about 30 px tall, so its side handles go.
    const few = spacedHandles(handles, (x, y) => [x * 3, y * 3], 18).map((h) => h.id);
    expect(few).toEqual(['nw', 'ne', 'se', 'sw', 'n', 's']);
  });

  it('picks resize cursors by direction', () => {
    expect(resizeCursor(1, 0)).toBe('ew-resize');
    expect(resizeCursor(0, -1)).toBe('ns-resize');
    expect(resizeCursor(1, 1)).toBe('nwse-resize');
    expect(resizeCursor(-1, 1)).toBe('nesw-resize');
  });
});
