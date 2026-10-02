// Adding, changing and removing pins and text, and what's picked out for
// editing. The preview, the sidebar and the map view share the selection, so
// a mark picked in one is the one the others show.
import { create } from 'zustand';
import { makeTransform } from '../engine/geo/transform.ts';
import { type Layout, computeLayout } from '../engine/layout/layout.ts';
import { shapeCentre, shapeContains } from '../engine/layout/shapes.ts';
import type { Point } from '../engine/lines/geometry.ts';
import { DEFAULT_MARK, MAX_MARKS, type MapMark, type MarkShape, hasText, markName, markNoun, markPlacedAt, markPoint } from '../engine/marks/marks.ts';
import { flash } from './flash.ts';
import { type AppState, useApp } from './store.ts';
import { asChange } from './undo.ts';

interface MarkUi {
  // The preview's edit mode, with the tools out.
  editing: boolean;
  // What a click on the preview places, or null to pick and drag.
  tool: MarkShape | null;
  selected: string | null;
  // A mark just added whose text field should take the focus.
  focusText: string | null;
  // A mark just added, which drops in with a little bounce.
  fresh: string | null;
}

export const useMarkUi = create<MarkUi>(() => ({ editing: false, tool: null, selected: null, focusText: null, fresh: null }));
let freshTimer: ReturnType<typeof setTimeout> | undefined;

export const selectMark = (id: string | null) => useMarkUi.setState({ selected: id });
export const setTool = (tool: MarkShape | null) => useMarkUi.setState({ tool });
export const setEditing = (editing: boolean) => useMarkUi.setState(editing ? { editing } : { editing, tool: null });

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function pieceLayout(s: Pick<AppState, 'product' | 'border'>): Layout | null {
  try {
    return computeLayout(s.product, s.border);
  } catch {
    return null;
  }
}

// Zoom 14 like the renders. Any zoom gives the same millimetres.
export const markTransform = (area: AppState['area'], layout: Layout) => makeTransform(area, 14, shapeCentre(layout.window), layout.window.w);

/** Where a mark's spot is on the piece now. */
export function markSpot(mark: MapMark, s: Pick<AppState, 'area' | 'product' | 'border'> = useApp.getState()): Point | null {
  const layout = pieceLayout(s);
  return layout ? markPoint(mark, markTransform(s.area, layout), layout.window) : null;
}

// Roughly how far a mark reaches from its spot, without laying out its text.
function reach(mark: MapMark): number {
  const shape = mark.shape === 'none' ? 0 : mark.size * 0.6;
  const longest = Math.max(0, ...mark.text.split('\n').map((line) => line.trim().length));
  return shape + longest * mark.textSize * 0.4;
}

// Near the middle of the map, but clear of the marks already there, so a few
// added in a row don't land on top of each other.
function freeSpot(marks: MapMark[], s: AppState, layout: Layout, adding: Partial<MapMark>): Point {
  const t = markTransform(s.area, layout);
  const own = reach({ ...DEFAULT_MARK, id: '', ...adding });
  const taken = marks.map((m) => ({ at: markPoint(m, t, layout.window), r: reach(m) }));
  const [cx, cy] = shapeCentre(layout.window);
  const step = Math.min(8, layout.window.w / 10);
  for (let ring = 0; ring < 8; ring++) {
    const count = ring === 0 ? 1 : ring * 6;
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * i) / count;
      const p: Point = [cx + ring * step * Math.cos(a), cy + ring * step * Math.sin(a)];
      if (taken.every(({ at, r }) => Math.hypot(at[0] - p[0], at[1] - p[1]) > Math.max(step, r + own))) return p;
    }
  }
  return [cx, cy];
}

// A point pulled in towards the middle of the map until it's on the map, so
// a click on the border or past the piece still puts the mark where it shows.
function onMap(point: Point, layout: Layout): Point {
  const w = layout.window;
  const [cx, cy] = shapeCentre(w);
  for (let t = 0; t < 1; t += 0.02) {
    const p: Point = [point[0] + (cx - point[0]) * t, point[1] + (cy - point[1]) * t];
    if (shapeContains(w, p)) return p;
  }
  return [cx, cy];
}

/**
 * Adds a mark at a point on the piece, or somewhere free near the middle of
 * the map, and selects it. Returns its id, or null when it couldn't be added.
 */
