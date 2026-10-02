import { describe, expect, it } from 'vitest';
import { lonLatToWorld } from '../geo/mercator.ts';
import { makeTransform } from '../geo/transform.ts';
import { computeLayout } from '../layout/layout.ts';
import { insetShape, shapeCentre, shapeContains } from '../layout/shapes.ts';
import { DEFAULT_BORDER } from '../layout/layout.ts';
import { DEFAULT_PRODUCT } from '../presets.ts';
import { fitArea } from './fit.ts';
import { RouteFileError, parseRouteFile } from './parse.ts';
import { type LonLat, decodePolyline, encodePolyline } from './polyline.ts';
import { MAX_ROUTE_LINES, MAX_ROUTE_POINTS, decodeRoute, encodeRoute, routeLengthM, simplifyRoute } from './route.ts';

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const parse = (name: string, text: string) => parseRouteFile(name, bytes(text));

// Metres to degrees near the equator, close enough for building test tracks.
const M = 1 / 111_320;

function zip(name: string, data: Uint8Array, method: 0 | 8, compressed: Uint8Array = data): ArrayBuffer {
  const nameBytes = new TextEncoder().encode(name);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, method, true);
  local.setUint32(18, compressed.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, nameBytes.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(10, method, true);
  central.setUint32(20, compressed.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, nameBytes.length, true);
  central.setUint32(42, 0, true);
  const localSize = 30 + nameBytes.length + compressed.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true);
  end.setUint32(16, localSize, true);
  const parts = [new Uint8Array(local.buffer), nameBytes, compressed, new Uint8Array(central.buffer), nameBytes, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('encoded polylines', () => {
  it('round-trip to six decimals', () => {
    const points: LonLat[] = [
      [-87.623177, 41.881832],
      [-87.6, 41.9],
      [179.999999, -85],
      [-180, 89.999999],
    ];
    const decoded = decodePolyline(encodePolyline(points));
    expect(decoded).toHaveLength(points.length);
    decoded.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(points[i][0], 6);
      expect(p[1]).toBeCloseTo(points[i][1], 6);
    });
  });

  it('only use characters that are safe in JSON and links', () => {
    expect(encodePolyline([[-122.4, 37.8], [-122.41, 37.79]])).toMatch(/^[?-~]+$/);
  });

  it('stop at text that is not a polyline instead of throwing', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline('not a polyline at all')).toEqual(expect.any(Array));
    expect(decodePolyline('~~~~~~~~~~~~~~~~~')).toEqual([]);
  });
});

describe('simplifying routes', () => {
  it('drops points that are within a metre of the line', () => {
    const wobbly: LonLat[] = Array.from({ length: 1000 }, (_, i) => [i * 2 * M, (i % 2 ? 0.3 : -0.3) * M]);
    const [line] = simplifyRoute([wobbly]);
    expect(line.length).toBeLessThan(5);
    expect(line[0]).toEqual(wobbly[0]);
    expect(line[line.length - 1]).toEqual(wobbly[wobbly.length - 1]);
  });

  it('keeps real corners', () => {
    const zigzag: LonLat[] = Array.from({ length: 21 }, (_, i) => [i * 50 * M, (i % 2) * 20 * M]);
    expect(simplifyRoute([zigzag])[0]).toHaveLength(21);
  });

  it('gets coarser until a long noisy track fits', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const noisy: LonLat[] = Array.from({ length: 40_000 }, (_, i) => [i * 3 * M + random() * 4 * M, Math.sin(i / 500) * 2000 * M + random() * 4 * M]);
    const total = simplifyRoute([noisy]).reduce((n, l) => n + l.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(total).toBeGreaterThan(100);
  });

  // This used to run Douglas-Peucker again for every step up in tolerance and
  // took minutes on a million points.
  it('thins out a huge noisy track without hanging', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const noisy: LonLat[] = Array.from({ length: 500_000 }, (_, i) => [i * 0.1 * M + random() * 5 * M, random() * 5 * M]);
    const [line] = simplifyRoute([noisy]);
    expect(line.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(line[0]).toEqual(noisy[0]);
    expect(line[line.length - 1]).toEqual(noisy[noisy.length - 1]);
  });

  it('stays under the cap with lots of short lines', () => {
    const lines: LonLat[][] = Array.from({ length: 8000 }, (_, i) => [
      [i * 100 * M, 0],
      [i * 100 * M + (i % 50) * M, 10 * M],
    ]);
    const out = simplifyRoute(lines);
    expect(out).toHaveLength(MAX_ROUTE_LINES);
    expect(out.reduce((n, l) => n + l.length, 0)).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    // The longest ones are kept.
    expect(out.every((line) => routeLengthM([line]) > 44)).toBe(true);
  });

  it('measure and decode what they encode', () => {
    const line: LonLat[] = [
      [0, 0],
      [1000 * M, 0],
    ];
    const encoded = encodeRoute([line]);
    expect(routeLengthM(decodeRoute({ lines: encoded }))).toBeCloseTo(1000, -1);
    // Anything off the globe is dropped, the rest is kept.
    expect(decodeRoute({ lines: [encodePolyline([[0, 95], [0, 96]]), ...encoded] })).toHaveLength(1);
  });
});

