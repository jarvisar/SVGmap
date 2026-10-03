import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importRouteFiles } from './routes.ts';
import { useApp } from './store.ts';
import { MAX_FILE_BYTES } from '../engine/routes/parse.ts';
import { defaultSettings } from './settings.ts';
import { quietly, redoChange, startUndo, undoChange, useUndo } from './undo.ts';

beforeEach(() => {
  startUndo();
  quietly(() => {
    useApp.getState().set(defaultSettings());
    useApp.getState().setLabel({ enabled: false });
  });
  useUndo.setState({ past: [], future: [] });
});

const gpx = (i: number) =>
  new File(
    [`<gpx><trk><name>Run ${i}</name><trkseg><trkpt lat="41.88" lon="${-87.62 + i / 1000}"/><trkpt lat="41.89" lon="${-87.62 + i / 1000}"/></trkseg></trk></gpx>`],
    `run-${i}.gpx`,
  );

describe('importing routes', () => {
  it('rejects a route that collapses when its coordinates are saved', async () => {
    const file = new File(['<gpx><rte><rtept lon="0" lat="0"/><rtept lon="0.0000001" lat="0"/></rte></gpx>'], 'tiny.gpx');
    const result = await importRouteFiles([file]);
    expect(result.errors).toEqual(['tiny.gpx: This route is too short to draw.']);
    expect(useApp.getState().routes.items).toHaveLength(0);
  });
  it('rejects an oversized file before reading it into memory', async () => {
    const read = vi.fn();
    const file = { name: 'huge.gpx', size: MAX_FILE_BYTES + 1, arrayBuffer: read } as unknown as File;
    const result = await importRouteFiles([file]);
    expect(read).not.toHaveBeenCalled();
    expect(result.errors).toEqual(['huge.gpx: This file is over 50 MB.']);
    expect(result.added).toEqual([]);
  });

  it('adds valid files from a mixed batch and undoes the import and fit together', async () => {
    const area = useApp.getState().area;
    const result = await importRouteFiles([gpx(1), new File(['<gpx><trk>'], 'broken.gpx'), gpx(2)]);
    expect(result.added).toEqual(['Run 1', 'Run 2']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('XML');
    expect(useUndo.getState().past).toHaveLength(1);
    expect(undoChange()).toBe(true);
    expect(useApp.getState().routes.items).toEqual([]);
    expect(useApp.getState().area).toEqual(area);
    expect(redoChange()).toBe(true);
    expect(useApp.getState().routes.items).toHaveLength(2);
  });
  it('stays under the limit when two imports overlap', async () => {
    // No title, so fitting the map doesn't need the fonts.
    useApp.getState().setLabel({ enabled: false });
    const batch = (from: number) => Array.from({ length: 30 }, (_, i) => gpx(from + i));
    const [first, second] = await Promise.all([importRouteFiles(batch(0)), importRouteFiles(batch(30))]);
    expect(first.added).toHaveLength(30);
    expect(second.added).toHaveLength(20);
    expect(second.errors).toHaveLength(10);
    expect(useApp.getState().routes.items).toHaveLength(50);
  });
});