export function addMark(patch: Partial<Omit<MapMark, 'id'>>, point?: Point, focusText = false): string | null {
  const s = useApp.getState();
  if (s.marks.length >= MAX_MARKS) {
    flash(`A map can have at most ${MAX_MARKS} pins and bits of text.`, 4000);
    return null;
  }
  const layout = pieceLayout(s);
  if (!layout) return null;
  const spot = point ? onMap(point, layout) : freeSpot(s.marks, s, layout, patch);
  const mark: MapMark = { ...DEFAULT_MARK, ...patch, id: newId(), ...markPlacedAt(spot, markTransform(s.area, layout), layout.window) };
  asChange(`Add ${markNoun(mark)}`, () => useApp.getState().set({ marks: [...useApp.getState().marks, mark] }));
  useMarkUi.setState({ selected: mark.id, focusText: focusText ? mark.id : null, fresh: mark.id });
  clearTimeout(freshTimer);
  freshTimer = setTimeout(() => useMarkUi.setState({ fresh: null }), 1000);
  flash(`Added ${mark.shape === 'none' ? 'text' : `a ${markNoun(mark)}`}`);
  return mark.id;
}

export function updateMark(id: string, patch: Partial<Omit<MapMark, 'id'>>): void {
  const marks = useApp.getState().marks;
  if (!marks.some((m) => m.id === id)) return;
  useApp.getState().set({ marks: marks.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

/** Moves a mark's spot to a point on the piece. */
export function moveMarkTo(id: string, point: Point): void {
  const s = useApp.getState();
  const layout = pieceLayout(s);
  if (layout) updateMark(id, markPlacedAt(point, markTransform(s.area, layout), layout.window));
}

/**
 * Sticks a mark to the map or the page where it is now. The position it
 * isn't using goes stale as the map or the piece changes, so it's worked
 * out again first.
 */
export function setMarkAnchor(id: string, anchor: MapMark['anchor']): void {
  const s = useApp.getState();
  const mark = s.marks.find((m) => m.id === id);
  const layout = pieceLayout(s);
  if (!mark || !layout || mark.anchor === anchor) return;
  const t = markTransform(s.area, layout);
  updateMark(id, { anchor, ...markPlacedAt(markPoint(mark, t, layout.window), t, layout.window) });
}

/** Moves a mark by (dx, dy) mm on the piece. */
export function nudgeMark(id: string, dx: number, dy: number): void {
  const mark = useApp.getState().marks.find((m) => m.id === id);
  const at = mark && markSpot(mark);
  if (at) moveMarkTo(id, [at[0] + dx, at[1] + dy]);
}

// Undo brings it back, but on phones the undo buttons are tucked away in the settings drawer.
export function removeMark(id: string): void {
  const mark = useApp.getState().marks.find((m) => m.id === id);
  if (!mark) return;
  asChange(`Delete ${markNoun(mark)}`, () => useApp.getState().set({ marks: useApp.getState().marks.filter((m) => m.id !== id) }));
  if (useMarkUi.getState().selected === id) selectMark(null);
  flash(`Deleted ${hasText(mark) ? `“${markName(mark)}”` : `the ${markNoun(mark)}`}. Undo brings it back.`, 4000);
}

/** A copy a little down and to the right, selected. */
export function duplicateMark(id: string): string | null {
  const mark = useApp.getState().marks.find((m) => m.id === id);
  const at = mark && markSpot(mark);
  if (!mark || !at) return null;
  const { id: _id, ...rest } = mark;
  return addMark(rest, [at[0] + 4, at[1] + 4]);
}

const year = new Date().getFullYear();

// Starting points, from the sidebar and the preview's card.
export const MARK_IDEAS: { name: string; mark: Partial<MapMark> }[] = [
  { name: 'Home', mark: { shape: 'house', text: 'Home', side: 'below' } },
  { name: 'You are here', mark: { shape: 'pin', text: 'You are here' } },
  { name: 'Where we met', mark: { shape: 'heart', text: 'Where we met', side: 'below' } },
  { name: 'Start', mark: { shape: 'dot', text: 'Start', size: 4 } },
  { name: 'Finish', mark: { shape: 'flag', text: 'Finish' } },
  { name: 'Summit', mark: { shape: 'peak', text: 'Summit', side: 'above' } },
  { name: 'X marks the spot', mark: { shape: 'cross', size: 6 } },
  { name: `Est. ${year}`, mark: { shape: 'none', text: `EST. ${year}`, textSize: 4 } },
];

/** The settings a new mark of this shape starts with. */
export function startingMark(shape: MarkShape): Partial<MapMark> {
  return shape === 'none' ? { shape, text: 'Text', textSize: 4 } : { shape };
}
