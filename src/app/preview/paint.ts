import type { GroupElement, OutputGroup, RenderResult } from '../../engine/result.ts';
import type { ElementId } from '../../engine/settings.ts';
import type { PreviewLook } from '../store.ts';

// Rough looks for the laser preview and the PNG. Dark materials mark light.
export const MATERIALS = {
  birch: { name: 'Birch', base: '#E8D2AC', mark: '#3A2415' },
  walnut: { name: 'Walnut', base: '#6E4B33', mark: '#22140B' },
  cork: { name: 'Cork', base: '#C9A273', mark: '#3E2614' },
  leather: { name: 'Leather', base: '#8A5A36', mark: '#2B180C' },
  slate: { name: 'Slate', base: '#3E4246', mark: '#D9DCDE' },
  acrylic: { name: 'Black acrylic', base: '#151515', mark: '#E6E6E6' },
} as const;
export type MaterialId = keyof typeof MATERIALS;

const material = (result: RenderResult, look: PreviewLook) => (result.mode === 'laser' && look !== 'colors' ? (MATERIALS[look] ?? MATERIALS.birch) : null);

// Rough strength of each fill in the material preview, since each gets its own process.
const BURN_OPACITY: Partial<Record<GroupElement, number>> = {
  buildings: 0.92,
  text: 0.95,
  band: 0.95,
  water: 0.7,
  aeroways: 0.6,
  rocks: 0.5,
  greens: 0.38,
  sand: 0.25,
  decks: 0.3,
  route: 0.95,
  mark: 0.95,
};

export interface Paint {
  fill: string;
  fillOpacity?: number;
  stroke: string;
  strokeOpacity?: number;
  strokeWidth?: number;
}

export function previewBackground(result: RenderResult, look: PreviewLook) {
  return result.mode === 'laser' ? (material(result, look)?.base ?? '#fff') : (result.background ?? '#fff');
}

// The colour an element is drawn in, for a title drawn over the result while it's moved.
export function previewInk(result: RenderResult, look: PreviewLook, element: ElementId) {
  const m = material(result, look);
  if (m) return m.mark;
  return result.groups.find((g) => g.element === element)?.color ?? '#222222';
}

// A mark's colour as the preview draws it.
export function previewMarkInk(result: RenderResult, look: PreviewLook, color: string) {
  return material(result, look)?.mark ?? color;
}

export function groupPaint(group: OutputGroup, result: RenderResult, look: PreviewLook): Paint {
  const m = material(result, look);
  if (group.id === 'cut') {
    return m
      ? { fill: 'none', stroke: m.mark, strokeOpacity: 0.35, strokeWidth: 0.3 }
      : { fill: 'none', stroke: group.color, strokeWidth: Math.max(group.strokeWidth, 0.12) };
  }
  if (group.kind === 'fill') {
    return m
      ? { fill: m.mark, fillOpacity: BURN_OPACITY[group.element] ?? 0.8, stroke: 'none' }
      : { fill: group.color, stroke: 'none' };
  }
  // A scored route has its own process, normally a deeper one than the streets.
  const route = group.element === 'route';
  const width = result.mode === 'laser' ? (route ? 0.2 : 0.12) : group.strokeWidth;
  return m
    ? { fill: 'none', stroke: m.mark, strokeOpacity: route ? 1 : 0.85, strokeWidth: width }
    : { fill: 'none', stroke: group.color, strokeWidth: width };
}