describe('reading route files', () => {
  it('reads GPX tracks and joins the segments a pause splits', async () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
      <!-- exported -->
      <gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
        <metadata><name>Fish &amp; Chips Loop</name></metadata>
        <wpt lat="0" lon="0"><name>Aid station</name></wpt>
        <trk><name>Morning Run</name>
          <trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="${100 * M}"><ele>4</ele></trkpt></trkseg>
          <trkseg><trkpt lat="0" lon="${200 * M}"></trkpt><trkpt lat="0" lon="${300 * M}"/></trkseg>
        </trk>
        <trk><trkseg><trkpt lat="${5000 * M}" lon="0"/><trkpt lat="${5100 * M}" lon="0"/></trkseg></trk>
      </gpx>`;
    const route = await parse('run.gpx', gpx);
    expect(route.name).toBe('Fish & Chips Loop');
    // The pause is joined, the second track 5 km away isn't.
    expect(route.lines.map((l) => l.length)).toEqual([4, 2]);
  });

  it('reads GPX routes and falls back to the track name, then the file name', async () => {
    const route = await parse('x.gpx', `<gpx><rte><name><![CDATA[Ride <north>]]></name><rtept lat="1" lon="2"/><rtept lat="1.01" lon="2"/></rte></gpx>`);
    expect(route).toEqual({ name: 'Ride <north>', lines: [[[2, 1], [2, 1.01]]] });
    const unnamed = await parse('C:\\Users\\me\\Downloads\\Evening Ride.gpx', `<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.01" lon="2"/></trkseg></trk></gpx>`);
    expect(unnamed.name).toBe('Evening Ride');
  });

  it('reads KML lines, shapes and Google Earth tracks', async () => {
    const kml = `<?xml version="1.0"?>
      <kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
        <Document><name>Course.kml</name>
          <Placemark><name>Start</name><Point><coordinates>1,1</coordinates></Point></Placemark>
          <Placemark><name>Course</name><LineString><coordinates>
            1,1,0 1.01,1,0
            1.02, 1.01
          </coordinates></LineString></Placemark>
          <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>3,3 3.01,3 3.01,3.01 3,3</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
          <Placemark><gx:Track><when>2024</when><gx:coord>5 5 10</gx:coord><gx:coord>5.01 5 10</gx:coord></gx:Track></Placemark>
        </Document>
      </kml>`;
    const route = await parse('course.kml', kml);
    expect(route.name).toBe('Course');
    expect(route.lines).toEqual([
      [[1, 1], [1.01, 1], [1.02, 1.01]],
      [[3, 3], [3.01, 3], [3.01, 3.01], [3, 3]],
      [[5, 5], [5.01, 5]],
    ]);
  });

  it('reads the KML inside a KMZ, stored or deflated', async () => {
    const kml = new TextEncoder().encode('<kml><Placemark><name>Zipped</name><LineString><coordinates>1,1 1.01,1</coordinates></LineString></Placemark></kml>');
    for (const kmz of [zip('doc.kml', kml, 0), zip('doc.kml', kml, 8, await deflate(kml))]) {
      const route = await parseRouteFile('map.kmz', kmz);
      expect(route).toEqual({ name: 'Zipped', lines: [[[1, 1], [1.01, 1]]] });
    }
    await expect(parseRouteFile('empty.kmz', zip('image.png', kml, 0))).rejects.toThrow('no KML');
  });

  it('reads TCX activities and skips points without a position', async () => {
    const tcx = `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
      <Activities><Activity Sport="Running"><Id>2024-10-13</Id><Lap><Track>
        <Trackpoint><Position><LatitudeDegrees>41.88</LatitudeDegrees><LongitudeDegrees>-87.62</LongitudeDegrees></Position></Trackpoint>
        <Trackpoint><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Position><LatitudeDegrees>41.89</LatitudeDegrees><LongitudeDegrees>-87.62</LongitudeDegrees></Position></Trackpoint>
      </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const route = await parse('chicago.tcx', tcx);
    expect(route).toEqual({ name: 'chicago', lines: [[[-87.62, 41.88], [-87.62, 41.89]]] });
  });

  it('reads GeoJSON lines and polygons', async () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
        { type: 'Feature', properties: { name: 'Canal path' }, geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0, 12]] } },
        { type: 'Feature', properties: null, geometry: { type: 'MultiLineString', coordinates: [[[1, 1], [1.01, 1]], [[2, 2], [2.01, 2]]] } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[3, 3], [3.01, 3], [3, 3.01], [3, 3]]] } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[null, 1], ['4', 4]] } },
      ],
    };
    const route = await parse('paths.geojson', '\uFEFF' + JSON.stringify(geojson));
    expect(route.name).toBe('Canal path');
    expect(route.lines).toHaveLength(4);
  });

  it('joins converted GPS tracks like GPX segments', async () => {
    const feature = {
      type: 'Feature',
      properties: { coordTimes: [] },
      geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [100 * M, 0]], [[150 * M, 0], [250 * M, 0]]] },
    };
    expect((await parse('t.json', JSON.stringify(feature))).lines).toHaveLength(1);
  });

  it('splits a line where it crosses the 180th meridian', async () => {
    const route = await parse('ferry.gpx', `<gpx><trk><trkseg><trkpt lat="0" lon="179.9"/><trkpt lat="0" lon="179.99"/><trkpt lat="0" lon="-179.99"/><trkpt lat="0" lon="-179.9"/></trkseg></trk></gpx>`);
    expect(route.lines).toHaveLength(2);
  });

  it('explains files it cannot use', async () => {
    const fit = new Uint8Array(16);
    fit.set(new TextEncoder().encode('.FIT'), 8);
    await expect(parseRouteFile('ride.fit', fit.buffer)).rejects.toThrow(/FIT files can't be read/);
    await expect(parse('notes.txt', 'just some text')).rejects.toThrow(RouteFileError);
    await expect(parse('page.html', '<html><body></body></html>')).rejects.toThrow(/doesn't look like/);
    await expect(parse('bad.geojson', '{"type": ')).rejects.toThrow(/couldn't be read/);
    await expect(parse('poi.gpx', '<gpx><wpt lat="1" lon="1"/></gpx>')).rejects.toThrow(/only has points/);
    await expect(parse('empty.gpx', '<gpx></gpx>')).rejects.toThrow(/no tracks/);
    const network = { type: 'MultiLineString', coordinates: Array.from({ length: 1001 }, (_, i) => [[i * 0.01, 0], [i * 0.01, 0.005]]) };
    await expect(parse('roads.geojson', JSON.stringify(network))).rejects.toThrow(/1,001 separate lines/);
  });
});

describe('fitting the map to a route', () => {
  const layout = computeLayout(DEFAULT_PRODUCT.product, { ...DEFAULT_BORDER, style: DEFAULT_PRODUCT.border });
  const { window } = layout;
  // About 6 km east to west and 2 km north to south, in Chicago.
  const route: LonLat[][] = [
    [
      [-87.7, 41.88],
      [-87.66, 41.89],
      [-87.64, 41.87],
      [-87.628, 41.895],
    ],
  ];

  const onPiece = (area: { lon: number; lat: number; bearing: number; widthM: number }, lines = route) => {
    const t = makeTransform(area, 14, shapeCentre(window), window.w);
    return lines.flatMap((line) => line.map(([lon, lat]) => t.toCanvas(...lonLatToWorld(lon, lat, 14))));
  };

  it('fills the window with the route, leaving the margin', () => {
    const area = fitArea(route, { window, avoid: null, bearing: 0, rotate: false, margin: 5 })!;
    const points = onPiece(area);
    const inner = insetShape(window, 5 - 0.01);
    expect(points.every((p) => shapeContains(inner, p))).toBe(true);
    const xs = points.map((p) => p[0]);
    // Wide route, wide window: it touches the margin on the sides.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(window.w - 10, 1);
    expect(area.bearing).toBe(0);
  });

  it('keeps the route out of a title band', () => {
    const band: [number, number, number, number] = [window.x, window.y + window.h * 0.75, window.w, window.h * 0.25];
    const area = fitArea(route, { window, avoid: band, bearing: 0, rotate: false, margin: 3 })!;
    expect(onPiece(area).every((p) => p[1] < band[1])).toBe(true);
  });

  it('goes under a title that covers most of the window instead of squeezing beside it', () => {
    const big: [number, number, number, number] = [window.x + 8, window.y + 8, window.w - 16, window.h - 16];
    const free = fitArea(route, { window, avoid: null, bearing: 0, rotate: false, margin: 3 })!;
    const area = fitArea(route, { window, avoid: big, bearing: 0, rotate: false, margin: 3 })!;
    expect(area.widthM).toBeCloseTo(free.widthM, 0);
  });

  it('turns the map when that shows the route a lot bigger', () => {
    // North to south, on a landscape piece.
    const northSouth: LonLat[][] = [
      [
        [-87.65, 41.8],
        [-87.645, 41.95],
      ],
    ];
    const straight = fitArea(northSouth, { window, avoid: null, bearing: 0, rotate: false, margin: 5 })!;
    const turned = fitArea(northSouth, { window, avoid: null, bearing: 0, rotate: true, margin: 5 })!;
    // Along the window's diagonal, not all the way to 90.
    expect(Math.abs(turned.bearing)).toBeGreaterThan(40);
    expect(Math.abs(turned.bearing)).toBeLessThan(70);
    expect(turned.widthM).toBeLessThan(straight.widthM * 0.65);
    const points = onPiece(turned, northSouth);
    expect(points.every((p) => shapeContains(insetShape(window, 4.99), p))).toBe(true);
  });

  it('stays north up when turning would only gain a little', () => {
    // A loop with the window's own shape.
    const lat = 41.88;
    const w = 1600 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const h = (1600 * (window.h / window.w)) / 111_320;
    const loop: LonLat[][] = [
      [
        [-87.65, lat],
        [-87.65 + w, lat],
        [-87.65 + w, lat + h],
        [-87.65, lat + h],
        [-87.65, lat],
      ],
    ];
    expect(fitArea(loop, { window, avoid: null, bearing: 0, rotate: true, margin: 5 })!.bearing).toBe(0);
  });

  // Math.min(...points) ran out of stack at around 300,000 points.
  it('fits a route with a lot of points', () => {
    const long: LonLat[][] = [Array.from({ length: 500_000 }, (_, i) => [-87.7 + i * 1e-7, 41.88 + Math.sin(i / 5000) * 0.01])];
    const area = fitArea(long, { window, avoid: null, bearing: 0, rotate: false, margin: 5 });
    expect(area).not.toBeNull();
    expect(area!.lat).toBeCloseTo(41.88, 2);
  });

  it('only moves the map when the scale is locked', () => {
    const area = fitArea(route, { window, avoid: null, bearing: 15, rotate: false, margin: 5, widthM: 20_000 })!;
    expect(area.widthM).toBe(20_000);
    expect(area.bearing).toBe(15);
    const [cx, cy] = shapeCentre(window);
    const points = onPiece(area);
    const mid = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
    expect(Math.hypot(mid[0] - cx, mid[1] - cy)).toBeLessThan(20);
  });
});
