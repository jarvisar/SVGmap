// The Overture buildings option through the render service: one real tile,
// served by a stubbed fetch, and fetchOverture mocked.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OvertureData, OvertureFeature } from './data/features.ts';
import { fetchOverture, OvertureTooLargeError, OvertureUnavailableError, type FetchOvertureOptions } from './data/overture.ts';
import { defaultRenderSettings } from './defaults.ts';
import { areaMm2, intersectWith, toPath64, unionAll } from './fills.ts';
import { TILE_EXTENT, worldToLonLat } from './geo/mercator.ts';
import { computeLayout } from './layout/layout.ts';
import { planTiles, prepareArea } from './prepare.ts';
import { CancelledError, RenderService, type RenderProgress } from './service.ts';
import type { RenderSettings } from './settings.ts';
import { toSvg } from './svg/writer.ts';

vi.mock('./data/overture.ts', async (original) => ({ ...(await original<typeof import('./data/overture.ts')>()), fetchOverture: vi.fn() }));
const fetchMock = vi.mocked(fetchOverture);

const tile = new Uint8Array(readFileSync(new URL('./fixtures/vancouver-14-2589-5606.pbf', import.meta.url)));
const centre = worldToLonLat(2589.5 * TILE_EXTENT, 5606.5 * TILE_EXTENT, 14);
const TILES = 'https://tiles.test/{z}/{x}/{y}.pbf';

function settings(patch: (s: RenderSettings) => void = () => {}): RenderSettings {
  const s = defaultRenderSettings('laser');
  s.area = { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 1200 };
  s.label = { ...s.label, enabled: false };
  s.source = { ...s.source, tiles: TILES, overtureBuildings: true };
  patch(s);
  return s;
}

// The tile's own buildings and the transform the service will use.
const base = settings();
const layout = computeLayout(base.product, base.border);
const plan = planTiles(base.area, layout, base.source);
const prepared = prepareArea(plan, layout, new Map([['14/2589/5606', tile.buffer.slice(0)]]));
const tileBuildings = unionAll(prepared.polygons.filter((p) => p.layer === 'buildings').flatMap((p) => p.rings));

const squareMm = (x: number, y: number, side: number): [number, number][] => [
  [x, y],
  [x + side, y],
  [x + side, y + side],
  [x, y + side],
];
const covered = (x: number, y: number, side: number) => Math.abs(areaMm2(intersectWith([toPath64(squareMm(x, y, side))], tileBuildings)));

// The first spot in the window where a square is clear of (or wholly on) tile buildings.
function findSpot(side: number, onBuilding: boolean, skip = 0): [number, number] {
  const w = layout.window;
  let found = 0;
  for (let y = w.y + 5; y < w.y + w.h - 5; y += side * 2) {
    for (let x = w.x + 5; x < w.x + w.w - 5; x += side * 2) {
      const c = covered(x, y, side);
      const hit = onBuilding ? Math.abs(c - side * side) < 1e-6 : c === 0;
      if (hit && found++ === skip) return [x, y];
    }
  }
  throw new Error('no spot');
}

function feature(id: string, [x, y]: [number, number], side: number, dataset: string): OvertureFeature {
  const ring = [...squareMm(x, y, side), [x, y] as [number, number]].map(([cx, cy]) => {
    const [wx, wy] = plan.transform.toWorld(cx, cy);
    const { lon, lat } = worldToLonLat(wx, wy, plan.zoom);
    return [lon, lat] as [number, number];
  });
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return {
    id,
    type: 'building',
    geometry: { type: 'Polygon', coordinates: [ring] },
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    props: { sources: [{ property: '', dataset }] },
  };
}

const SIDE = 1;
const clear = findSpot(SIDE, false);
const FEATURES = [
  feature('ml-clear', clear, SIDE, 'Microsoft ML Buildings'),
  feature('ml-on-tile-building', findSpot(0.5, true), 0.5, 'Google Open Buildings'),
  feature('osm', findSpot(SIDE, false, 3), SIDE, 'OpenStreetMap'),
];

