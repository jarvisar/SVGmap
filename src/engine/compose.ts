// Stage 2: prepared geometry and settings to styled output groups. Runs on every
// settings change, so layer unions are cached in memo between renders.
import type { Paths64 } from 'clipper2-ts';
import { clipPolylineOutside } from './geo/clip.ts';
import {
  areaMm2,
  bufferLines,
  dilate,
  intersectWith,
  linesOutside,
  makeFillTester,
  pathsD,
  resolveSurfaces,
  subtract,
  toPath64,
  unionAll,
} from './fills.ts';
import type { Layout } from './layout/layout.ts';
import { drawMarks, makeMarkClearer } from './marks/draw.ts';
import { bandPathD, distanceToEdge, insetShape, shapePathD, shapePolygon } from './layout/shapes.ts';
import { cleanupLines } from './lines/cleanup.ts';
import { lineCoverage } from './lines/coverage.ts';
import { type LineItem, type Path, pathLength } from './lines/geometry.ts';
import { weldPaths } from './lines/weld.ts';
import { contourFill, hatchWith, orderForPlotting, outlines } from './plotter.ts';
import type { Prepared, PreparedLine, PreparedPolygon } from './prepare.ts';
import type { GroupElement, OutputGroup, OutputPath, PlotterStats, RenderResult } from './result.ts';
import { buildRoutes, makeRouteClearer } from './routes/draw.ts';
import { type LonLatLine, pickLines, pickedLines, roadRouteGroupId } from './routes/picks.ts';
import {
  type ElementId,
  FILL_LAYERS,
  type FillLayerId,
  type FillMode,
  type HatchKey,
  LAYER_NAMES,
  LINE_LAYERS,
  type LineLayerId,
  ROAD_WIDTH_SCALE,
  ROUTE_DRAWS,
  type RenderSettings,
} from './settings.ts';
import { polylineD } from './svg/format.ts';
import { type LabelArtwork, buildLabel } from './text/label.ts';
import type { LoadedFont } from './text/outline.ts';
import { FLAG, acceptLine, acceptPolygon } from './tiles/schema.ts';

export interface ComposeFonts {
  title: LoadedFont | null;
  subtitle: LoadedFont | null;
  // The marks' fonts by id.
  marks?: ReadonlyMap<string, LoadedFont>;
}

interface LineKey {
  layer: LineLayerId;
  cls: string;
}

// A group before it becomes path data, so the plotter can still reorder it.
interface Draft {
  id: string;
  element: GroupElement;
  label: string;
  kind: 'fill' | 'stroke';
  strokeWidth: number;
  // A road route's or a mark's own colour, instead of its element's.
  color?: string;
  fill?: Paths64;
  // Split by class when print mode gives each road class its own width.
  lines?: { cls?: string; width?: number; paths: Path[] }[];
  // Exact path data with arcs, for the border and the cut.
  d?: string;
  // The same outline as polylines, used by the plotter instead of d.
  plotLines?: Path[];
}

const ATTRIBUTION = '© OpenStreetMap contributors';

function filterSignature(s: RenderSettings, layer: FillLayerId): string {
  const f = s.filters;
  switch (layer) {
    case 'water':
      return `${f.water.pools}${f.water.intermittent}`;
    case 'greens':
      return `${f.greens.wetlands}${f.greens.pitches}${f.greens.cemeteries}`;
    case 'decks':
      return `${f.decks.bridges}`;
    default:
      return '';
  }
}

function isConvex(ring: Path): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const [cx, cy] = ring[(i + 2) % ring.length];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

