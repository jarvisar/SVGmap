// Reads route files: GPX, KML, KMZ, TCX and GeoJSON. Every track, route and
// line in the file becomes part of one route. Points and waypoints are skipped.
import type { LonLat } from './polyline.ts';
import { MAX_ROUTE_LINES, distanceM } from './route.ts';
import { walkXml } from './xml.ts';
import { ZipError, kmlFromKmz } from './zip.ts';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_POINTS = 2_000_000;
// Pieces of one recorded track closer than this are joined. Watches start a
// new segment after a pause, and a gap in the line looks like a mistake.
const TRACK_JOIN_M = 500;
// Separate lines are only joined where they meet.
const LINE_JOIN_M = 1;

const NOT_A_ROUTE = "This doesn't look like a GPX, KML, KMZ, TCX or GeoJSON file.";

export class RouteFileError extends Error {}

export interface ParsedRoute {
  name: string;
  lines: LonLat[][];
}

// The lines of one recorded track, or of one drawn line or shape.
interface Chunk {
  lines: LonLat[][];
  track: boolean;
}

interface FileContents {
  name: string;
  chunks: Chunk[];
  // Waypoints and other points, only counted to explain an empty result.
  points: number;
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

function readGpx(text: string): FileContents {
  const chunks: Chunk[] = [];
  const stack: string[] = [];
  let chunk: Chunk | null = null;
  let line: LonLat[] | null = null;
  let buffer = '';
  let fileName = '';
  let trackName = '';
  let points = 0;
  walkXml(text, {
    open(name, attrs) {
      stack.push(name);
      buffer = '';
      if (name === 'trk' || name === 'rte') {
        chunk = { lines: [], track: name === 'trk' };
        chunks.push(chunk);
        if (name === 'rte') {
          line = [];
          chunk.lines.push(line);
        }
      } else if (name === 'trkseg') {
        line = [];
        if (!chunk) {
          chunk = { lines: [], track: true };
          chunks.push(chunk);
        }
        chunk.lines.push(line);
      } else if (name === 'trkpt' || name === 'rtept') {
        line?.push([parseFloat(attrs.lon), parseFloat(attrs.lat)]);
      } else if (name === 'wpt') {
        points++;
      }
    },
    close(name) {
      const parent = stack[stack.length - 2];
      if (name === 'name') {
        // GPX 1.0 puts the file's name straight under gpx.
        if ((parent === 'metadata' || parent === 'gpx') && !fileName) fileName = collapse(buffer);
        if ((parent === 'trk' || parent === 'rte') && !trackName) trackName = collapse(buffer);
      } else if (name === 'trk' || name === 'rte') {
        chunk = null;
        line = null;
      } else if (name === 'trkseg') {
        line = null;
      }
      stack.pop();
    },
    text(t) {
      buffer += t;
    },
  });
  return { name: fileName || trackName, chunks, points };
}

function kmlCoordinates(text: string): LonLat[] {
  const tuples = text.replace(/\s*,\s*/g, ',').trim().split(/\s+/);
  return tuples.map((tuple) => {
    const [lon, lat] = tuple.split(',');
    return [parseFloat(lon), parseFloat(lat)];
  });
}

function readKml(text: string): FileContents {
  const chunks: Chunk[] = [];
  const stack: string[] = [];
  let buffer = '';
  let documentName = '';
  let placemarkName = '';
  let points = 0;
  // gx:MultiTrack and gx:Track, Google Earth's recorded tracks.
  let multi: Chunk | null = null;
  let track: LonLat[] | null = null;
  walkXml(text, {
    open(name) {
      stack.push(name);
      buffer = '';
      if (name === 'MultiTrack') {
        multi = { lines: [], track: true };
        chunks.push(multi);
      } else if (name === 'Track') {
        track = [];
        if (multi) multi.lines.push(track);
        else chunks.push({ lines: [track], track: true });
      }
    },
    close(name) {
      const parent = stack[stack.length - 2];
      if (name === 'coordinates') {
        if (parent === 'LineString' || parent === 'LinearRing') chunks.push({ lines: [kmlCoordinates(buffer)], track: false });
        else if (parent === 'Point') points++;
      } else if (name === 'coord' && track) {
        const [lon, lat] = buffer.trim().split(/\s+/);
        track.push([parseFloat(lon), parseFloat(lat)]);
      } else if (name === 'Track') {
        track = null;
      } else if (name === 'MultiTrack') {
        multi = null;
      } else if (name === 'name') {
        if ((parent === 'Document' || parent === 'Folder') && !documentName) documentName = collapse(buffer);
        if (parent === 'Placemark' && !placemarkName) placemarkName = collapse(buffer);
      }
      stack.pop();
    },
    text(t) {
      buffer += t;
    },
  });
  return { name: documentName || placemarkName, chunks, points };
}

function readTcx(text: string): FileContents {
  const chunks: Chunk[] = [];
  const stack: string[] = [];
  let chunk: Chunk | null = null;
  let line: LonLat[] | null = null;
  let buffer = '';
  let name = '';
  let lat = NaN;
  let lon = NaN;
  let points = 0;
  walkXml(text, {
    open(element) {
      stack.push(element);
      buffer = '';
      if (element === 'Activity' || element === 'Course') {
        chunk = { lines: [], track: true };
        chunks.push(chunk);
      } else if (element === 'Track') {
        line = [];
        if (!chunk) {
          chunk = { lines: [], track: true };
          chunks.push(chunk);
        }
        chunk.lines.push(line);
      } else if (element === 'Trackpoint') {
        lat = NaN;
        lon = NaN;
      } else if (element === 'CoursePoint') {
        points++;
      }
    },
    close(element) {
      const parent = stack[stack.length - 2];
      if (element === 'LatitudeDegrees') lat = parseFloat(buffer);
      else if (element === 'LongitudeDegrees') lon = parseFloat(buffer);
      // A trackpoint without a position, like heart rate on a treadmill, is skipped.
      else if (element === 'Trackpoint' && line && Number.isFinite(lat) && Number.isFinite(lon)) line.push([lon, lat]);
      else if (element === 'Track') line = null;
      else if (element === 'Activity' || element === 'Course') chunk = null;
      else if (element === 'Name' && parent === 'Course' && !name) name = collapse(buffer);
      stack.pop();
    },
    text(t) {
      buffer += t;
    },
  });
  return { name, chunks, points };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? collapse(value) : '');
const num = (value: unknown): number => (typeof value === 'number' ? value : NaN);

function readGeoJson(source: string): FileContents {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new RouteFileError("This GeoJSON file couldn't be read.");
  }
  const chunks: Chunk[] = [];
  let points = 0;
  // Not in the spec, but plenty of tools write it.
  let name = isObject(value) ? text(value.name) : '';
  const line = (coordinates: unknown): LonLat[] =>
    list(coordinates).map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [NaN, NaN]));
  const geometry = (g: unknown, track: boolean) => {
    if (!isObject(g)) return;
    switch (g.type) {
      case 'LineString':
        chunks.push({ lines: [line(g.coordinates)], track });
        break;
      case 'MultiLineString':
        chunks.push({ lines: list(g.coordinates).map(line), track });
        break;
      case 'Polygon':
        for (const ring of list(g.coordinates)) chunks.push({ lines: [line(ring)], track: false });
        break;
      case 'MultiPolygon':
        for (const polygon of list(g.coordinates)) {
          for (const ring of list(polygon)) chunks.push({ lines: [line(ring)], track: false });
        }
        break;
      case 'GeometryCollection':
        for (const child of list(g.geometries)) geometry(child, track);
        break;
      case 'Point':
        points++;
        break;
      case 'MultiPoint':
        points += list(g.coordinates).length;
        break;
    }
  };
  const visit = (node: unknown) => {
    if (!isObject(node)) return;
    if (node.type === 'FeatureCollection') {
      for (const feature of list(node.features)) visit(feature);
    } else if (node.type === 'Feature') {
      const props = isObject(node.properties) ? node.properties : {};
      if (!name) name = text(props.name) || text(props.title);
      // Converted GPS tracks (togeojson and the like) keep the point times. Their
      // pieces are joined like a GPX track's segments.
      geometry(node.geometry, 'coordTimes' in props || 'coordinateProperties' in props);
    } else {
      geometry(node, false);
    }
  };
  visit(value);
  return { name, chunks, points };
}