function answer(options: FetchOvertureOptions): OvertureData {
  options.onProgress?.({ message: 'Reading', bytes: 0, bytesTotal: 1, fraction: 0.5, features: 0 });
  const building = FEATURES.filter((f) => !options.keep || options.keep('building', f.props, f.bbox));
  return {
    release: 'test',
    bounds: options.bounds,
    features: { building },
    bytes: 1000,
    stats: {} as OvertureData['stats'],
  };
}

const service = () => new RenderService(async () => new ArrayBuffer(0));
const buildingsArea = (result: Awaited<ReturnType<RenderService['render']>>) => result.groups.find((g) => g.id === 'buildings')!.areaMm2;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (options) => answer(options));
  vi.stubGlobal('fetch', async (url: string) =>
    url.endsWith('/14/2589/5606.pbf') ? new Response(tile.slice()) : new Response(null, { status: 204 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildings from Overture', () => {
  it('is off by default and leaves the map as it was', async () => {
    expect(defaultRenderSettings('laser').source.overtureBuildings).toBe(false);
    const result = await service().render({ settings: settings((s) => (s.source.overtureBuildings = false)) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.stats.overtureBuildings).toBeUndefined();
    expect(result.stats.overtureFailed).toBeUndefined();
    expect(result.meta.attribution).toBe('© OpenStreetMap contributors');
    expect(result.warnings).toEqual([]);
  });

  it('adds only the footprints the tiles lack', async () => {
    const progress: RenderProgress[] = [];
    const off = await service().render({ settings: settings((s) => (s.source.overtureBuildings = false)) });
    const on = await service().render({ settings: settings() }, (p) => progress.push(p));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0][0];
    expect(options.keep).toBeTypeOf('function');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.bounds.west).toBeLessThan(centre.lon);
    expect(options.bounds.east).toBeGreaterThan(centre.lon);
    expect(options.bounds.south).toBeLessThan(centre.lat);
    expect(options.bounds.north).toBeGreaterThan(centre.lat);

    // The clear ML footprint is added, the one on a tile building and the OSM one aren't.
    expect(on.stats.overtureBuildings).toBe(1);
    expect(on.stats.overtureFailed).toBeUndefined();
    expect(buildingsArea(on) - buildingsArea(off)).toBeCloseTo(SIDE * SIDE, 1);
    expect(on.meta.attribution).toBe('© OpenStreetMap contributors, Overture Maps Foundation');
    expect(toSvg(on)).toContain('Overture Maps Foundation');
    expect(on.warnings).toEqual([]);
    expect(progress.filter((p) => p.stage === 'buildings').map((p) => p.fraction)).toEqual([0, 0.5]);
    // Buildings come after the tiles and before the cleanup.
    const stages = progress.map((p) => p.stage).filter((stage, i, all) => stage !== all[i - 1]);
    expect(stages).toEqual(['tiles', 'geometry', 'buildings', 'compose']);
    // The lines are the same. Fills under the new building only lose its
    // footprint and the water's gap around it.
    const lines = (r: typeof on) => r.groups.filter((g) => g.kind === 'stroke').map((g) => [g.id, g.lengthMm, g.subpaths]);
    expect(lines(on)).toEqual(lines(off));
    for (const group of off.groups.filter((g) => g.kind === 'fill' && g.id !== 'buildings')) {
      const after = on.groups.find((g) => g.id === group.id)!;
      expect(group.areaMm2 - after.areaMm2).toBeGreaterThanOrEqual(-1e-6);
      expect(group.areaMm2 - after.areaMm2).toBeLessThan(SIDE * SIDE * 3);
    }
  });

  it('downloads once per area, and turning it off goes back to the same map', async () => {
    const svc = service();
    const fresh = await service().render({ settings: settings((s) => (s.source.overtureBuildings = false)) });
    await svc.render({ settings: settings() });
    await svc.render({ settings: settings((s) => (s.style.colors.buildings = '#123456')) });
    const off = await svc.render({ settings: settings((s) => (s.source.overtureBuildings = false)) });
    const on = await svc.render({ settings: settings() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(off.groups).toEqual(fresh.groups);
    expect(toSvg(off)).toEqual(toSvg(fresh));
    expect(off.stats.overtureBuildings).toBeUndefined();
    expect(on.stats.overtureBuildings).toBe(1);

    // A new area is a new download.
    await svc.render({ settings: settings((s) => (s.area = { ...s.area, widthM: 1100 })) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('works in every output mode', async () => {
    for (const mode of ['laser', 'plotter', 'print'] as const) {
      const pick = (s: RenderSettings) => {
        const d = defaultRenderSettings(mode);
        s.mode = mode;
        s.style = d.style;
        s.cleanup = d.cleanup;
      };
      const off = await service().render({ settings: settings((s) => (pick(s), (s.source.overtureBuildings = false))) });
      const on = await service().render({ settings: settings(pick) });
      expect(on.stats.overtureBuildings).toBe(1);
      const group = (r: typeof on) => r.groups.find((g) => g.id === 'buildings')!;
      // Plotter buildings are hatched lines, so there's more of them rather than more area.
      if (mode === 'plotter') expect(group(on).lengthMm).toBeGreaterThan(group(off).lengthMm);
      else expect(group(on).areaMm2 - group(off).areaMm2).toBeCloseTo(SIDE * SIDE, 1);
    }
  });

  it('checks the footprints again against a tile that comes in late, without downloading them again', async () => {
    // Wide enough to need the tiles around the fixture's, which come back empty.
    const wide = settings((s) => (s.area = { ...s.area, widthM: 3000 }));
    expect(planTiles(wide.area, layout, wide.source).tiles.length).toBeGreaterThan(1);
    let tileUp = false;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/14/2589/5606.pbf')) return tileUp ? new Response(tile.slice()) : new Response(null, { status: 503 });
      return new Response(null, { status: 204 });
    });
    const svc = service();
    const first = await svc.render({ settings: wide });
    expect(first.stats.missingTiles).toBe(1);
    // With no tile buildings to compare with, the ML footprint on one is added too.
    expect(first.stats.overtureBuildings).toBe(2);

    tileUp = true;
    const second = await svc.render({ settings: wide });
    expect(second.stats.missingTiles).toBe(0);
    expect(second.stats.overtureBuildings).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('downloads nothing with the buildings layer off', async () => {
    const result = await service().render({ settings: settings((s) => (s.layers = { ...s.layers, buildings: false })) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.groups.find((g) => g.id === 'buildings')).toBeUndefined();
    expect(result.meta.attribution).toBe('© OpenStreetMap contributors');
  });

  it('only adds them at full detail, and draws the same map as without', async () => {
    const off = await service().render({ settings: settings((s) => ((s.source.maxZoom = 13), (s.source.overtureBuildings = false))) });
    const result = await service().render({ settings: settings((s) => (s.source.maxZoom = 13)) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.stats.zoom).toBe(13);
    expect(result.stats.overtureBuildings).toBe(0);
    expect(result.stats.overtureFailed).toBeUndefined();
    // Only the fixture's zoom 14 tile has data, so these tiles are all empty.
    expect(result.warnings).toEqual([expect.stringMatching(/all empty/), expect.stringMatching(/only added at full detail \(zoom 14\)/)]);
    expect(result.groups).toEqual(off.groups);
    expect(result.meta.attribution).toBe('© OpenStreetMap contributors');
  });

  it("shares the tiles' unions when nothing is added", async () => {
    type Internals = { buildings: { base: { memo: unknown }; entry: { memo: unknown } } };
    fetchMock.mockImplementation(async (options) => ({ ...answer(options), features: { building: [] } }));
    const svc = service();
    const off = await svc.render({ settings: settings((s) => (s.source.overtureBuildings = false)) });
    const on = await svc.render({ settings: settings() });
    expect(on.stats.overtureBuildings).toBe(0);
    expect(on.groups).toEqual(off.groups);
    // Nothing added means no Overture credit either.
    expect(on.meta.attribution).toBe('© OpenStreetMap contributors');
    const shared = (svc as unknown as Internals).buildings;
    expect(shared.entry.memo).toBe(shared.base.memo);

    // With a building added they have to be their own.
    fetchMock.mockImplementation(async (options) => answer(options));
    const other = service();
    await other.render({ settings: settings() });
    const own = (other as unknown as Internals).buildings;
    expect(own.entry.memo).not.toBe(own.base.memo);
  });

  it('draws the map without them when Overture fails, and tries again a minute later', async () => {
    fetchMock.mockRejectedValue(new OvertureUnavailableError(false));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const svc = service();
    const first = await svc.render({ settings: settings() });
    expect(first.stats.overtureBuildings).toBe(0);
    expect(first.stats.overtureFailed).toBe(true);
    expect(first.warnings).toEqual([expect.stringMatching(/couldn't be downloaded.*busy/)]);
    expect(first.groups.find((g) => g.id === 'buildings')).toBeDefined();

    await svc.render({ settings: settings((s) => (s.style.colors.water = '#000000')) });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_061_000);
    fetchMock.mockImplementation(async (options) => answer(options));
    const later = await svc.render({ settings: settings() });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(later.stats.overtureBuildings).toBe(1);
    expect(later.stats.overtureFailed).toBeUndefined();
    expect(later.warnings).toEqual([]);
  });

  it('says why when the download fails on something other than the servers', async () => {
    fetchMock.mockRejectedValue(new Error('Overture release 2026-09-23.1 has no buildings data.'));
    const result = await service().render({ settings: settings() });
    expect(result.warnings).toEqual([
      "Buildings from Overture couldn't be downloaded, so the map has the tiles' buildings only. Overture release 2026-09-23.1 has no buildings data.",
    ]);
    expect(result.stats.overtureFailed).toBe(true);
  });

  it('leaves them out of a map too big for them, for good', async () => {
    fetchMock.mockRejectedValue(new OvertureTooLargeError(212e6, { building: 212e6 }, 'building'));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const svc = service();
    const result = await svc.render({ settings: settings() });
    expect(result.warnings).toEqual([expect.stringMatching(/would need 212 MB of building data, over the 150 MB limit/)]);
    // Not a failure: trying again won't help.
    expect(result.stats.overtureFailed).toBeUndefined();
    now.mockReturnValue(9_000_000);
    await svc.render({ settings: settings() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Downloads that never finish on their own, but stop when aborted.
  function hangingDownloads() {
    const calls: { options: FetchOvertureOptions; finish: () => void }[] = [];
    fetchMock.mockImplementation(
      (options) =>
        new Promise((resolve, reject) => {
          calls.push({ options, finish: () => resolve(answer(options)) });
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason));
        }),
    );
    return calls;
  }

  it('keeps the download going for the next render when one is cancelled', async () => {
    const calls = hangingDownloads();
    let cancelled = false;
    const svc = service();
    const first = svc.render({ settings: settings() }, () => {}, () => cancelled);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    cancelled = true;
    await expect(first).rejects.toBeInstanceOf(CancelledError);
    expect(calls[0].options.signal!.aborted).toBe(false);

    // A settings change picks up the same download, along with its progress so far.
    const progress: RenderProgress[] = [];
    const second = svc.render({ settings: settings((s) => (s.style.colors.water = '#000000')) }, (p) => progress.push(p));
    await vi.waitFor(() => expect(progress.some((p) => p.stage === 'buildings')).toBe(true));
    calls[0].finish();
    expect((await second).stats.overtureBuildings).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops the download once a render wants another area or no buildings', async () => {
    const calls = hangingDownloads();
    let cancelled = false;
    const svc = service();
    void svc.render({ settings: settings() }, () => {}, () => cancelled).catch(() => {});
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    cancelled = true;
    await svc.render({ settings: settings((s) => (s.source.overtureBuildings = false)) });
    expect(calls[0].options.signal!.aborted).toBe(true);

    cancelled = false;
    void svc.render({ settings: settings() }, () => {}, () => cancelled).catch(() => {});
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    cancelled = true;
    fetchMock.mockImplementation(async (options) => answer(options));
    await svc.render({ settings: settings((s) => (s.area = { ...s.area, widthM: 1100 })) });
    expect(calls[1].options.signal!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("can't add them to a map across the antimeridian", async () => {
    const result = await service().render({
      settings: settings((s) => (s.area = { lon: 179.995, lat: -16.5, bearing: 0, widthM: 2000 })),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // The stubbed tiles there are empty.
    expect(result.warnings).toEqual([expect.stringMatching(/all empty/), expect.stringMatching(/180th meridian/)]);
  });
});
