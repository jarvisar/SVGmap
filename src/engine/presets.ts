import type { BorderStyle, ProductSettings } from './layout/layout.ts';
import type { LabelSettings } from './text/label.ts';

export interface ProductPreset {
  id: string;
  name: string;
  group: 'Plaques & frames' | 'Paper' | 'Coasters & squares';
  product: ProductSettings;
  border: BorderStyle;
  labelStyle: LabelSettings['style'];
}

const IN = 25.4;
// Frame lip of the original 5 x 7 plaque.
const plaqueMargins = { top: 3.75, right: 3.65, bottom: 3.75, left: 3.65 };
const uniform = (d: number) => ({ top: d, right: d, bottom: d, left: d });

export const PRODUCT_PRESETS: ProductPreset[] = [
  {
    id: 'plaque-5x7',
    name: '5 × 7 in plaque',
    group: 'Plaques & frames',
    product: { shape: 'rect', width: 7 * IN, height: 5 * IN, cornerRadius: 0, margins: plaqueMargins },
    border: 'double',
    labelStyle: 'box',
  },
  {
    id: 'plaque-4x6',
    name: '4 × 6 in plaque',
    group: 'Plaques & frames',
    product: { shape: 'rect', width: 6 * IN, height: 4 * IN, cornerRadius: 0, margins: plaqueMargins },
    border: 'double',
    labelStyle: 'box',
  },
  {
    id: 'plaque-8x10',
    name: '8 × 10 in plaque',
    group: 'Plaques & frames',
    product: { shape: 'rect', width: 10 * IN, height: 8 * IN, cornerRadius: 0, margins: plaqueMargins },
    border: 'double',
    labelStyle: 'box',
  },
  {
    id: 'a5',
    name: 'A5 (210 × 148 mm)',
    group: 'Paper',
    product: { shape: 'rect', width: 210, height: 148, cornerRadius: 0, margins: uniform(10) },
    border: 'single',
    labelStyle: 'band',
  },
  {
    id: 'a4',
    name: 'A4 (297 × 210 mm)',
    group: 'Paper',
    product: { shape: 'rect', width: 297, height: 210, cornerRadius: 0, margins: uniform(12) },
    border: 'single',
    labelStyle: 'band',
  },
  {
    id: 'a3',
    name: 'A3 (420 × 297 mm)',
    group: 'Paper',
    product: { shape: 'rect', width: 420, height: 297, cornerRadius: 0, margins: uniform(15) },
    border: 'single',
    labelStyle: 'band',
  },
  {
    id: 'letter',
    name: 'US Letter (11 × 8.5 in)',
    group: 'Paper',
    product: { shape: 'rect', width: 11 * IN, height: 8.5 * IN, cornerRadius: 0, margins: uniform(12) },
    border: 'single',
    labelStyle: 'band',
  },
  {
    id: 'square-150',
    name: 'Square tile, 150 mm',
    group: 'Coasters & squares',
    product: { shape: 'rounded', width: 150, height: 150, cornerRadius: 6, margins: uniform(3) },
    border: 'double',
    labelStyle: 'band',
  },
  {
    id: 'coaster-100',
    name: 'Round coaster, 100 mm',
    group: 'Coasters & squares',
    product: { shape: 'circle', width: 100, height: 100, cornerRadius: 0, margins: uniform(2) },
    border: 'single',
    labelStyle: 'band',
  },
  {
    id: 'coaster-sq-95',
    name: 'Square coaster, 95 mm',
    group: 'Coasters & squares',
    product: { shape: 'rounded', width: 95, height: 95, cornerRadius: 8, margins: uniform(2) },
    border: 'single',
    labelStyle: 'band',
  },
];

export interface PlacePreset {
  id: string;
  name: string;
  label: string;
  lon: number;
  lat: number;
  widthM: number;
}

