// Picking roads in the preview, to draw them in a road route of their own
// colour or leave them out.
import { useEffect, useState } from 'react';
import { type LonLatLine, PICK_LAYERS, type PickLines, type RoadRoute, pickLonLat } from '../../engine/routes/picks.ts';
import { LAYER_NAMES } from '../../engine/settings.ts';
import { ColorInput, NumberInput } from '../components/controls.tsx';
import { addRoadRoute, assignLines, clearPicks, deleteRoadRoute, dropPicks, updateRoadRoute } from '../picks.ts';
import { useRender } from '../render.ts';
import { useApp } from '../store.ts';

const CELL_MM = 3;
// Ends this close meet.
const JOIN_MM = 0.05;
// How far a road may turn and still be the same road.
const ALONG_DEGREES = 40;

/** Finds pick lines by position, and follows them along a road. */
export class PickIndex {
  private readonly grid = new Map<number, number[]>();
  private readonly ends = new Map<number, number[]>();
  readonly pick: PickLines;

  constructor(pick: PickLines) {
    this.pick = pick;
    const { starts, points } = pick;
    for (let line = 0; line < starts.length - 1; line++) {
      for (let p = starts[line]; p < starts[line + 1] - 1; p++) {
        const x0 = Math.floor(Math.min(points[p * 2], points[p * 2 + 2]) / CELL_MM);
        const x1 = Math.floor(Math.max(points[p * 2], points[p * 2 + 2]) / CELL_MM);
        const y0 = Math.floor(Math.min(points[p * 2 + 1], points[p * 2 + 3]) / CELL_MM);
        const y1 = Math.floor(Math.max(points[p * 2 + 1], points[p * 2 + 3]) / CELL_MM);
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const key = cell(x, y);
            const list = this.grid.get(key);
            if (list) {
              if (list[list.length - 1] !== line) list.push(line);
            } else this.grid.set(key, [line]);
          }
        }
      }
      for (const p of [starts[line], starts[line + 1] - 1]) {
        const key = cell(Math.round(points[p * 2] / JOIN_MM), Math.round(points[p * 2 + 1] / JOIN_MM));
        const list = this.ends.get(key);
        if (list) list.push(line);
        else this.ends.set(key, [line]);
      }
    }
  }

  get count(): number {
    return this.pick.starts.length - 1;
  }

  /** The line nearest a point within `reach` mm, or -1. */
  nearest(x: number, y: number, reach: number): number {
    const { starts, points } = this.pick;
    let best = -1;
    let bestDistance = reach;
    const r = Math.ceil(reach / CELL_MM);
    const cx = Math.floor(x / CELL_MM);
    const cy = Math.floor(y / CELL_MM);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (const line of this.grid.get(cell(cx + dx, cy + dy)) ?? []) {
          for (let p = starts[line]; p < starts[line + 1] - 1; p++) {
            const d = segmentDistance(x, y, points[p * 2], points[p * 2 + 1], points[p * 2 + 2], points[p * 2 + 3]);
            if (d < bestDistance) {
              bestDistance = d;
              best = line;
            }
          }
        }
      }
    }
    return best;
  }

  /** The lines, and on from each end the road carrying straight on in the same class. */
  along(lines: number[]): number[] {
    const { starts, points, layers, classes } = this.pick;
    const found = new Set(lines);
    const stack = [...lines];
    const direction = (line: number, atStart: boolean): [number, number] => {
      // Heading out of the line at that end.
      const [p, q] = atStart ? [starts[line] + 1, starts[line]] : [starts[line + 1] - 2, starts[line + 1] - 1];
      const dx = points[q * 2] - points[p * 2];
      const dy = points[q * 2 + 1] - points[p * 2 + 1];
      const length = Math.hypot(dx, dy) || 1;
      return [dx / length, dy / length];
    };
    while (stack.length) {
      const line = stack.pop()!;
      for (const atStart of [true, false]) {
        const p = atStart ? starts[line] : starts[line + 1] - 1;
        const [hx, hy] = direction(line, atStart);
        const px = Math.round(points[p * 2] / JOIN_MM);
        const py = Math.round(points[p * 2 + 1] / JOIN_MM);
        let best = -1;
        let bestTurn = ALONG_DEGREES;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const next of this.ends.get(cell(px + dx, py + dy)) ?? []) {
              if (next === line || layers[next] !== layers[line] || classes[next] !== classes[line]) continue;
              // Which end of the next line is here decides its heading away from the junction.
              const nearStart = Math.hypot(points[starts[next] * 2] - points[p * 2], points[starts[next] * 2 + 1] - points[p * 2 + 1]) < JOIN_MM * 2;
              const [nx, ny] = direction(next, !nearStart);
              const turn = (Math.acos(Math.max(-1, Math.min(1, hx * nx + hy * ny))) * 180) / Math.PI;
              if (turn < bestTurn) {
                bestTurn = turn;
                best = next;
              }
            }
          }
        }
        if (best >= 0 && !found.has(best)) {
          found.add(best);
          stack.push(best);
        }
      }
    }
    return [...found];
  }

  pathD(line: number): string {
    const { starts, points } = this.pick;
    let d = '';
    for (let p = starts[line]; p < starts[line + 1]; p++) d += `${p === starts[line] ? 'M' : 'L'}${points[p * 2].toFixed(3)} ${points[p * 2 + 1].toFixed(3)}`;
    return d;
  }

  lonLat(line: number): LonLatLine {
    return pickLonLat(this.pick, line);
  }
}