function readXml(source: string): FileContents {
  const root = /<(?![?!])([^\s/>]+)/.exec(source)?.[1] ?? '';
  switch (root.slice(root.indexOf(':') + 1)) {
    case 'gpx':
      return readGpx(source);
    case 'kml':
      return readKml(source);
    case 'TrainingCenterDatabase':
      return readTcx(source);
    default:
      throw new RouteFileError(NOT_A_ROUTE);
  }
}

// Drops points off the globe and repeats, and splits where the line jumps the
// 180th meridian so it doesn't cross the whole world.
function cleanLine(raw: readonly LonLat[]): LonLat[][] {
  const out: LonLat[][] = [];
  let line: LonLat[] = [];
  for (const [lon, lat] of raw) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    const prev = line[line.length - 1];
    if (prev && prev[0] === lon && prev[1] === lat) continue;
    if (prev && Math.abs(lon - prev[0]) > 180) {
      if (line.length >= 2) out.push(line);
      line = [];
    }
    line.push([lon, lat]);
  }
  if (line.length >= 2) out.push(line);
  return out;
}

function assemble(chunks: readonly Chunk[]): LonLat[][] {
  let total = 0;
  for (const chunk of chunks) for (const line of chunk.lines) total += line.length;
  if (total > MAX_POINTS) throw new RouteFileError(`This file has over ${MAX_POINTS.toLocaleString('en')} points, which is more than a route can have.`);
  const out: LonLat[][] = [];
  for (const chunk of chunks) {
    let first = true;
    for (const raw of chunk.lines) {
      for (const line of cleanLine(raw)) {
        const last = out[out.length - 1];
        const end = last?.[last.length - 1];
        const limit = chunk.track && !first ? TRACK_JOIN_M : LINE_JOIN_M;
        if (end && Math.abs(end[0] - line[0][0]) <= 180 && distanceM(end, line[0]) <= limit) {
          const repeat = end[0] === line[0][0] && end[1] === line[0][1];
          for (let i = repeat ? 1 : 0; i < line.length; i++) last.push(line[i]);
        } else {
          out.push(line);
        }
        first = false;
      }
    }
  }
  return out;
}

