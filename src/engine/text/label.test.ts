import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BORDER, computeLayout } from '../layout/layout.ts';
import { PRODUCT_PRESETS } from '../presets.ts';
import { type HersheyFile, parseHershey } from './hershey.ts';
import { DEFAULT_LABEL, LABEL_STYLES, LabelError, type LabelStyle, buildLabel, layoutBoxLabel } from './label.ts';
import { parseOutlineFont } from './loadFont.ts';
import { geometryBounds, textGeometry } from './outline.ts';

const hershey = { kind: 'stroke' as const, font: parseHershey(JSON.parse(readFileSync('public/fonts/hershey/futural.json', 'utf8')) as HersheyFile) };
const bytes = readFileSync('public/fonts/Montserrat-SemiBold.ttf');
const montserrat = parseOutlineFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const plaque = computeLayout(PRODUCT_PRESETS[0].product, DEFAULT_BORDER);

const inside = (outer: [number, number, number, number], p: [number, number]) =>
  p[0] >= outer[0] - 1e-9 && p[0] <= outer[0] + outer[2] + 1e-9 && p[1] >= outer[1] - 1e-9 && p[1] <= outer[1] + outer[3] + 1e-9;

describe('text geometry', () => {
  it('outlines a word with an outline font', () => {
    const g = textGeometry(montserrat, 'CHICAGO');
    expect(g.rings.length).toBeGreaterThan(7);
    expect(g.strokes).toHaveLength(0);
  });

  it('draws a word as strokes with a single-line font', () => {
    const g = textGeometry(hershey, 'ROME');
    expect(g.rings).toHaveLength(0);
    expect(g.strokes.length).toBeGreaterThan(4);
  });

  it('spreads letters apart with letter spacing', () => {
    const tight = geometryBounds(textGeometry(montserrat, 'ROME', 1))!;
    const wide = geometryBounds(textGeometry(montserrat, 'ROME', 1.5))!;
    expect(wide[2] - wide[0]).toBeGreaterThan((tight[2] - tight[0]) * 1.2);
  });
});

describe('title layout', () => {
  it('puts the box in the lower right corner, inside the border', () => {
    const artwork = layoutBoxLabel(plaque, DEFAULT_LABEL, textGeometry(montserrat, 'CHICAGO'))!;
    const [x, y, w, h] = artwork.knockout;
    const a = plaque.labelAnchor;
    expect(x + w).toBeCloseTo(a.x + a.w - DEFAULT_LABEL.gap, 9);
    expect(y + h).toBeCloseTo(a.y + a.h - DEFAULT_LABEL.gap, 9);
    for (const ring of artwork.text.rings) for (const p of ring) expect(inside(artwork.knockout, p)).toBe(true);
  });

  it('keeps the reference text height', () => {
    const artwork = layoutBoxLabel(plaque, DEFAULT_LABEL, textGeometry(montserrat, 'CHICAGO'))!;
    const b = geometryBounds(artwork.text)!;
    expect(b[3] - b[1]).toBeCloseTo(DEFAULT_LABEL.textHeight * DEFAULT_LABEL.textScale, 6);
  });

  it('turns the box with the text', () => {
    const upright = layoutBoxLabel(plaque, DEFAULT_LABEL, textGeometry(montserrat, 'CHICAGO'));
    const turned = layoutBoxLabel(plaque, { ...DEFAULT_LABEL, rotation: 90 }, textGeometry(montserrat, 'CHICAGO'));
    expect(turned.knockout[2]).toBeCloseTo(upright.knockout[3], 9);
    expect(turned.knockout[3]).toBeCloseTo(upright.knockout[2], 9);
  });

  it('refuses a title too big for the piece', () => {
    expect(() => layoutBoxLabel(plaque, { ...DEFAULT_LABEL, size: 1000 }, textGeometry(montserrat, 'CHICAGO'))).toThrow(LabelError);
  });

  it('fits a title band with a subtitle at the bottom', () => {
    const s = { ...DEFAULT_LABEL, style: 'band' as const, subtitle: 'ILLINOIS', ornament: false };
    const { artwork } = buildLabel(plaque, s, montserrat, montserrat);
    const [, y, , h] = artwork!.knockout;
    const band = (plaque.bandAnchor.h * s.bandHeight) / 100;
    expect(y + h).toBeCloseTo(plaque.bandAnchor.y + plaque.bandAnchor.h, 9);
    // The map stops the border's inner gap short of the divider, like on the other sides.
    expect(h).toBeCloseTo(band + plaque.innerGap, 9);
    expect(artwork!.frame).toHaveLength(1);
    expect(artwork!.frame[0][0][1]).toBeCloseTo(y + plaque.innerGap, 9);
  });

  it('puts a rule and a diamond under a band title', () => {
    const { artwork } = buildLabel(plaque, { ...DEFAULT_LABEL, style: 'band' }, montserrat, montserrat);
    expect(artwork!.frame).toHaveLength(3);
    expect(artwork!.solid).toHaveLength(1);
  });

  it('reports a problem instead of throwing', () => {
    const { artwork, error } = buildLabel(plaque, { ...DEFAULT_LABEL, size: 1000 }, montserrat, montserrat);
    expect(artwork).toBeNull();
    expect(error).toMatch(/does not fit/);
  });
});

