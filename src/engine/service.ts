// Runs a render. Keeps raw tiles, the current area's prepared geometry, layer
// unions and fonts between renders, so changing a setting doesn't download or
// decode anything again. Runs in a web worker in the app and directly in tests.
import type { Paths64 } from 'clipper2-ts';
import { compose } from './compose.ts';
import type { MapTransform } from './geo/transform.ts';
import { type Layout, computeLayout } from './layout/layout.ts';
import { clampRenderSettings } from './limits.ts';
import { isMissingFromOsm, missingBuildings, projectFootprints, windowBounds } from './overture.ts';
import { type Prepared, type TileData, type TilePlan, planTiles, prepareArea, tileKey, windowClipRect } from './prepare.ts';
import type { Path } from './lines/geometry.ts';
import type { RenderResult } from './result.ts';
import type { RenderSettings } from './settings.ts';
import { isSidepath, leaveOutSidepaths, projectSidepaths, sidepathTolerance } from './sidewalks.ts';
import { usesSubtitleFont } from './text/label.ts';
import { type CustomFont, FontLoader } from './text/loadFont.ts';
import type { LoadedFont } from './text/outline.ts';
import { TileCache, TileSource } from './tiles/source.ts';

export type { CustomFont };

export interface RenderRequest {
  settings: RenderSettings;
  customFont?: CustomFont | null;
}

export type RenderStage = 'tiles' | 'geometry' | 'buildings' | 'sidewalks' | 'compose';

export interface RenderProgress {
  stage: RenderStage;
  message: string;
  done?: number;
  total?: number;
  /** How far along the stage is, 0 to 1, for one that isn't counted in tiles. */
  fraction?: number;
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

interface PreparedEntry {
  key: string;
  value: Prepared;
  memo: Map<string, Paths64>;
}

// Overture's footprints for one map window, or why there are none.
interface FootprintEntry {
  key: string;
  footprints: Paths64[];
  warning?: string;
  // A failed download is tried again after this, not on every settings change.
  retryAt?: number;
}

// The prepared tiles with Overture's buildings added, and its own unions.
interface BuildingsEntry {
  base: PreparedEntry;
  footprints: FootprintEntry;
  entry: PreparedEntry;
}

// Overture's sidewalks and crossings for one map window, in canvas mm, or why
// there are none.
interface SidewalkEntry {
  key: string;
  sidepaths: Path[];
  warning?: string;
  retryAt?: number;
}

// The prepared lines with the sidewalks and crossings left out.
interface SidewalksLeftOut {
  base: PreparedEntry;
  sidewalks: SidewalkEntry;
  entry: PreparedEntry;
}

// Overture downloads of one kind. A cancelled render stops waiting on one but
// leaves it running, so changing a setting while it runs doesn't start it
// over. It's only stopped once a render wants another area or none of it.
class KeptDownload<T extends { key: string; retryAt?: number }> {
  // The last one that finished.
  private done: T | null = null;
  private running: {
    key: string;
    controller: AbortController;
    entry: Promise<T>;
    // The newest render waiting on it, which also gets the last progress sent.
    onProgress: (progress: RenderProgress) => void;
    progress?: RenderProgress;
  } | null = null;

  /** Stops a download for any other key, or any download for null. */
  keepOnly(key: string | null): void {
    if (this.running && this.running.key !== key) {
      this.running.controller.abort();
      this.running = null;
    }
  }

  /** What finished for this key, unless it failed and is due to be tried again. */
  ready(key: string): T | null {
    const done = this.done?.key === key ? this.done : null;
    return done && (done.retryAt === undefined || Date.now() < done.retryAt) ? done : null;
  }

