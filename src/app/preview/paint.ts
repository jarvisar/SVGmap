import type { OutputGroup, RenderResult } from '../../engine/result.ts';
import type { ElementId } from '../../engine/settings.ts';
import type { PreviewLook } from '../store.ts';

const WOOD = '#E8D2AC';
const BURN = '#3A2415';
// Rough darkness of each fill in the wood preview, since each gets its own process.
const BURN_OPACITY: Partial<Record<ElementId, number>> = {
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
};

export interface Paint {
  fill: string;
  fillOpacity?: number;
  stroke: string;
  strokeOpacity?: number;
  strokeWidth?: number;
}

export function previewBackground(result: RenderResult, look: PreviewLook) {
  return result.mode === 'laser' ? (look === 'material' ? WOOD : '#fff') : (result.background ?? '#fff');
}

// The colour an element is drawn in, for a title drawn over the result while it's moved.
export function previewInk(result: RenderResult, look: PreviewLook, element: ElementId) {
  if (result.mode === 'laser' && look === 'material') return BURN;
  return result.groups.find((g) => g.element === element)?.color ?? '#222222';
}

export function groupPaint(group: OutputGroup, result: RenderResult, look: PreviewLook): Paint {
  const laserMaterial = result.mode === 'laser' && look === 'material';
  if (group.id === 'cut') {
    return { fill: 'none', stroke: laserMaterial ? 'rgba(0,0,0,0.35)' : group.color, strokeWidth: laserMaterial ? 0.3 : Math.max(group.strokeWidth, 0.12) };
  }
  if (group.kind === 'fill') {
    return laserMaterial
      ? { fill: BURN, fillOpacity: BURN_OPACITY[group.element] ?? 0.8, stroke: 'none' }
      : { fill: group.color, stroke: 'none' };
  }
  // A scored route has its own process, normally a deeper one than the streets.
  const route = group.element === 'route';
  const width = result.mode === 'laser' ? (route ? 0.2 : 0.12) : group.strokeWidth;
  return laserMaterial
    ? { fill: 'none', stroke: BURN, strokeOpacity: route ? 1 : 0.85, strokeWidth: width }
    : { fill: 'none', stroke: group.color, strokeWidth: width };
}
