import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRenderSettings } from '../defaults.ts';
import { RenderService } from '../service.ts';
import { TileSource } from './source.ts';

const TEMPLATE = 'https://tiles.test/{z}/{x}/{y}.pbf';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('tile downloads', () => {
  it('give up on a tile that stops sending', async () => {
    vi.useFakeTimers();
    // Never answers, but lets go when aborted.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const tile = new TileSource(TEMPLATE).get({ z: 14, x: 4201, y: 6089 });
    const failed = expect(tile).rejects.toThrow(/No data from/);
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
  });

  it('abort a PMTiles header that never comes, and ask for it again next time', async () => {
    vi.useFakeTimers();
    const requests: AbortSignal[] = [];
    // Never answers, but lets go when aborted like a real fetch.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      requests.push(init!.signal!);
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    const source = new TileSource('https://tiles.test/map.pmtiles');
    const first = expect(source.get({ z: 14, x: 4201, y: 6089 })).rejects.toThrow(/No answer from/);
    await vi.advanceTimersByTimeAsync(60_000);
    await first;
    const second = expect(source.get({ z: 14, x: 4201, y: 6089 })).rejects.toThrow(/No answer from/);
    await vi.advanceTimersByTimeAsync(60_000);
    await second;
    // Two header reads, and neither is left holding a connection.
    expect(requests).toHaveLength(2);
    expect(requests.every((signal) => signal.aborted)).toBe(true);
  });
});

describe('render service', () => {
  it('tries missing tiles again on the next render', async () => {
    const settings = defaultRenderSettings('laser');
    settings.source = { ...settings.source, tiles: TEMPLATE };
    settings.label = { ...settings.label, enabled: false };
    let down: string | null = null;
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      down ??= url;
      // One tile fails, the rest are empty sea.
      return new Response(null, { status: url === down ? 503 : 404 });
    });
    const service = new RenderService(async () => new ArrayBuffer(0));

    const first = await service.render({ settings });
    expect(first.warnings.some((w) => w.includes('1 map tile(s) could not be downloaded'))).toBe(true);
    const tiles = new Set(requested).size;
    expect(requested.filter((url) => url === down)).toHaveLength(3);

    // Still down: one more try, nothing else downloaded.
    requested.length = 0;
    const second = await service.render({ settings });
    expect(requested).toEqual([down]);
    expect(second.warnings.some((w) => w.includes('could not be downloaded'))).toBe(true);

    // Back up: the map is complete, and later renders download nothing.
    const missing = down;
    down = 'none';
    requested.length = 0;
    const third = await service.render({ settings });
    expect(requested).toEqual([missing]);
    expect(third.warnings.some((w) => w.includes('could not be downloaded'))).toBe(false);
    requested.length = 0;
    await service.render({ settings });
    expect(requested).toEqual([]);
    expect(tiles).toBeGreaterThan(1);
  });

  it('says why no map data could be downloaded', async () => {
    const settings = defaultRenderSettings('laser');
    // A MapLibre style pasted in place of TileJSON.
    settings.source = { ...settings.source, tiles: 'https://tiles.test/styles/liberty' };
    settings.label = { ...settings.label, enabled: false };
    vi.stubGlobal('fetch', async () => Response.json({ version: 8, sources: {}, layers: [] }));
    const render = new RenderService(async () => new ArrayBuffer(0)).render({ settings });
    await expect(render).rejects.toThrow(/Could not download any map data.*Last error: The tile source is not a TileJSON document/);
  });

  it('warns when every tile is empty', async () => {
    const settings = defaultRenderSettings('laser');
    settings.source = { ...settings.source, tiles: TEMPLATE };
    settings.label = { ...settings.label, enabled: false };
    // A wrong path or extension.
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }));
    const result = await new RenderService(async () => new ArrayBuffer(0)).render({ settings });
    expect(result.warnings).toEqual([expect.stringMatching(/tiles for this area are all empty/)]);
  });
});
