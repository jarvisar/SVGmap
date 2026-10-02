// Roads picked in the preview: road routes of their own colour, and roads
// left out. A road is in one place at a time, so assigning lines takes them
// out of wherever they were first.
import { type LonLatLine, MAX_PICKED_POINTS, MAX_ROAD_ROUTES, type RoadRoute, pickedPoints, withoutLines } from '../engine/routes/picks.ts';
import { flash } from './flash.ts';
import { useApp } from './store.ts';
import { asChange } from './undo.ts';

const ROUTE_COLOURS = ['#E4002B', '#0057B8', '#FF8200', '#7A3E9D', '#009A44', '#E0A800', '#00A3AD', '#D62598'];

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function hasPicks(s: { roadRoutes: RoadRoute[]; hiddenLines: LonLatLine[] }): boolean {
  return s.hiddenLines.length > 0 || s.roadRoutes.some((route) => route.lines.length > 0);
}

/** A new road route in a colour none of the others have. Returns its id, or null at the limit. */
export function addRoadRoute(name?: string): string | null {
  const routes = useApp.getState().roadRoutes;
  if (routes.length >= MAX_ROAD_ROUTES) {
    flash(`A map can have at most ${MAX_ROAD_ROUTES} road routes.`, 4000);
    return null;
  }
  const used = new Set(routes.map((r) => r.color));
  const color = ROUTE_COLOURS.find((c) => !used.has(c)) ?? ROUTE_COLOURS[routes.length % ROUTE_COLOURS.length];
  const route: RoadRoute = { id: newId(), name: name?.trim() || `Road route ${routes.length + 1}`, color, width: 0.6, lines: [] };
  useApp.getState().set({ roadRoutes: [...routes, route] });
  return route.id;
}

export function updateRoadRoute(id: string, patch: Partial<Omit<RoadRoute, 'id' | 'lines'>>): void {
  const routes = useApp.getState().roadRoutes;
  useApp.getState().set({ roadRoutes: routes.map((r) => (r.id === id ? { ...r, ...patch, color: (patch.color ?? r.color).toUpperCase() } : r)) });
}

// Undo brings these back, but phones have no room for the undo buttons.
export function deleteRoadRoute(id: string): void {
  const route = useApp.getState().roadRoutes.find((r) => r.id === id);
  if (!route) return;
  if (route.lines.length && !confirm(`Delete ${route.name}? Its roads go back to normal.`)) return;
  asChange(`Delete ${route.name}`, () => useApp.getState().set({ roadRoutes: useApp.getState().roadRoutes.filter((r) => r.id !== id) }));
  flash(`Deleted ${route.name}`);
}

/** Puts lines in a road route, leaves them out ('hidden'), or back to normal (null). */
export function assignLines(lines: LonLatLine[], target: string | 'hidden' | null): boolean {
  if (!lines.length) return true;
  const others = (stored: LonLatLine[]) => withoutLines(stored, lines);
  const s = useApp.getState();
  const roadRoutes = s.roadRoutes.map((route) => ({ ...route, lines: [...others(route.lines), ...(route.id === target ? lines : [])] }));
  const hiddenLines = [...others(s.hiddenLines), ...(target === 'hidden' ? lines : [])];
  if (pickedPoints(roadRoutes, hiddenLines) > MAX_PICKED_POINTS) {
    flash('That is more road than one map can keep picked. Put fewer roads in road routes, or take some out of them first.', 5000);
    return false;
  }
  s.set({ roadRoutes, hiddenLines });
  return true;
}

/** Takes these picked lines out of every road route and the roads left out. */
export function dropPicks(lines: LonLatLine[]): void {
  const gone = new Set(lines.map((line) => JSON.stringify(line)));
  const keep = (stored: LonLatLine[]) => stored.filter((line) => !gone.has(JSON.stringify(line)));
  const s = useApp.getState();
  s.set({ roadRoutes: s.roadRoutes.map((route) => ({ ...route, lines: keep(route.lines) })), hiddenLines: keep(s.hiddenLines) });
}

/** Every road back to normal. The road routes stay, empty. */
export function clearPicks(): void {
  const s = useApp.getState();
  if (!hasPicks(s) || !confirm('Put every picked road back to normal? The road routes stay, empty.')) return;
  asChange('Clear picked roads', () => s.set({ roadRoutes: s.roadRoutes.map((route) => ({ ...route, lines: [] })), hiddenLines: [] }));
  flash('Every road is back to normal');
}