function tidyName(name: string): string {
  return collapse(name)
    .replace(/\.(gpx|kml|kmz|tcx|geojson|json)$/i, '')
    .slice(0, 100);
}

export async function parseRouteFile(fileName: string, data: ArrayBuffer): Promise<ParsedRoute> {
  if (data.byteLength > MAX_FILE_BYTES) throw new RouteFileError(`This file is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const head = new Uint8Array(data, 0, Math.min(12, data.byteLength));
  const signature = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  let contents: FileContents;
  if (signature(0, 4) === 'PK\x03\x04') {
    try {
      contents = readXml(await kmlFromKmz(data));
    } catch (error) {
      throw error instanceof ZipError ? new RouteFileError(error.message) : error;
    }
  } else if (signature(8, 12) === '.FIT') {
    throw new RouteFileError("FIT files can't be read. Export the activity as a GPX file instead, most apps and watches can.");
  } else {
    const source = new TextDecoder().decode(data);
    const start = /\S/.exec(source.slice(0, 4096).replace(/^﻿/, ''))?.[0];
    if (start === '{' || start === '[') contents = readGeoJson(source.replace(/^﻿/, ''));
    else if (start === '<') contents = readXml(source);
    else throw new RouteFileError(NOT_A_ROUTE);
  }
  const lines = assemble(contents.chunks);
  if (lines.length === 0) {
    throw new RouteFileError(
      contents.points > 0
        ? 'This file only has points or waypoints in it. A route needs a track or a line.'
        : 'There are no tracks, routes or lines in this file.',
    );
  }
  if (lines.length > MAX_ROUTE_LINES) {
    throw new RouteFileError(`This file has ${lines.length.toLocaleString('en')} separate lines. A route can have up to ${MAX_ROUTE_LINES.toLocaleString('en')}.`);
  }
  const base = fileName.replace(/^.*[\\/]/, '');
  return { name: tidyName(contents.name) || tidyName(base) || 'Route', lines };
}