  wait(
    key: string,
    fetch: (signal: AbortSignal, onProgress: (progress: RenderProgress) => void) => Promise<T>,
    onProgress: (progress: RenderProgress) => void,
    isCancelled: () => boolean,
  ): Promise<T> {
    let download = this.running?.key === key ? this.running : null;
    if (download) {
      download.onProgress = onProgress;
      if (download.progress) onProgress(download.progress);
    } else {
      this.keepOnly(null);
      const started = { key, controller: new AbortController(), onProgress } as NonNullable<typeof this.running>;
      const report = (progress: RenderProgress) => {
        started.progress = progress;
        started.onProgress(progress);
      };
      // Kept here rather than by the render, which may be cancelled by the time it's done.
      started.entry = fetch(started.controller.signal, report).then((entry) => (this.done = entry));
      const finished = () => {
        if (this.running === started) this.running = null;
      };
      started.entry.then(finished, finished);
      this.running = download = started;
    }
    const { entry } = download;
    return new Promise((resolve, reject) => {
      const watch = setInterval(() => {
        if (!isCancelled()) return;
        clearInterval(watch);
        reject(new CancelledError());
      }, 100);
      entry.then(resolve, reject).finally(() => clearInterval(watch));
    });
  }
}

const buildingsKey = (preparedKey: string) => JSON.stringify([preparedKey, 'buildings']);
const sidewalksKey = (preparedKey: string) => JSON.stringify([preparedKey, 'sidewalks']);

// Yield so a newer request can cancel this one.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// The tiles' buildings are only complete at zoom 14, so footprints added to
// fewer would stand out.
const BUILDINGS_ZOOM = 14;
const BUILDINGS_RETRY_MS = 60_000;

export class RenderService {
  private readonly tiles = new TileCache();
  private readonly sources = new Map<string, TileSource>();
  private prepared: PreparedEntry | null = null;
  private readonly footprints = new KeptDownload<FootprintEntry>();
  private buildings: BuildingsEntry | null = null;
  private readonly sidepaths = new KeptDownload<SidewalkEntry>();
  private sidewalks: SidewalksLeftOut | null = null;
  private readonly fonts: FontLoader;

  constructor(loadAsset: (path: string) => Promise<ArrayBuffer>) {
    this.fonts = new FontLoader(loadAsset);
  }

  private source(url: string): TileSource {
    let source = this.sources.get(url);
    if (!source) {
      source = new TileSource(url);
      this.sources.set(url, source);
    }
    return source;
  }

  async render(
    request: RenderRequest,
    onProgress: (progress: RenderProgress) => void = () => {},
    isCancelled: () => boolean = () => false,
  ): Promise<RenderResult> {
    const settings = clampRenderSettings(request.settings);
    const layout = computeLayout(settings.product, settings.border);
    const plan = planTiles(settings.area, layout, settings.source);
    const key = JSON.stringify([settings.area, layout.window, plan.zoom, settings.source.tiles]);
    const withBuildings = settings.source.overtureBuildings && settings.layers.buildings;
    const withoutSidewalks = settings.filters.paths.skipSidewalks && settings.layers.paths;
    this.footprints.keepOnly(withBuildings ? buildingsKey(key) : null);
    this.sidepaths.keepOnly(withoutSidewalks ? sidewalksKey(key) : null);

    let entry = this.prepared?.key === key ? this.prepared : null;
    if (!entry || entry.value.missing) entry = await this.prepare(key, plan, layout, settings.source.tiles, entry, onProgress, isCancelled);
    if (withBuildings) entry = await this.addBuildings(entry, layout, onProgress, isCancelled);
    if (withoutSidewalks) entry = await this.leaveOutSidewalks(entry, sidewalksKey(key), layout, onProgress, isCancelled);

    const label = settings.label;
    let title: LoadedFont | null = null;
    let subtitle: LoadedFont | null = null;
    if (label.enabled && label.text.trim()) {
      title = await this.fonts.load(label.font, request.customFont);
      const subtitleId = label.subtitleFont || label.font;
      // A custom subtitle font left set with no subtitle failed every render once the file was gone.
      subtitle = subtitleId === label.font || !usesSubtitleFont(label) ? title : await this.fonts.load(subtitleId, request.customFont);
    }

    onProgress({ stage: 'compose', message: 'Cleaning up lines' });
    await tick();
    if (isCancelled()) throw new CancelledError();
    return compose(settings, layout, entry.value, { title, subtitle }, entry.memo);
  }