function cell(x: number, y: number): number {
  return (x + 2 ** 20) * 2 ** 21 + (y + 2 ** 20);
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  let t = length2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / length2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Picked roads drawn over the preview. Road routes show in their colours,
 * since the wood look burns every line alike, and left-out roads as a faint
 * dashed line so they can be found again. unit is mm per screen pixel.
 */
export function PickOverlay({ index, selected, hover, unit, routes }: { index: PickIndex; selected: number[]; hover: number; unit: number; routes: RoadRoute[] }) {
  const hidden: number[] = [];
  const routed = new Map<number, number[]>();
  for (let line = 0; line < index.count; line++) {
    const owner = index.pick.owners[line];
    if (owner === -1) hidden.push(line);
    else if (owner >= 0) {
      const list = routed.get(owner);
      if (list) list.push(line);
      else routed.set(owner, [line]);
    }
  }
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
      {hidden.length > 0 ? (
        <path d={hidden.map((line) => index.pathD(line)).join('')} stroke="#6b7280" strokeWidth={unit * 1.5} strokeDasharray={`${unit * 4} ${unit * 3}`} opacity={0.7} />
      ) : null}
      {[...routed].map(([owner, lines]) => (
        <path key={owner} d={lines.map((line) => index.pathD(line)).join('')} stroke={routes[owner]?.color ?? '#888888'} strokeWidth={unit * 3} opacity={0.85} />
      ))}
      {hover >= 0 && !selected.includes(hover) ? <path d={index.pathD(hover)} stroke="#2f7cf6" strokeWidth={unit * 5} opacity={0.35} /> : null}
      {selected.length > 0 ? <path d={selected.map((line) => index.pathD(line)).join('')} stroke="#2f7cf6" strokeWidth={unit * 5} opacity={0.6} /> : null}
    </g>
  );
}

const NEW = '__new';
const NONE: LonLatLine[] = [];