// The Blender add-on's city presets plus a few more.
export const PLACE_PRESETS: PlacePreset[] = [
  { id: 'chicago', name: 'Chicago', label: 'CHICAGO', lon: -87.62601, lat: 41.882245, widthM: 3208 },
  { id: 'cincinnati', name: 'Cincinnati', label: 'CINCINNATI', lon: -84.51246, lat: 39.09773, widthM: 3208 },
  { id: 'clearwater', name: 'Clearwater', label: 'CLEARWATER', lon: -82.815285, lat: 27.97098, widthM: 3208 },
  { id: 'disneyland', name: 'Disneyland', label: 'DISNEYLAND', lon: -117.9198, lat: 33.809835, widthM: 3208 },
  { id: 'milwaukee', name: 'Milwaukee', label: 'MILWAUKEE', lon: -87.907875, lat: 43.03561, widthM: 3000 },
  { id: 'new-york', name: 'New York City', label: 'NEW YORK', lon: -73.98, lat: 40.752, widthM: 6500 },
  { id: 'rome', name: 'Rome', label: 'ROME', lon: 12.476775, lat: 41.89726, widthM: 3000 },
  { id: 'salt-lake-city', name: 'Salt Lake City', label: 'SALT LAKE CITY', lon: -111.89423, lat: 40.767915, widthM: 2600 },
  { id: 'san-francisco', name: 'San Francisco', label: 'SAN FRANCISCO', lon: -122.411255, lat: 37.792115, widthM: 5800 },
  { id: 'vancouver', name: 'Vancouver', label: 'VANCOUVER', lon: -123.12618, lat: 49.28264, widthM: 4300 },
  { id: 'walt-disney-world', name: 'Walt Disney World', label: 'WALT DISNEY WORLD', lon: -81.58059, lat: 28.41369, widthM: 4900 },
  { id: 'paris', name: 'Paris', label: 'PARIS', lon: 2.3464, lat: 48.8566, widthM: 5000 },
  { id: 'london', name: 'London', label: 'LONDON', lon: -0.1100, lat: 51.5080, widthM: 5000 },
  { id: 'amsterdam', name: 'Amsterdam', label: 'AMSTERDAM', lon: 4.8952, lat: 52.3702, widthM: 3500 },
  { id: 'venice', name: 'Venice', label: 'VENEZIA', lon: 12.3326, lat: 45.4371, widthM: 3500 },
  { id: 'sydney', name: 'Sydney', label: 'SYDNEY', lon: 151.2093, lat: -33.8610, widthM: 4000 },
];

export interface LabelPreset {
  id: string;
  name: string;
  // Filled in from the map centre when the subtitle is empty.
  subtitle?: 'coordinates' | 'short';
  label: Partial<LabelSettings>;
}

// A few looks for each title style. They leave the title text alone and put
// size and letter spacing back to normal.
export const LABEL_PRESETS: LabelPreset[] = [
  { id: 'plaque', name: 'Plaque', label: { style: 'box', font: 'montserrat', boxBorder: true, solid: false, position: 'lower_right' } },
  { id: 'plate', name: 'Engraved plate', label: { style: 'box', font: 'oswald', solid: true, position: 'lower_right' } },
  {
    id: 'poster',
    name: 'Poster',
    subtitle: 'coordinates',
    label: { style: 'band', font: 'montserrat', bandPosition: 'bottom', bandAlign: 'center', divider: true, ornament: true },
  },
  {
    id: 'gallery',
    name: 'Gallery',
    subtitle: 'coordinates',
    label: { style: 'band', font: 'cinzel', bandPosition: 'top', bandAlign: 'left', bandHeight: 15, divider: true, ornament: false },
  },
  { id: 'banner', name: 'Vintage banner', label: { style: 'ribbon', font: 'cinzel', ribbonArch: 45, solid: false, position: 'lower_center' } },
  { id: 'dark-ribbon', name: 'Dark ribbon', label: { style: 'ribbon', font: 'josefin', ribbonArch: 0, solid: true, position: 'upper_center' } },
  { id: 'seal', name: 'Compass seal', subtitle: 'short', label: { style: 'badge', font: 'josefin', badgeCentre: 'compass', solid: false, position: 'lower_right' } },
  { id: 'solid-seal', name: 'Solid seal', subtitle: 'short', label: { style: 'badge', font: 'cinzel', badgeCentre: 'compass', solid: true, position: 'lower_right' } },
  { id: 'stencil', name: 'Stencil', label: { style: 'letters', font: 'bebas', lettersMode: 'cutout', lettersAlign: 'center' } },
  { id: 'map-letters', name: 'Map in letters', label: { style: 'letters', font: 'bebas', lettersMode: 'window', lettersAlign: 'center' } },
  { id: 'inscription', name: 'Inscription', subtitle: 'coordinates', label: { style: 'inset', font: 'cinzel', bandPosition: 'bottom' } },
  {
    id: 'field-map',
    name: 'Field map',
    subtitle: 'coordinates',
    label: { style: 'legend', font: 'oswald', position: 'lower_left', legendScale: true, legendNorth: true, boxBorder: true },
  },
];

// Four decimals is about 10 m. The short form fits around a badge.
export function formatCoordinates(lat: number, lon: number, short = false): string {
  const digits = short ? 2 : 4;
  const ns = `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}`;
  const ew = `${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'E' : 'W'}`;
  return short ? `${ns} ${ew}` : `${ns}, ${ew}`;
}

const COORDINATES = /^\d+(\.\d+)?° [NS],? \d+(\.\d+)?° [EW]$/;

// A subtitle the user typed is kept. Coordinates are rewritten in the preset's form.
export function applyLabelPreset(preset: LabelPreset, label: LabelSettings, lat: number, lon: number): LabelSettings {
  const typed = label.subtitle.trim();
  const subtitle = preset.subtitle && (!typed || COORDINATES.test(typed)) ? formatCoordinates(lat, lon, preset.subtitle === 'short') : label.subtitle;
  return { ...label, size: 100, titleSpacing: 1, subtitleSpacing: 1, subtitleFont: '', ...preset.label, subtitle };
}

export const DEFAULT_PRODUCT = PRODUCT_PRESETS[0];
export const DEFAULT_PLACE = PLACE_PRESETS[0];
