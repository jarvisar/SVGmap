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
import { type LoadedFont, textGeometry } from './outline.ts';

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
  // On top of each style's own letter spacing, so 1 keeps it.
  titleSpacing: number;
  subtitleSpacing: number;
  // Box, ribbon, badge and legend
  position: LabelPosition;
  gap: number;
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
  titleSpacing: 1,
  subtitleSpacing: 1,
  position: 'lower_right',
  gap: 1.0,
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

// artwork is null when the title is off or doesn't fit, and error says why.
// map is only needed for the scale bar and the north arrows, which fall back
// to 1:10,000 and north up without it.
export function buildLabel(
  layout: Layout,
  s: LabelSettings,
  title: LoadedFont | null,
  subtitle: LoadedFont | null,
  map: MapInfo | null = null,
): { artwork: LabelArtwork | null; error: string | null } {
  if (!s.enabled || !s.text.trim() || !title) return { artwork: null, error: null };
  const style: LabelStyle = LABEL_STYLES.includes(s.style) ? s.style : 'box';
  const [titleSpacing, subtitleSpacing] = SPACING[style];
  const small = subtitle ?? title;
  try {
    const main = textGeometry(title, s.text.trim(), titleSpacing * s.titleSpacing);
    const sub = s.subtitle.trim() ? textGeometry(small, s.subtitle.trim(), subtitleSpacing * s.subtitleSpacing) : null;
    switch (style) {
      case 'band':
        return { artwork: layoutBandLabel(layout, s, main, sub), error: null };
      case 'ribbon':
        return { artwork: layoutRibbonLabel(layout, s, main), error: null };
      case 'badge':
        return { artwork: layoutBadgeLabel(layout, s, main, sub, textGeometry(small, 'N'), map), error: null };
      case 'letters':
        return { artwork: layoutLettersLabel(layout, s, main), error: null };
      case 'inset':
        return { artwork: layoutInsetLabel(layout, s, main, sub), error: null };
      case 'legend':
        return { artwork: layoutLegendLabel(layout, s, main, sub, (text) => textGeometry(small, text, 1.05), map), error: null };
      default:
        return { artwork: layoutBoxLabel(layout, s, main), error: null };
    }
  } catch (error) {
    if (error instanceof LabelError) return { artwork: null, error: error.message };
    throw error;
  }
}