  // The tiles' geometry with Overture's missing buildings added. Kept apart
  // from the tiles' own entry, so turning it off goes back to that entry's
  // unions and nothing is downloaded again either way.
  private async addBuildings(
    base: PreparedEntry,
    layout: Layout,
    onProgress: (progress: RenderProgress) => void,
    isCancelled: () => boolean,
  ): Promise<PreparedEntry> {
    const { transform } = base.value;
    const key = buildingsKey(base.key);
    const footprints =
      this.footprints.ready(key) ??
      (await this.footprints.wait(key, (signal, report) => this.fetchFootprints(key, transform, layout, signal, report), onProgress, isCancelled));
    if (this.buildings?.base === base && this.buildings.footprints === footprints) return this.buildings.entry;
    const tileBuildings = base.value.polygons.filter((p) => p.layer === 'buildings');
    const added = missingBuildings(footprints.footprints, tileBuildings);
    const value: Prepared = {
      ...base.value,
      polygons: [...base.value.polygons, ...added],
      warnings: footprints.warning ? [...base.value.warnings, footprints.warning] : base.value.warnings,
      overtureBuildings: added.length,
      ...(footprints.retryAt !== undefined ? { overtureFailed: true } : {}),
    };
    // With nothing added the polygons are the tiles' own, so their unions are too.
    const entry = { key, value, memo: added.length ? new Map<string, Paths64>() : base.memo };
    this.buildings = { base, footprints, entry };
    return entry;
  }

  // The lines with Overture's sidewalks and crossings left out. Built on the
  // entry it's given, with or without Overture's buildings, and sharing its
  // unions, since only lines change.
  private async leaveOutSidewalks(
    base: PreparedEntry,
    key: string,
    layout: Layout,
    onProgress: (progress: RenderProgress) => void,
    isCancelled: () => boolean,
  ): Promise<PreparedEntry> {
    const { transform } = base.value;
    const sidewalks =
      this.sidepaths.ready(key) ??
      (await this.sidepaths.wait(key, (signal, report) => this.fetchSidepaths(key, transform, layout, signal, report), onProgress, isCancelled));
    if (this.sidewalks?.base === base && this.sidewalks.sidewalks === sidewalks) return this.sidewalks.entry;
    const { lines, removedMm } = leaveOutSidepaths(base.value.lines, sidewalks.sidepaths, sidepathTolerance(transform));
    const value: Prepared = {
      ...base.value,
      lines,
      warnings: sidewalks.warning ? [...base.value.warnings, sidewalks.warning] : base.value.warnings,
      sidewalksLeftOutM: removedMm * transform.metresPerMm,
      ...(sidewalks.retryAt !== undefined ? { overtureFailed: true } : {}),
    };
    const entry = { key: JSON.stringify([base.key, 'sidewalks']), value, memo: base.memo };
    this.sidewalks = { base, sidewalks, entry };
    return entry;
  }

