// Leaving out sidewalks and crossings: Overture's subclasses, cutting the
// tiles' paths along them, and the option through the render service with
// fetchOverture mocked.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OvertureData, OvertureFeature } from './data/features.ts';
import { fetchOverture, OvertureUnavailableError, type FetchOvertureOptions } from './data/overture.ts';
import { defaultRenderSettings } from './defaults.ts';
import { TILE_EXTENT, worldToLonLat } from './geo/mercator.ts';
import { computeLayout } from './layout/layout.ts';
import { type Path, pathLength } from './lines/geometry.ts';
import { type PreparedLine, planTiles, prepareArea } from './prepare.ts';
import { RenderService } from './service.ts';
import type { RenderSettings } from './settings.ts';
import { isSidepath, leaveOutSidepaths, sidepathParts } from './sidewalks.ts';

vi.mock('./data/overture.ts', async (original) => ({ ...(await original<typeof import('./data/overture.ts')>()), fetchOverture: vi.fn() }));
const fetchMock = vi.mocked(fetchOverture);

const line = (layer: PreparedLine['layer'], path: Path, cls = 'footway'): PreparedLine => ({ layer, cls, rank: 11, flags: 0, path });

describe("Overture's sidewalks and crossings", () => {
  it('are road segments with a sidewalk, crosswalk or cycle crossing subclass', () => {
    expect(isSidepath({ subtype: 'road', class: 'footway', subclass: 'sidewalk' })).toBe(true);
    expect(isSidepath({ subtype: 'road', class: 'footway', subclass: 'crosswalk' })).toBe(true);
    expect(isSidepath({ subtype: 'road', class: 'cycleway', subclass: 'cycle_crossing' })).toBe(true);
    expect(isSidepath({ subtype: 'road', class: 'footway' })).toBe(false);
    expect(isSidepath({ subtype: 'road', class: 'residential', subclass: 'link' })).toBe(false);
    expect(isSidepath({ subtype: 'rail', subclass: 'sidewalk' })).toBe(false);
    // Only a stretch of it.
    expect(isSidepath({ subtype: 'road', class: 'footway', subclass_rules: [{ value: 'crosswalk', between: [0.4, 0.6] }] })).toBe(true);
  });

  it('can be only part of a segment', () => {
    expect(sidepathParts({ subtype: 'road', subclass: 'sidewalk' })).toEqual([[0, 1]]);
    expect(sidepathParts({ subtype: 'road', subclass_rules: [{ value: 'crosswalk', between: [0.4, 0.6] }] })).toEqual([[0.4, 0.6]]);
    // A rule overrides the segment's own subclass along its stretch.
    expect(sidepathParts({ subtype: 'road', subclass: 'sidewalk', subclass_rules: [{ value: 'link', between: [0.5, 1] }] })).toEqual([[0, 0.5]]);
    expect(sidepathParts({ subtype: 'road', subclass_rules: [{ value: 'sidewalk', between: null }] })).toEqual([[0, 1]]);
    expect(sidepathParts({ subtype: 'road', subclass: 'link' })).toEqual([]);
  });
});

describe('leaving out paths along sidewalks', () => {
  const sidewalk: Path = [
    [0, 0],
    [100, 0],
  ];
  const tolerance = 0.15;

  it('takes out a path lying along one', () => {
    const { lines, removedMm } = leaveOutSidepaths([line('paths', [[10, 0.05], [90, 0.05]])], [sidewalk], tolerance);
    expect(lines).toEqual([]);
    expect(removedMm).toBeCloseTo(80, 6);
  });

  it('cuts a path that only partly lies along one, and keeps the rest', () => {
    const { lines } = leaveOutSidepaths([line('paths', [[50, 0.05], [100, 0.05], [100, 50]])], [sidewalk], tolerance);
    expect(lines).toHaveLength(1);
    const kept = lines[0].path;
    expect(kept[kept.length - 1]).toEqual([100, 50]);
    expect(pathLength(kept)).toBeGreaterThan(49.5);
    expect(pathLength(kept)).toBeLessThanOrEqual(50.06);
    expect(lines[0].cls).toBe('footway');
  });

  it('keeps a path that crosses one, or runs beside it further away, whole', () => {
    const across = line('paths', [[50, -20], [50, 20]]);
    const beside = line('paths', [[0, 5], [100, 5]]);
    const { lines, removedMm } = leaveOutSidepaths([across, beside], [sidewalk], tolerance);
    expect(lines).toEqual([across, beside]);
    expect(lines[0]).toBe(across);
    expect(removedMm).toBe(0);
  });

  it('leaves roads alone', () => {
    const road = line('roads', [[0, 0.05], [100, 0.05]], 'minor');
    expect(leaveOutSidepaths([road], [sidewalk], tolerance).lines).toEqual([road]);
  });

  it('cuts out a crossing in the middle of a long path', () => {
    const crossing: Path = [
      [40, 0],
      [60, 0],
    ];
    const { lines } = leaveOutSidepaths([line('paths', [[0, 0.05], [100, 0.05]])], [crossing], tolerance);
    expect(lines.map((l) => [l.path[0][0], l.path[l.path.length - 1][0]])).toEqual([
      [0, expect.closeTo(40, 0)],
      [expect.closeTo(60, 0), 100],
    ]);
  });
});

// The real Canada Place tile, with the longest footway in it taken for a
// sidewalk and the next for a park path.
const tile = new Uint8Array(readFileSync(new URL('./fixtures/vancouver-14-2589-5606.pbf', import.meta.url)));
const centre = worldToLonLat(2589.5 * TILE_EXTENT, 5606.5 * TILE_EXTENT, 14);
const TILES = 'https://tiles.test/{z}/{x}/{y}.pbf';

