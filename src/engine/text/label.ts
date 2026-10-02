// Title settings and the styles that lay it out. Each style is in labels/.
// Box is the original plaque's title. Whatever the style, the map under the
// title is removed, and text only ever scales uniformly to fit.
import type { Layout } from '../layout/layout.ts';
import { layoutBadgeLabel } from './labels/badge.ts';
import { layoutBandLabel } from './labels/band.ts';
import { layoutBoxLabel } from './labels/box.ts';
import { type CornerPosition, type LabelArtwork, LabelError, type MapInfo } from './labels/common.ts';
import { layoutInsetLabel } from './labels/inset.ts';
import { layoutLegendLabel } from './labels/legend.ts';
import { layoutLettersLabel } from './labels/letters.ts';
import { layoutRibbonLabel } from './labels/ribbon.ts';
import { type LoadedFont, type MissingGlyphs, geometryBounds, missingGlyphs, textGeometry } from './outline.ts';

export { LabelError, layoutBandLabel, layoutBoxLabel };
export type { LabelArtwork, MapInfo };

export type LabelStyle = 'box' | 'band' | 'ribbon' | 'badge' | 'letters' | 'inset' | 'legend';
export const LABEL_STYLES: LabelStyle[] = ['box', 'band', 'ribbon', 'badge', 'letters', 'inset', 'legend'];

export type LabelPosition = CornerPosition;

// The settings that pick one of a few options, for checking saved settings and links.
export const LABEL_CHOICES: Partial<Record<keyof LabelSettings, readonly string[]>> = {
  style: LABEL_STYLES,
  position: ['lower_right', 'lower_left', 'upper_right', 'upper_left', 'lower_center', 'upper_center', 'center'],
  bandPosition: ['bottom', 'top'],
  bandAlign: ['left', 'center', 'right'],
  badgeCentre: ['compass', 'map'],
  lettersMode: ['cutout', 'window'],
  lettersAlign: ['top', 'center', 'bottom'],
  legendUnits: ['metric', 'imperial'],
};

export interface LabelSettings {
  enabled: boolean;
  text: string;
  subtitle: string;
  style: LabelStyle;
  font: string;
  subtitleFont: string;
  // Percent. Scales the lettering, and for the box also the padding and outline.
  size: number;
  // Grow or shrink the text to fill a resized box, or the band. Off, text
  // keeps its size and only shrinks when there isn't room for it.
  autofit: boolean;
  // On top of each style's own letter spacing, so 1 keeps it.
  titleSpacing: number;
  subtitleSpacing: number;
  // Box, ribbon, badge and legend
  position: LabelPosition;
  gap: number;
  // Where it was dragged to from its position, as a share of the space
  // inside the border. 0 leaves it where the position puts it.
  offsetX: number;
  offsetY: number;
  // Engraves the box, ribbon or badge ring and leaves the letters bare.
  solid: boolean;
  // Box. The ribbon, legend and in-border title are sized from the text height too.
  rotation: 0 | 90 | 180 | 270;
  textHeight: number;
  maxWidth: number;
  textScale: number;
  paddingX: number;
  paddingY: number;
  borderWidth: number;
  boxBorder: boolean;
  // A box resized on screen, along the text and at 100% size. 0 sizes that
  // side to the text.
  boxWidth: number;
  boxHeight: number;
  // Band. The in-border title uses bandPosition too.
  bandPosition: 'bottom' | 'top';
  bandHeight: number;
  bandAlign: 'left' | 'center' | 'right';
  titleHeight: number;
  bandMaxWidth: number;
  bandPaddingX: number;
  bandPaddingY: number;
  subtitleHeight: number;
  subtitleGap: number;
  divider: boolean;
  dividerWidth: number;
  dividerInset: number;
  ornament: boolean;
  // The band's text dragged from where it's aligned, as a share of the band.
  bandOffsetX: number;
  bandOffsetY: number;
  // Ribbon. Percent, 0 is straight.
  ribbonArch: number;
  // Badge
  badgeDiameter: number;
  badgeCentre: 'compass' | 'map';
  // Big letters
  lettersMode: 'cutout' | 'window';
  lettersAlign: 'top' | 'center' | 'bottom';
  lettersGap: number;
  // Legend
  legendUnits: 'metric' | 'imperial';
  legendScale: boolean;
  legendNorth: boolean;
}

export const DEFAULT_LABEL: LabelSettings = {
  enabled: true,
  text: 'CHICAGO',
  subtitle: '',
  style: 'box',
  font: 'montserrat',
  subtitleFont: '',
  size: 100,
  autofit: false,
  titleSpacing: 1,
  subtitleSpacing: 1,
  position: 'lower_right',
  gap: 1.0,
  offsetX: 0,
  offsetY: 0,
  solid: false,
  rotation: 0,
  // 85% of the original plaque's title, which came out too big.
  textHeight: 6.6096,
  maxWidth: 66.096,
  textScale: 0.95,
  paddingX: 1.683,
  paddingY: 1.3158,
  borderWidth: 0.2125,
  boxBorder: true,
  boxWidth: 0,
  boxHeight: 0,
  bandPosition: 'bottom',
  bandHeight: 20,
  bandAlign: 'center',
  titleHeight: 7,
  bandMaxWidth: 90,
  bandPaddingX: 3,
  bandPaddingY: 2,
  subtitleHeight: 2,
  subtitleGap: 2,
  divider: true,
  dividerWidth: 0.25,
  dividerInset: 0,
  ornament: true,
  bandOffsetX: 0,
  bandOffsetY: 0,
  ribbonArch: 35,
  badgeDiameter: 34,
  badgeCentre: 'compass',
  lettersMode: 'cutout',
  lettersAlign: 'center',
  lettersGap: 1.2,
  legendUnits: 'metric',
  legendScale: true,
  legendNorth: true,
};

