import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RouteFileError, parseRouteFile } from './parse.ts';
import { distanceM, routeLengthM } from './route.ts';

const points = '<trkpt lon="1" lat="2"/><trkpt lon="1.001" lat="2.001"/>';
const parse = (xml: string) => parseRouteFile('run.gpx', new TextEncoder().encode(xml).buffer);

describe('GPX validation', () => {
  it.each([
    `<gpx><trk><trkseg>${points}`,
    `<gpx><trk><trkseg>${points}</rte></gpx>`,
    `<gpx><trk><trkseg>${points}<trkpt lat="3" lon="4"</trkseg></trk></gpx>`,
    `<gpx><trk><trkseg>${points}</trkseg></trk></gpx><gpx/>`,
    `<gpx><trk><trkseg>${points}</trkseg></trk></gpx>trailing text`,
  ])('rejects malformed XML instead of importing partial geometry', async xml => {
    await expect(parse(xml)).rejects.toBeInstanceOf(RouteFileError);
    await expect(parse(xml)).rejects.toThrow(/XML/);
  });

  it('skips malformed coordinates rather than reading their numeric prefixes', async () => {
    const xml = `<gpx><trk><trkseg><trkpt lon="5oops" lat="2"/><trkpt lon="0x10" lat="2"/><trkpt lon="" lat="2"/>${points}</trkseg></trk></gpx>`;
    expect((await parse(xml)).lines).toEqual([[[1, 2], [1.001, 2.001]]]);
  });

  it('ignores route-like elements in extensions', async () => {
    const xml = `<gpx><rte><rtept lon="1" lat="2"><extensions><vendor:rtept lon="10" lat="20"/><vendor:trk><vendor:trkseg><vendor:trkpt lon="50" lat="50"/></vendor:trkseg></vendor:trk></extensions></rtept><rtept lon="1.001" lat="2.001"/></rte></gpx>`;
    expect((await parse(xml)).lines).toEqual([[[1, 2], [1.001, 2.001]]]);
  });

  it('still reads namespace-prefixed GPX and its entities', async () => {
    const xml = '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:metadata><g:name>Run &#x1F3C3; &amp; walk</g:name></g:metadata><g:rte><g:rtept lon="1" lat="2"/><g:rtept lon="1.001" lat="2.001"/></g:rte></g:gpx>';
    expect((await parse(xml)).name).toBe('Run 🏃 & walk');
  });

  it.each([false, true])('reads UTF-16 GPX with either byte order', async bigEndian => {
    const xml = `<?xml version="1.0" encoding="UTF-16"?><gpx><trk><name>Rivière</name><trkseg>${points}</trkseg></trk></gpx>`;
    const data = new ArrayBuffer((xml.length + 1) * 2); const view = new DataView(data);
    view.setUint16(0, 0xfeff, !bigEndian);
    for (let i = 0; i < xml.length; i++) view.setUint16((i + 1) * 2, xml.charCodeAt(i), !bigEndian);
    expect((await parseRouteFile('run.gpx', data)).name).toBe('Rivière');
  });
});

describe('bundled sample routes', () => {
  it.each([
    ['chicago-riverwalk.gpx', 7000],
    ['brooklyn-bridge-loop.gpx', 5400],
    ['lombard-coit-tower.gpx', 6700],
  ])('reads %s with the advertised length', async (file, metres) => {
    const bytes = readFileSync(`public/routes/${file}`);
    const route = await parseRouteFile(file as string, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(routeLengthM(route.lines)).toBeGreaterThan(Number(metres) * 0.95);
    expect(routeLengthM(route.lines)).toBeLessThan(Number(metres) * 1.05);
  });
});

describe('routes at the date line', () => {
  it('keeps points on the meridian when the file switches between +180 and -180', async () => {
    const route = await parse('<gpx><rte><rtept lon="180" lat="1"/><rtept lon="-180" lat="1.001"/></rte></gpx>');
    expect(route.lines).toEqual([[[180, 1], [180, 1.001]]]);
  });
  it.each([1, -1])('keeps a two-point crossing and its full distance in both directions', async direction => {
    const a: [number, number] = [direction * 179.999, 10];
    const b: [number, number] = [-direction * 179.999, 10.001];
    const route = await parse(`<gpx><rte><rtept lon="${a[0]}" lat="${a[1]}"/><rtept lon="${b[0]}" lat="${b[1]}"/></rte></gpx>`);
    expect(route.lines).toHaveLength(2);
    expect(route.lines[0][0]).toEqual(a);
    expect(route.lines[1].at(-1)).toEqual(b);
    expect(routeLengthM(route.lines)).toBeCloseTo(distanceM(a, b), 2);
  });
});