describe('title styles', () => {
  const coaster = computeLayout(PRODUCT_PRESETS.find((p) => p.id === 'coaster-100')!.product, { ...DEFAULT_BORDER, style: 'single' });
  const map = { metresPerMm: 20, bearing: 0 };

  it('lays out every style on every product with outline and single-line fonts', () => {
    const problems: string[] = [];
    for (const preset of PRODUCT_PRESETS) {
      const layout = computeLayout(preset.product, { ...DEFAULT_BORDER, style: preset.border });
      for (const style of LABEL_STYLES) {
        for (const font of [montserrat, hershey]) {
          const s = { ...DEFAULT_LABEL, style, subtitle: '41.88° N 87.63° W', position: 'center' as const };
          const { artwork, error } = buildLabel(layout, s, font, font, map);
          if (!artwork) {
            problems.push(`${preset.id} ${style} ${font.kind}: ${error}`);
            continue;
          }
          const b = geometryBounds(artwork.text);
          const c = layout.canvas;
          if (b && (b[0] < c.x || b[1] < c.y || b[2] > c.x + c.w || b[3] > c.y + c.h)) problems.push(`${preset.id} ${style} ${font.kind}: off the piece`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('turns the badge compass to true north', () => {
    const s = { ...DEFAULT_LABEL, style: 'badge' as const };
    const northUp = buildLabel(plaque, s, montserrat, montserrat, map).artwork!;
    const eastUp = buildLabel(plaque, s, montserrat, montserrat, { ...map, bearing: 90 }).artwork!;
    // The first engraved half is the north point. With east up it points left.
    const tip = (a: typeof northUp) => {
      const [centre, point] = a.solid[0];
      return [point[0] - centre[0], point[1] - centre[1]];
    };
    expect(tip(northUp)[1]).toBeLessThan(0);
    expect(Math.abs(tip(northUp)[0])).toBeLessThan(1e-9);
    expect(tip(eastUp)[0]).toBeLessThan(0);
    expect(Math.abs(tip(eastUp)[1])).toBeLessThan(1e-9);
  });

  it('only shows the map through the badge when asked', () => {
    const s = { ...DEFAULT_LABEL, style: 'badge' as const };
    expect(buildLabel(plaque, s, montserrat, montserrat).artwork!.clear).toHaveLength(1);
    expect(buildLabel(plaque, { ...s, badgeCentre: 'map' }, montserrat, montserrat).artwork!.clear).toHaveLength(2);
  });

  it('gives the legend a round distance that fits the box', () => {
    const s = { ...DEFAULT_LABEL, style: 'legend' as const };
    for (const metresPerMm of [0.5, 3, 20, 140, 2000]) {
      const artwork = buildLabel(plaque, s, montserrat, montserrat, { metresPerMm, bearing: 0 }).artwork!;
      // The scale blocks are the solid rectangles, two of the bar's four quarters.
      const block = artwork.solid[0];
      const metres = (block[1][0] - block[0][0]) * 4 * metresPerMm;
      const digits = metres / 10 ** Math.floor(Math.log10(metres));
      expect([1, 2, 2.5, 5].some((d) => Math.abs(d - digits) < 1e-6)).toBe(true);
      const [x, , w] = artwork.knockout;
      expect(block[0][0] + metres / metresPerMm).toBeLessThan(x + w);
    }
  });

  it('needs an outline font to show the map inside the letters', () => {
    const s = { ...DEFAULT_LABEL, style: 'letters' as const, lettersMode: 'window' as const };
    expect(buildLabel(plaque, s, montserrat, montserrat).artwork!.keep!.length).toBeGreaterThan(5);
    expect(buildLabel(plaque, s, hershey, hershey).error).toMatch(/outline font/);
  });

  it('breaks the border around an in-border title, following a round piece', () => {
    const s = { ...DEFAULT_LABEL, style: 'inset' as const, subtitle: 'ILLINOIS' };
    const flat = buildLabel(plaque, s, montserrat, montserrat).artwork!;
    expect(flat.borderBreaks).toHaveLength(2);
    const round = buildLabel(coaster, s, montserrat, montserrat).artwork!;
    expect(round.borderBreaks).toHaveLength(2);
    // Bent along the circle, so the letters' tops and bottoms aren't level.
    const b = geometryBounds(round.text)!;
    expect(b[3] - b[1]).toBeGreaterThan(s.textHeight * 0.62 * 1.5);
  });

  it('falls back to a box for a style it does not know', () => {
    const s = { ...DEFAULT_LABEL, style: 'scroll' as unknown as LabelStyle };
    expect(buildLabel(plaque, s, montserrat, montserrat).artwork!.frameLabel).toBe('Title box');
  });
});
