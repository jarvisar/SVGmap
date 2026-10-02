import { describe, expect, it } from 'vitest';
import { importRouteFiles } from './routes.ts';
import { useApp } from './store.ts';

const gpx = (i: number) =>
  new File(
    [`<gpx><trk><name>Run ${i}</name><trkseg><trkpt lat="41.88" lon="${-87.62 + i / 1000}"/><trkpt lat="41.89" lon="${-87.62 + i / 1000}"/></trkseg></trk></gpx>`],
    `run-${i}.gpx`,
  );

describe('importing routes', () => {
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