  private async fetchSidepaths(
    key: string,
    transform: MapTransform,
    layout: Layout,
    signal: AbortSignal,
    onProgress: (progress: RenderProgress) => void,
  ): Promise<SidewalkEntry> {
    const none = (warning: string, retry = false): SidewalkEntry => ({
      key,
      sidepaths: [],
      warning,
      ...(retry ? { retryAt: Date.now() + BUILDINGS_RETRY_MS } : {}),
    });
    const bounds = windowBounds(transform, layout);
    if (!bounds) return none("Sidewalks and crossings can't be left out of a map that crosses the 180th meridian.");
    const message = 'Downloading sidewalks from Overture';
    onProgress({ stage: 'sidewalks', message, fraction: 0 });
    let reader: typeof import('./data/overture.ts') | undefined;
    try {
      reader = await import('./data/overture.ts');
      const data = await reader.fetchOverture({
        bounds,
        types: ['segment'],
        // Only their geometry is downloaded.
        keep: (_type, props) => isSidepath(props),
        signal,
        onProgress: (progress) => onProgress({ stage: 'sidewalks', message, fraction: progress.fraction }),
      });
      return { key, sidepaths: projectSidepaths(data.features.segment, transform) };
    } catch (error) {
      if (signal.aborted || error instanceof CancelledError) throw new CancelledError();
      if (reader && error instanceof reader.OvertureTooLargeError) {
        return none(
          `Sidewalks and crossings were left on the map: finding them would need ${Math.round(error.bytes / 1e6)} MB of Overture road data, over the ${reader.MAX_BYTES / 1e6} MB limit. Try a smaller map.`,
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      return none(`Sidewalks and crossings couldn't be downloaded from Overture, so they're still on the map. ${reason}`, true);
    }
  }

  private async fetchFootprints(
    key: string,
    transform: MapTransform,
    layout: Layout,
    signal: AbortSignal,
    onProgress: (progress: RenderProgress) => void,
  ): Promise<FootprintEntry> {
    const none = (warning: string, retry = false): FootprintEntry => ({
      key,
      footprints: [],
      warning,
      ...(retry ? { retryAt: Date.now() + BUILDINGS_RETRY_MS } : {}),
    });
    if (transform.zoom < BUILDINGS_ZOOM) {
      return none(`Buildings from Overture are only added at full detail (zoom ${BUILDINGS_ZOOM}), and this map uses zoom ${transform.zoom} tiles.`);
    }
    const bounds = windowBounds(transform, layout);
    if (!bounds) return none("Buildings from Overture can't be added to a map that crosses the 180th meridian.");
    const message = 'Downloading buildings from Overture';
    onProgress({ stage: 'buildings', message, fraction: 0 });
    // Loaded only when it's turned on: the Parquet reader is about 100 KB of the worker.
    let reader: typeof import('./data/overture.ts') | undefined;
    try {
      reader = await import('./data/overture.ts');
      const data = await reader.fetchOverture({
        bounds,
        keep: (_type, props) => isMissingFromOsm(props),
        signal,
        onProgress: (progress) => onProgress({ stage: 'buildings', message, fraction: progress.fraction }),
      });
      return { key, footprints: projectFootprints(data.features.building, transform, windowClipRect(layout)) };
    } catch (error) {
      if (signal.aborted || error instanceof CancelledError) throw new CancelledError();
      if (reader && error instanceof reader.OvertureTooLargeError) {
        return none(
          `Buildings from Overture were left out: this map would need ${Math.round(error.bytes / 1e6)} MB of building data, over the ${reader.MAX_BYTES / 1e6} MB limit. Try a smaller map.`,
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      return none(`Buildings from Overture couldn't be downloaded, so the map has the tiles' buildings only. ${reason}`, true);
    }
  }

  // Geometry with tiles missing is kept, but each render after it tries those
  // tiles once more. The ones that came through are in the tile cache.
  private async prepare(
    key: string,
    plan: TilePlan,
    layout: Layout,
    tiles: string,
    previous: PreparedEntry | null,
    onProgress: (progress: RenderProgress) => void,
    isCancelled: () => boolean,
  ): Promise<PreparedEntry> {
    onProgress({ stage: 'tiles', message: 'Downloading map data', done: 0, total: plan.tiles.length });
    let data: TileData;
    try {
      data = await this.tiles.fetchAll(
        this.source(tiles),
        tiles,
        plan.tiles,
        (done, total) => onProgress({ stage: 'tiles', message: 'Downloading map data', done, total }),
        isCancelled,
        6,
        previous ? 1 : 3,
      );
    } catch (error) {
      if (previous && !isCancelled()) return previous;
      throw error;
    }
    if (isCancelled()) throw new CancelledError();
    const missing = plan.tiles.filter((tile) => !data.has(tileKey(tile))).length;
    // Only rebuild when the retry got something the last geometry lacked.
    if (previous && missing >= previous.value.missing) return previous;
    onProgress({ stage: 'geometry', message: 'Building geometry' });
    await tick();
    if (isCancelled()) throw new CancelledError();
    const entry = { key, value: prepareArea(plan, layout, data), memo: new Map() };
    this.prepared = entry;
    return entry;
  }
}