/** The card beside the preview while roads are being picked. */
export function RoadRouteCard({ index, selected, onSelect, onClose }: { index: PickIndex | null; selected: number[]; onSelect: (lines: number[]) => void; onClose: () => void }) {
  const routes = useApp((s) => s.roadRoutes);
  const hiddenCount = useApp((s) => s.hiddenLines.length);
  const mode = useApp((s) => s.mode);
  const missing = useRender((s) => s.result?.missingPicks ?? NONE);
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (!routes.some((r) => r.id === target)) setTarget(routes[0]?.id ?? '');
  }, [routes, target]);

  const owners = index ? selected.map((line) => index.pick.owners[line]) : [];
  const anyPicked = owners.some((owner) => owner !== -2);
  const allHidden = owners.length > 0 && owners.every((owner) => owner === -1);
  const lines = () => (index ? selected.map((line) => index.lonLat(line)) : []);
  const assign = (to: string | 'hidden' | null) => {
    if (assignLines(lines(), to)) onSelect([]);
  };
  const layers = index ? new Set(selected.map((line) => LAYER_NAMES[PICK_LAYERS[index.pick.layers[line]]])) : new Set<string>();

  return (
    <section className="preview-card" aria-label="Pick roads">
      <header className="preview-card-header">
        <h2>{selected.length ? `${selected.length} ${selected.length === 1 ? 'line' : 'lines'} picked` : 'Pick roads'}</h2>
        <button type="button" className="icon-button" aria-label="Stop picking roads" title="Stop picking roads" onClick={onClose}>
          ×
        </button>
      </header>
      {!selected.length ? (
        <p className="preview-card-text">
          Click the roads, paths or railways a route follows, and click one again to drop it. Put them in a road route to give them a colour and layer of their
          own, or leave them out. Dragging still moves the view.
        </p>
      ) : (
        <>
          <div className="preview-card-actions">
            <button type="button" className="btn btn-small" onClick={() => index && onSelect(index.along(selected))} title="Follow the road on from both ends">
              Along the road
            </button>
            <button type="button" className="btn btn-small" onClick={() => onSelect([])}>
              Clear
            </button>
          </div>
          {layers.size > 0 ? <p className="preview-card-note">{[...layers].join(', ')}</p> : null}
          <div className="preview-card-actions">
            <select
              className="select"
              aria-label="Road route"
              value={target || NEW}
              onChange={(event) => {
                if (event.target.value !== NEW) {
                  setTarget(event.target.value);
                  return;
                }
                const id = addRoadRoute();
                if (id) setTarget(id);
              }}
            >
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
              <option value={NEW}>New road route…</option>
            </select>
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => {
                const id = target || addRoadRoute();
                if (id) assign(id);
              }}
            >
              Add
            </button>
          </div>
          <div className="preview-card-actions">
            {!allHidden ? (
              <button type="button" className="btn btn-small" onClick={() => assign('hidden')}>
                Leave out
              </button>
            ) : null}
            {anyPicked ? (
              <button type="button" className="btn btn-small" onClick={() => assign(null)}>
                Back to normal
              </button>
            ) : null}
          </div>
        </>
      )}
      <RoadRouteList routes={routes} print={mode === 'print'} />
      {missing.length > 0 ? (
        <p className="preview-card-note">
          {missing.length === 1 ? "1 picked road isn't" : `${missing.length} picked roads aren't`} on this map. They may be outside it, on a layer that's off, or
          drawn differently at this scale.{' '}
          <button type="button" className="link-button" onClick={() => dropPicks(missing)}>
            Drop {missing.length === 1 ? 'it' : 'them'}
          </button>
        </p>
      ) : null}
      {hiddenCount > 0 || routes.some((r) => r.lines.length) ? (
        <p className="preview-card-note">
          {hiddenCount ? `${hiddenCount} left out. ` : 'Nothing left out. '}
          <button type="button" className="link-button" onClick={clearPicks}>
            Put every road back to normal
          </button>
        </p>
      ) : null}
      <p className="preview-card-note">Road routes are drawn over the roads, each as a layer of its own.</p>
    </section>
  );
}

function RoadRouteList({ routes, print }: { routes: RoadRoute[]; print: boolean }) {
  return (
    <div className="road-routes">
      <div className="road-routes-head">
        <span>Road routes</span>
        <button type="button" className="link-button" onClick={() => addRoadRoute()}>
          New road route
        </button>
      </div>
      {routes.length ? (
        <ul>
          {routes.map((route) => (
            <RoadRouteRow key={route.id} route={route} print={print} />
          ))}
        </ul>
      ) : (
        <p className="preview-card-note">A road route is a colour of its own for the roads you pick, like a race course or the way home.</p>
      )}
    </div>
  );
}

function RoadRouteRow({ route, print }: { route: RoadRoute; print: boolean }) {
  const [name, setName] = useState(route.name);
  useEffect(() => setName(route.name), [route.name]);
  return (
    <li className="road-route">
      <ColorInput label={`Colour of ${route.name}`} value={route.color} onChange={(color) => updateRoadRoute(route.id, { color })} />
      <input
        className="input"
        value={name}
        aria-label="Road route name"
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (!name.trim()) setName(route.name);
          else if (name !== route.name) updateRoadRoute(route.id, { name: name.trim() });
        }}
        onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
      />
      {print ? <NumberInput value={route.width} min={0.02} max={5} step={0.05} unit="mm" label={`Line width of ${route.name}`} onChange={(width) => updateRoadRoute(route.id, { width })} /> : null}
      <span className="road-route-count" title="Lines in it">
        {route.lines.length}
      </span>
      <button type="button" className="icon-button" aria-label={`Delete ${route.name}`} title="Delete the road route. Its roads go back to normal." onClick={() => deleteRoadRoute(route.id)}>
        ×
      </button>
    </li>
  );
}