function settings(patch: (s: RenderSettings) => void = () => {}): RenderSettings {
  const s = defaultRenderSettings('laser');
  s.area = { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 1200 };
  s.label = { ...s.label, enabled: false };
  s.source = { ...s.source, tiles: TILES };
  s.filters = { ...s.filters, paths: { ...s.filters.paths, skipSidewalks: true } };
  // Kept out of the way, so the paths group is the tile's paths as they are.
  s.cleanup = { ...s.cleanup, enabled: false };
  patch(s);
  return s;
}

const base = settings();
const layout = computeLayout(base.product, base.border);
const plan = planTiles(base.area, layout, base.source);
const prepared = prepareArea(plan, layout, new Map([['14/2589/5606', tile.buffer.slice(0)]]));
const footways = prepared.lines.filter((l) => l.layer === 'paths' && l.cls === 'footway').sort((a, b) => pathLength(b.path) - pathLength(a.path));
const [walk, park] = footways;

function segment(id: string, path: Path, subclass: string | null): OvertureFeature {
  const coordinates = path.map(([x, y]) => {
    const { lon, lat } = worldToLonLat(...plan.transform.toWorld(x, y), plan.zoom);
    return [lon, lat] as [number, number];
  });
  const lons = coordinates.map((p) => p[0]);
  const lats = coordinates.map((p) => p[1]);
  return {
    id,
    type: 'segment',
    geometry: { type: 'LineString', coordinates },
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    props: { subtype: 'road', class: 'footway', ...(subclass ? { subclass } : {}) },
  };
}

const SEGMENTS = [segment('sidewalk', walk.path, 'sidewalk'), segment('park', park.path, null)];

function answer(options: FetchOvertureOptions): OvertureData {
  const keep = (f: OvertureFeature) => !options.keep || options.keep(f.type, f.props, f.bbox);
  return {
    release: 'test',
    bounds: options.bounds,
    features: { building: [], segment: options.types?.includes('segment') ? SEGMENTS.filter(keep) : [] },
    bytes: 1000,
    stats: {} as OvertureData['stats'],
  };
}

const service = () => new RenderService(async () => new ArrayBuffer(0));
const pathsLength = (result: Awaited<ReturnType<RenderService['render']>>) => result.groups.find((g) => g.id === 'paths')?.lengthMm ?? 0;
const roadsLength = (result: Awaited<ReturnType<RenderService['render']>>) => result.groups.find((g) => g.id === 'roads')?.lengthMm ?? 0;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (options) => answer(options));
  vi.stubGlobal('fetch', async (url: string) => (url.endsWith('/14/2589/5606.pbf') ? new Response(tile.slice()) : new Response(null, { status: 204 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('skipping sidewalks and crossings in a render', () => {
  it('is off by default and downloads nothing', async () => {
    expect(defaultRenderSettings('laser').filters.paths.skipSidewalks).toBe(false);
    const result = await service().render({ settings: settings((s) => (s.filters.paths.skipSidewalks = false)) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.stats.sidewalksLeftOutM).toBeUndefined();
    expect(result.meta.attribution).toBe('© OpenStreetMap contributors');
  });

  it('leaves out the paths Overture has as sidewalks, and only those', async () => {
    const svc = service();
    const off = await svc.render({ settings: settings((s) => (s.filters.paths.skipSidewalks = false)) });
    const on = await svc.render({ settings: settings() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].types).toEqual(['segment']);
    const removed = pathsLength(off) - pathsLength(on);
    expect(removed).toBeCloseTo(pathLength(walk.path), 0);
    expect(on.stats.sidewalksLeftOutM).toBeCloseTo(pathLength(walk.path) * plan.transform.metresPerMm, -1);
    // The park path and the roads stay.
    expect(pathsLength(on)).toBeGreaterThan(pathLength(park.path));
    expect(roadsLength(on)).toBe(roadsLength(off));
    expect(on.meta.attribution).toBe('© OpenStreetMap contributors, Overture Maps Foundation');
    expect(on.warnings).toEqual([]);

    // Turned off and on again, nothing is downloaded again.
    const again = await svc.render({ settings: settings((s) => (s.filters.paths.skipSidewalks = false)) });
    expect(pathsLength(again)).toBe(pathsLength(off));
    await svc.render({ settings: settings() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('downloads them apart from the buildings', async () => {
    await service().render({ settings: settings((s) => (s.source.overtureBuildings = true)) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([options]) => options.types ?? ['building'])).toEqual([['building'], ['segment']]);
  });

  it('downloads nothing with the paths layer off', async () => {
    await service().render({ settings: settings((s) => (s.layers = { ...s.layers, paths: false })) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('draws the paths as they are when Overture fails, and tries again a minute later', async () => {
    fetchMock.mockRejectedValue(new OvertureUnavailableError(false));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const svc = service();
    const off = await svc.render({ settings: settings((s) => (s.filters.paths.skipSidewalks = false)) });
    const failed = await svc.render({ settings: settings() });
    expect(failed.warnings).toEqual([expect.stringMatching(/couldn't be downloaded from Overture.*busy/)]);
    expect(failed.stats.overtureFailed).toBe(true);
    expect(pathsLength(failed)).toBe(pathsLength(off));

    fetchMock.mockImplementation(async (options) => answer(options));
    await svc.render({ settings: settings() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 61_000);
    const later = await svc.render({ settings: settings() });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(later.warnings).toEqual([]);
    expect(pathsLength(later)).toBeLessThan(pathsLength(off));
  });
});