// Each style's own letter spacing for the title and subtitle. Posters space
// out their capitals, a box or big letters look better tight.
const SPACING: Record<LabelStyle, [number, number]> = {
  box: [1, 1],
  band: [1.25, 1.6],
  ribbon: [1.1, 1],
  badge: [1.15, 1.35],
  letters: [1, 1],
  inset: [1.3, 1.5],
  legend: [1.05, 1.2],
};

// Styles that draw the subtitle.
export const SUBTITLED: LabelStyle[] = ['band', 'badge', 'inset', 'legend'];

// Whether the title needs its subtitle font: for a subtitle it shows, or the
// badge's N and the legend's numbers, which are lettered in it.
export function usesSubtitleFont(s: LabelSettings): boolean {
  if (SUBTITLED.includes(s.style) && s.subtitle.trim() !== '') return true;
  if (s.style === 'badge') return s.badgeCentre === 'compass';
  if (s.style === 'legend') return s.legendScale || s.legendNorth;
  return false;
}

// artwork is null when the title is off or doesn't fit, and error says why.
// warnings are for letters that aren't drawn as typed. map is only needed for
// the scale bar and the north arrows, which fall back to 1:10,000 and north
// up without it.
export function buildLabel(
  layout: Layout,
  s: LabelSettings,
  title: LoadedFont | null,
  subtitle: LoadedFont | null,
  map: MapInfo | null = null,
): { artwork: LabelArtwork | null; error: string | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!s.enabled || !s.text.trim() || !title) return { artwork: null, error: null, warnings };
  const style: LabelStyle = LABEL_STYLES.includes(s.style) ? s.style : 'box';
  const [titleSpacing, subtitleSpacing] = SPACING[style];
  const small = subtitle ?? title;
  const lettering = (font: LoadedFont, text: string, spacing: number, what: string) => {
    const geometry = textGeometry(font, text, spacing);
    if (geometry.unshaped) warnings.push(`The ${what} font's ligatures and letter joining couldn't be used, so the ${what} is drawn a letter at a time.`);
    const missing = missingGlyphs(text, font);
    if (missing) warnings.push(glyphWarning(what, missing));
    return geometry;
  };
  const done = (artwork: LabelArtwork) => ({ artwork, error: null, warnings });
  try {
    const main = lettering(title, s.text.trim(), titleSpacing * s.titleSpacing, 'title');
    const typed = SUBTITLED.includes(style) && s.subtitle.trim() ? lettering(small, s.subtitle.trim(), subtitleSpacing * s.subtitleSpacing, 'subtitle') : null;
    // Left out when there's nothing to size, like a single-line font's flat
    // hyphen or a zero-width space, which trim() keeps.
    const sub = typed && geometryBounds(typed) ? typed : null;
    switch (style) {
      case 'band':
        return done(layoutBandLabel(layout, s, main, sub));
      case 'ribbon':
        return done(layoutRibbonLabel(layout, s, main));
      case 'badge':
        return done(layoutBadgeLabel(layout, s, main, sub, textGeometry(small, 'N'), map));
      case 'letters':
        return done(layoutLettersLabel(layout, s, main));
      case 'inset':
        return done(layoutInsetLabel(layout, s, main, sub));
      case 'legend':
        return done(layoutLegendLabel(layout, s, main, sub, (text) => textGeometry(small, text, 1.05), map));
      default:
        return done(layoutBoxLabel(layout, s, main));
    }
  } catch (error) {
    if (error instanceof LabelError) return { artwork: null, error: error.message, warnings };
    // A font that can't lay the text out loses the title, not the whole map.
    return { artwork: null, error: `The title couldn't be drawn in this font. ${error instanceof Error ? error.message : ''}`.trim(), warnings };
  }
}

function glyphWarning(what: string, { chars, shownAs }: MissingGlyphs): string {
  const quoted = chars.map((c) => `“${c}”`);
  const list = quoted.length > 5 ? `${quoted.slice(0, 5).join(', ')} and ${quoted.length - 5} more` : quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}` : quoted[0];
  const one = chars.length === 1;
  const shown =
    shownAs === 'box' ? (one ? "it's drawn as a box" : "they're drawn as boxes") : shownAs === 'question' ? (one ? "it's drawn as a question mark" : "they're drawn as question marks") : one ? "it's left out" : "they're left out";
  return `The ${what} font has no ${list}, so ${shown}.`;
}
