// Types for the Overture data. Geometries are GeoJSON in WGS84, the way
// Overture publishes them.

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Buildings, and road segments for the sidewalks and crossings the map tiles
// don't mark. The reader came from web3dmapcreator, where it reads every
// Overture type for the 3D models, and it's still written per type so fixes
// there carry across.
export type OvertureType = 'building' | 'segment';

export const OVERTURE_TYPES: readonly OvertureType[] = ['building', 'segment'];

/** Plural names for progress messages, e.g. "Downloading buildings". */
export const OVERTURE_LABEL: Record<OvertureType, string> = {
  building: 'buildings',
  segment: 'road segments',
};

/** [lon, lat]. Overture data is 2D and the WKB reader drops any Z or M. */
export type Position = [number, number];

export interface Point {
  type: 'Point';
  coordinates: Position;
}

export interface MultiPoint {
  type: 'MultiPoint';
  coordinates: Position[];
}

export interface LineString {
  type: 'LineString';
  coordinates: Position[];
}

export interface MultiLineString {
  type: 'MultiLineString';
  coordinates: Position[][];
}

/** Outer ring first, then holes. Rings are closed as in the source (last point repeats the first). */
export interface Polygon {
  type: 'Polygon';
  coordinates: Position[][];
}

export interface MultiPolygon {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}

export interface GeometryCollection {
  type: 'GeometryCollection';
  geometries: Geometry[];
}

export type Geometry =
  | Point
  | MultiPoint
  | LineString
  | MultiLineString
  | Polygon
  | MultiPolygon
  | GeometryCollection;

export interface OvertureFeature {
  id: string;
  type: OvertureType;
  /** Unclipped: a feature is kept when its bbox meets the area. */
  geometry: Geometry;
  /** west, south, east, north, from Overture's bbox column. */
  bbox: [number, number, number, number];
  /**
   * The other selected columns under their Overture names, e.g. `sources`.
   * Null values are left out, INT64 values are numbers and MAP columns are
   * plain objects.
   */
  props: Record<string, unknown>;
}

export interface OvertureTypeStats {
  /** Files whose index bbox meets the area. */
  files: number;
  /** Row groups read after pruning by their bbox statistics. */
  rowGroups: number;
  /** Rows read in the first pass (every column but geometry). */
  rowsRead: number;
  /** Rows whose bbox meets the area and that the caller's filter accepted. */
  rowsKept: number;
  /** Kept rows with a readable geometry, less repeated ids. */
  features: number;
  /** Rows dropped because their id or geometry could not be read. */
  skipped: number;
  /** Bytes read for this type including file footers, from the network or the cache. */
  bytes: number;
  /** The part of `bytes` that came from the cache. */
  cachedBytes: number;
  /** Seconds from the start of the fetch until this type finished. */
  seconds: number;
}

export interface OvertureData {
  release: string;
  bounds: GeoBounds;
  features: Record<OvertureType, OvertureFeature[]>;
  /** Bytes read, from the network or the cache. */
  bytes: number;
  stats: Record<OvertureType, OvertureTypeStats>;
}