// Where the map is left out for the title. A box, band or badge is a single
// convex ring, which lines are clipped against directly. That is much faster
// than Clipper, which the other shapes need.
function titleArea(label: LabelArtwork, windowPoly: Path, strokeWidth: number): { area: Paths64; convex: Path | null } {
  if (label.keep) return { area: subtract([toPath64(windowPoly)], unionAll(label.keep.map(toPath64))), convex: null };
  const shapes = unionAll([...label.clear.map(toPath64), ...bufferLines(label.clearLines, strokeWidth / 2, true)]);
  const area = dilate(shapes, label.clearGap);
  const single = label.clear.length === 1 && label.clearLines.length === 0 && label.clearGap <= 0 && isConvex(label.clear[0]);
  return { area, convex: single ? label.clear[0] : null };
}

export function compose(
  settings: RenderSettings,
  layout: Layout,
  prepared: Prepared,
  fonts: ComposeFonts,
  memo: Map<string, Paths64>,
): RenderResult {
  const timings: Record<string, number> = {};
  let clock = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    timings[name] = Math.round(now - clock);
    clock = now;
  };
  const s = settings;
  const style = s.style;
  const warnings = [...prepared.warnings];
  const window = layout.window;
  const windowPoly = shapePolygon(window);
  const plotter = s.mode === 'plotter';
  // Same floor as the UI. A zero pen width would never finish the band passes below.
  const pen = Math.max(s.plotter.penWidth, 0.05);
  const hairline = plotter ? pen : s.mode === 'laser' ? s.laser.lineWidth : 0.1;

  // Title
  const map = { metresPerMm: prepared.transform.metresPerMm, bearing: s.area.bearing };
  const built = buildLabel(layout, s.label, fonts.title, fonts.subtitle, map);
  warnings.push(...built.warnings);
  if (built.error) warnings.push(built.error);
  const label: LabelArtwork | null = built.artwork;
  const titleStroke = plotter ? pen : s.mode === 'laser' ? hairline : 0.3;
  const title = label ? titleArea(label, windowPoly, titleStroke) : { area: [], convex: null };
  const knockout = title.area;
  lap('label');

  // Pins and text. They're drawn over everything else in the window, title included.
  const marks = drawMarks(s.marks ?? [], fonts.marks ?? new Map(), s.label.font, style.colors.text, prepared.transform, window, titleStroke);
  warnings.push(...marks.warnings);
  const clearMarks = makeMarkClearer(marks.clear);
  lap('marks');

  // Routes
  const routeDraw = ROUTE_DRAWS.includes(style.routeDraw) ? style.routeDraw : 'fill';
  const routeLineWidth = plotter ? pen : s.mode === 'laser' ? hairline : s.routes.width;
  const route = buildRoutes(s.routes, routeDraw, routeLineWidth, prepared.transform, window, knockout);
  if (route) {
    const inWindowMm = route.drawnMm + route.underTitleMm;
    // With the map only inside the letters, some of the route is always
    // between them, so that's only worth a warning when none of it shows.
    const lettersOnly = label?.keep != null;
    if (route.drawnMm === 0 && route.shape.length === 0) {
      if (inWindowMm === 0) warnings.push('The route is outside the map. Use Fit map under Routes to frame it.');
      else if (lettersOnly) warnings.push('The route is outside the letters, where the map shows. Use Fit map under Routes to frame it.');
      else warnings.push('The route is under the title. Move the title or the map to show it.');
    } else if (!lettersOnly && route.underTitleMm > Math.max(3, 0.03 * inWindowMm)) {
      warnings.push('Part of the route is under the title. Move the title or the map to show all of it.');
    }
  }
  // The route gives way to the marks too.
  if (route && marks.clear.length) {
    route.lines = clearMarks(route.lines);
    route.shape = subtract(route.shape, marks.clear);
  }
  // What the map leaves empty: the title, the marks and the gap around the route.
  const cleared = [...(route?.clear ?? []), ...marks.clear];
  const cutouts = cleared.length ? unionAll([...knockout, ...cleared]) : knockout;
  lap('route');

  // Fills
  const layerOn = s.layers;
  const unionOf = (layer: FillLayerId): Paths64 => {
    if (!layerOn[layer]) return [];
    const key = `${layer}|${filterSignature(s, layer)}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const rings: Paths64 = [];
    for (const p of prepared.polygons as PreparedPolygon[]) {
      if (p.layer === layer && acceptPolygon(p, s.filters)) for (const r of p.rings) rings.push(r);
    }
    const merged = unionAll(rings);
    memo.set(key, merged);
    return merged;
  };

  const acceptedLines = prepared.lines.filter((l) => layerOn[l.layer] && acceptLine(l, s.filters));
  // Roads picked in the preview: a road route's index, or -1 when left out.
  const roadRoutes = s.roadRoutes ?? [];
  const missingPicks: LonLatLine[] = [];
  const picked = pickedLines(acceptedLines, roadRoutes, s.hiddenLines ?? [], prepared.transform, missingPicks);
  const drawnLines = picked.size ? acceptedLines.filter((l) => !picked.has(l)) : acceptedLines;
  let waterGaps: Paths64 = [];
  if (s.water.bridgeGap > 0 && layerOn.water) {
    const bridges = acceptedLines
      .filter((l) => l.flags & FLAG.bridge && (l.layer === 'roads' || l.layer === 'railways') && picked.get(l) !== -1)
      .map((l) => l.path);
    waterGaps = bufferLines(bridges, s.water.bridgeGap, false);
  }
  const surfaces = resolveSurfaces(
    {
      buildings: unionOf('buildings'),
      decks: unionOf('decks'),
      water: unionOf('water'),
      aeroways: unionOf('aeroways'),
      rocks: unionOf('rocks'),
      sand: unionOf('sand'),
      greens: unionOf('greens'),
      waterGaps,
    },
    { waterHalo: s.water.halo },
  );
  const finalFill = (paths: Paths64): Paths64 => {
    let out = window.kind === 'rect' ? paths : intersectWith(paths, [toPath64(windowPoly)]);
    if (cutouts.length) out = subtract(out, cutouts);
    return out;
  };
  const fills: Record<FillLayerId, Paths64> = {
    water: finalFill(surfaces.water),
    greens: finalFill(surfaces.greens),
    sand: finalFill(surfaces.sand),
    rocks: finalFill(surfaces.rocks),
    aeroways: finalFill(surfaces.aeroways),
    decks: s.decks.engrave ? finalFill(surfaces.decks) : [],
    buildings: finalFill(surfaces.buildings),
  };
  lap('fills');

  // Lines
  const groupOf =
    s.mode === 'print' && style.classWidths
      ? (k: LineKey) => `${k.layer}|${k.cls}`
      : (k: LineKey) => k.layer;
  const toItem = (l: PreparedLine): LineItem<LineKey> => ({
    rank: l.rank,
    key: { layer: l.layer, cls: l.cls },
    path: l.path,
  });
  const cleanupInput = drawnLines.filter((l) => l.layer !== 'raceways').map(toItem);
  const edgeTolerance = Math.max(s.cleanup.weldTolerance, 0.001);
  const cleaned = cleanupLines(cleanupInput, s.cleanup, {
    groupOf,
    isPathGroup: (k) => k.layer === 'paths',
    onBoundary: (p) => distanceToEdge(window, p) <= edgeTolerance,
    coveredFn: makeFillTester([fills.buildings, fills.water]),
  });
  // Coverage only counts roads. Sidewalks and parallel tracks are supposed to be
  // thinned out, streets are not.
  const roadsBefore = cleanupInput.filter((i) => i.key.layer === 'roads').map((i) => i.path);
  // The tolerance scales with line spacing (0.2 mm at 0.3 mm) so roads merged
  // on purpose don't count as lost.
  const coverage =
    s.cleanup.enabled && s.cleanup.cull && roadsBefore.length > 0
      ? lineCoverage(
          roadsBefore,
          cleaned.items.filter((i) => i.key.layer === 'roads').map((i) => i.path),
          Math.max(s.cleanup.coverageTolerance, (s.cleanup.lineSpacing * 2) / 3),
        )
      : null;
  if (coverage !== null && coverage < 0.97) {
    warnings.push(
      `Cleanup kept ${(coverage * 100).toFixed(1)}% of the roads. Below 97% means streets were removed, not just doubled lines. Lower the line spacing or stub pruning.`,
    );
  }
  // Racetracks skip cleanup and are drawn as mapped. Welding only rejoins tile seams.
  const raceways = weldPaths(
    drawnLines.filter((l) => l.layer === 'raceways').map(toItem),
    Math.max(s.cleanup.weldTolerance, 0.01),
    { groupFn: groupOf },
  ).items;
  // Road routes are drawn as picked too, their pieces welded into one another only.
  const roadRouteItems = roadRoutes.map((_, index) =>
    weldPaths(
      acceptedLines.filter((l) => picked.get(l) === index).map(toItem),
      Math.max(s.cleanup.weldTolerance, 0.01),
      { groupFn: () => 'road-route' },
    ).items,
  );
  lap('lines');

  const byLayer = new Map<LineLayerId, LineItem<LineKey>[]>();
  for (const item of [...cleaned.items, ...raceways]) {
    const list = byLayer.get(item.key.layer);
    if (list) list.push(item);
    else byLayer.set(item.key.layer, [item]);
  }
  const convexTitle = title.convex;
  const clipLabel = (paths: Path[]): Path[] => {
    if (convexTitle) return paths.flatMap((p) => clipPolylineOutside(p, convexTitle));
    return knockout.length ? linesOutside(paths, knockout) : paths;
  };
  // After the cleanup, so the coverage only counts what the cleanup removed.
  const clearRoute = makeRouteClearer(route?.clear ?? [], s.cleanup.lineSpacing);

  // Groups
  const drafts: Draft[] = [];
  const fillDraft = (id: string, element: GroupElement, name: string, paths: Paths64, mode: FillMode, hatchKey: HatchKey, color?: string) => {
    if (paths.length === 0) return;
    const effective: FillMode = plotter && mode === 'fill' ? 'hatch-outline' : mode;
    if (effective === 'fill') {
      drafts.push({ id, element, label: name, kind: 'fill', strokeWidth: 0, fill: paths, color });
      return;
    }
    // concat, not push(...), since fine hatching of a big area is more lines than a call can take.
    let lines: Path[] = [];
    if (effective === 'hatch' || effective === 'hatch-outline') {
      const h = style.hatch[hatchKey];
      lines = lines.concat(hatchWith(paths, { ...h, spacing: Math.max(h.spacing, 0.05) }));
    }
    if (effective === 'outline' || effective === 'hatch-outline') lines = lines.concat(outlines(paths));
    drafts.push({ id, element, label: name, kind: 'stroke', strokeWidth: hairline, lines: [{ paths: lines }], color });
  };

  for (const layer of FILL_LAYERS) {
    fillDraft(layer, layer, LAYER_NAMES[layer], fills[layer], style.fillModes[layer], layer);
  }

  for (const layer of LINE_LAYERS) {
    let items = byLayer.get(layer) ?? [];
    if (items.length === 0) continue;
    if (layer === 'waterways' && fills.water.length) {
      // Don't draw a stream over its own river fill.
      items = items.flatMap((i) => linesOutside([i.path], fills.water).map((path) => ({ ...i, path })));
    }
    const width = plotter ? pen : s.mode === 'laser' ? hairline : style.lineWidths[layer];
    if (s.mode === 'print' && style.classWidths && layer === 'roads') {
      const classes = new Map<string, Path[]>();
      for (const i of items) {
        const list = classes.get(i.key.cls);
        if (list) list.push(i.path);
        else classes.set(i.key.cls, [i.path]);
      }
      // Minor roads first so major roads draw over them at junctions.
      const ordered = [...classes.entries()].sort(
        (a, b) => (ROAD_WIDTH_SCALE[a[0]] ?? 1) - (ROAD_WIDTH_SCALE[b[0]] ?? 1),
      );
      drafts.push({
        id: layer,
        element: layer,
        label: LAYER_NAMES[layer],
        kind: 'stroke',
        strokeWidth: width,
        lines: ordered.map(([cls, paths]) => ({
          cls,
          width: width * (ROAD_WIDTH_SCALE[cls] ?? 1),
          paths: clearMarks(clipLabel(clearRoute(paths))),
        })),
      });
    } else {
      drafts.push({
        id: layer,
        element: layer,
        label: LAYER_NAMES[layer],
        kind: 'stroke',
        strokeWidth: width,
        lines: [{ paths: clearMarks(clipLabel(clearRoute(items.map((i) => i.path)))) }],
      });
    }
  }

  // Over the roads, each in its own colour. They keep the same gap from an
  // imported route as the other lines.
  roadRoutes.forEach((route, index) => {
    const items = roadRouteItems[index];
    if (!items.length) return;
    drafts.push({
      id: roadRouteGroupId(index),
      element: 'roads',
      label: route.name,
      kind: 'stroke',
      strokeWidth: plotter ? pen : s.mode === 'laser' ? hairline : Math.min(5, Math.max(0.02, route.width)),
      color: route.color,
      lines: [{ paths: clearMarks(clipLabel(clearRoute(items.map((i) => i.path)))) }],
    });
  });

  if (route) {
    if (routeDraw === 'line') {
      const sets: { paths: Path[] }[] = [{ paths: route.lines }];
      // Laser markers are outlined so the route stays one scoring process.
      // Print fills them below.
      if (route.shape.length && s.mode !== 'print') sets.push({ paths: plotter ? contourFill(route.shape, pen) : outlines(route.shape) });
      drafts.push({ id: 'route', element: 'route', label: 'Route', kind: 'stroke', strokeWidth: routeLineWidth, lines: sets });
      if (s.mode === 'print') fillDraft('route-markers', 'route', 'Route markers', route.shape, 'fill', 'route');
    } else if (plotter && routeDraw === 'fill') {
      drafts.push({ id: 'route', element: 'route', label: 'Route', kind: 'stroke', strokeWidth: pen, lines: [{ paths: contourFill(route.shape, pen) }] });
    } else {
      fillDraft('route', 'route', 'Route', route.shape, routeDraw, 'route');
    }
  }

  if (label) {
    const letters = unionAll(label.text.rings.map(toPath64));
    const solid = unionAll(label.solid.map(toPath64));
    let strokes = label.text.strokes;
    let engraved: Paths64;
    if (label.reversed && solid.length) {
      // Letters on the plate are left bare, and any off it are drawn as usual.
      // Single-line letters get a width that still shows once cut out.
      const cut = unionAll([...letters, ...bufferLines(strokes, Math.max(titleStroke, 0.4) / 2, true)]);
      engraved = unionAll([...subtract(solid, cut), ...subtract(letters, solid)]);
      strokes = linesOutside(strokes, solid);
    } else {
      engraved = unionAll([...letters, ...solid]);
    }
    fillDraft('text', 'text', 'Title', engraved, style.fillModes.text, 'text');
    if (strokes.length > 0) {
      // A band can mix an outline title with a single-line subtitle, and group ids have to stay unique.
      const mixed = engraved.length > 0;
      drafts.push({
        id: mixed ? 'text-lines' : 'text',
        element: 'text',
        label: mixed ? 'Title (single-line)' : 'Title',
        kind: 'stroke',
        strokeWidth: titleStroke,
        lines: [{ paths: strokes }],
      });
    }
    if (label.frame.length > 0) {
      drafts.push({
        id: 'frame',
        element: 'frame',
        label: label.frameLabel,
        kind: 'stroke',
        strokeWidth: plotter ? pen : Math.max(label.frameWidth, 0.05),
        lines: [{ paths: label.frame }],
      });
    }
  }

  for (const piece of marks.pieces) {
    fillDraft(`mark-${piece.id}`, 'mark', piece.label, piece.area, piece.fill, 'marks', piece.color);
    if (piece.strokes.length) {
      const id = piece.area.length ? `mark-${piece.id}-lines` : `mark-${piece.id}`;
      drafts.push({ id, element: 'mark', label: piece.label, kind: 'stroke', strokeWidth: titleStroke, color: piece.color, lines: [{ paths: piece.strokes }] });
    }
  }

  // The in-border title breaks the border lines around it.
  const breaks = label?.borderBreaks ?? [];
  const breakLines = (paths: Path[]) => breaks.reduce((out, b) => out.flatMap((p) => clipPolylineOutside(p, b)), paths);

  if (layout.thickBand) {
    const { outer, inner } = layout.thickBand;
    // Not inner.x - outer.x: a hexagon's corners move in further than its sides.
    const thickness = s.border.thick;
    if (plotter) {
      // Plotters draw the band as concentric passes of the pen.
      const passes = Math.max(1, Math.round(thickness / pen));
      const loops: Path[] = [];
      for (let i = 0; i < passes; i++) {
        const ring = shapePolygon(insetShape(outer, (thickness * (i + 0.5)) / passes), 0.01);
        loops.push([...ring, ring[0]]);
      }
      drafts.push({ id: 'band', element: 'band', label: 'Border band', kind: 'stroke', strokeWidth: pen, lines: [{ paths: breakLines(loops) }] });
    } else if (breaks.length) {
      const band = subtract([toPath64(shapePolygon(outer, 0.01))], [toPath64(shapePolygon(inner, 0.01))]);
      drafts.push({ id: 'band', element: 'band', label: 'Border band', kind: 'fill', strokeWidth: 0, fill: subtract(band, breaks.map(toPath64)) });
    } else {
      drafts.push({ id: 'band', element: 'band', label: 'Border band', kind: 'fill', strokeWidth: 0, d: bandPathD(outer, inner) });
    }
  }
  if (layout.thinLine) {
    const ring = shapePolygon(layout.thinLine, 0.01);
    const border: Draft = { id: 'border', element: 'border', label: 'Border line', kind: 'stroke', strokeWidth: plotter ? pen : layout.thinWidth };
    if (breaks.length) drafts.push({ ...border, lines: [{ paths: breakLines([[...ring, ring[0]]]) }] });
    else drafts.push({ ...border, d: shapePathD(layout.thinLine), plotLines: [[...ring, ring[0]]] });
  }
  if (style.cut) {
    const ring = shapePolygon(layout.canvas, 0.01);
    drafts.push({
      id: 'cut',
      element: 'cut',
      label: 'Cut line',
      kind: 'stroke',
      strokeWidth: hairline,
      d: shapePathD(layout.canvas),
      plotLines: [[...ring, ring[0]]],
    });
  }
  lap('style');

  // Plotter order
  const colorOf = (d: Draft) => d.color ?? style.colors[d.element as ElementId];
  let plotterStats: PlotterStats | null = null;
  if (plotter) {
    // The file puts every layer of one pen together, so the pen travels in that order.
    const first = new Map<string, number>();
    drafts.forEach((d, i) => {
      if (!first.has(colorOf(d))) first.set(colorOf(d), i);
    });
    drafts.sort((a, b) => first.get(colorOf(a))! - first.get(colorOf(b))!);
    let penDown = 0;
    let penUp = 0;
    let penUpUnordered = 0;
    let here: [number, number] = [0, 0];
    let hereUnordered: [number, number] = [0, 0];
    for (const draft of drafts) {
      if (draft.plotLines) {
        draft.lines = [{ paths: draft.plotLines }];
        draft.d = undefined;
      }
      for (const set of draft.lines ?? []) {
        for (const p of set.paths) {
          penUpUnordered += Math.hypot(p[0][0] - hereUnordered[0], p[0][1] - hereUnordered[1]);
          hereUnordered = p[p.length - 1];
          penDown += pathLength(p);
        }
        if (s.plotter.optimize) {
          const ordered = orderForPlotting(set.paths, here);
          set.paths = ordered.paths;
          penUp += ordered.travel;
        } else {
          for (const p of set.paths) {
            penUp += Math.hypot(p[0][0] - here[0], p[0][1] - here[1]);
            here = p[p.length - 1];
          }
        }
        const last = set.paths[set.paths.length - 1];
        if (last) here = last[last.length - 1];
      }
    }
    plotterStats = { penDownMm: penDown, penUpMm: penUp, penUpUnorderedMm: penUpUnordered, pens: 0 };
  }

  // Path data
  const groups: OutputGroup[] = [];
  for (const draft of drafts) {
    const paths: OutputPath[] = [];
    let subpaths = 0;
    let lengthMm = 0;
    let area = 0;
    if (draft.fill) {
      const d = pathsD(draft.fill);
      if (d) paths.push({ d });
      subpaths = draft.fill.length;
      area = Math.abs(areaMm2(draft.fill));
    } else if (draft.d) {
      paths.push({ d: draft.d });
      subpaths = 1;
    } else {
      for (const set of draft.lines ?? []) {
        const usable = set.paths.filter((p) => p.length >= 2);
        if (usable.length === 0) continue;
        paths.push({ d: usable.map((p) => polylineD(p)).join(''), strokeWidth: set.width, cls: set.cls });
        subpaths += usable.length;
        for (const p of usable) lengthMm += pathLength(p);
      }
    }
    if (paths.length === 0) continue;
    groups.push({
      id: draft.id,
      element: draft.element,
      label: draft.label,
      kind: draft.kind,
      color: colorOf(draft),
      strokeWidth: draft.strokeWidth,
      paths,
      subpaths,
      lengthMm,
      areaMm2: area,
    });
  }
  // Only pens with something to draw get a layer.
  if (plotterStats) plotterStats.pens = new Set(groups.map((g) => g.color)).size;
  lap('output');

  const centre = { lon: s.area.lon, lat: s.area.lat };
  return {
    width: layout.canvas.w,
    height: layout.canvas.h,
    outline: shapePathD(layout.canvas),
    mode: s.mode,
    background: s.mode === 'print' ? style.background : null,
    groups,
    stats: {
      zoom: prepared.zoom,
      tiles: prepared.tiles,
      missingTiles: prepared.missing,
      bytes: prepared.bytes,
      ...(prepared.overtureBuildings !== undefined ? { overtureBuildings: prepared.overtureBuildings } : {}),
      ...(prepared.sidewalksLeftOutM !== undefined ? { sidewalksLeftOutM: prepared.sidewalksLeftOutM } : {}),
      ...(prepared.overtureFailed ? { overtureFailed: true } : {}),
      cleanup: s.cleanup.enabled ? cleaned.stats : null,
      coverage,
      plotter: plotterStats,
      timings,
    },
    warnings,
    meta: {
      title: s.title,
      centre,
      bearing: s.area.bearing,
      widthM: prepared.widthM,
      heightM: prepared.heightM,
      scale: Math.round(prepared.transform.metresPerMm * 1000),
      attribution:
        (prepared.overtureBuildings && layerOn.buildings) || prepared.sidewalksLeftOutM ? `${ATTRIBUTION}, Overture Maps Foundation` : ATTRIBUTION,
      generated: new Date().toISOString(),
    },
    pick: pickLines(acceptedLines, prepared.transform, picked),
    ...(missingPicks.length ? { missingPicks } : {}),
  };
}
