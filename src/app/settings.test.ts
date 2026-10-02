import { describe, expect, it } from 'vitest';
import { defaultRenderSettings } from '../engine/defaults.ts';
import type { LonLatLine, RoadRoute } from '../engine/routes/picks.ts';
import { encodePolyline } from '../engine/routes/polyline.ts';
import { MAX_ROUTE_LINES, MAX_ROUTE_POINTS, decodeRoute } from '../engine/routes/route.ts';
import type { RouteData } from '../engine/settings.ts';
import { decodeSettings, encodeSettings } from './share.ts';
import { defaultSettings, mergeSettings, packPicks, toRenderSettings, unpackPicks } from './settings.ts';
import { useApp } from './store.ts';

const ROUTE: RouteData = {
  id: 'abc123',
  name: 'Lakefront',
  visible: true,
  lines: [encodePolyline([[-87.62, 41.88], [-87.61, 41.9], [-87.6, 41.92]])],
};

describe('settings', () => {
  it('starts from the same defaults as the engine', () => {
    const { title: _title, ...app } = toRenderSettings(defaultSettings());
    const { title: _engineTitle, ...engine } = defaultRenderSettings('laser');
    expect(app).toEqual(engine);
  });

  it('fills in fields that older saved settings are missing', () => {
    const merged = mergeSettings(defaultSettings(), { label: { text: 'ROME' } });
    expect(merged.label.text).toBe('ROME');
    expect(merged.label.font).toBe(defaultSettings().label.font);
    expect(merged.cleanup).toEqual(defaultSettings().cleanup);
  });

  it('drops values of the wrong type and keys it does not know', () => {
    const merged = mergeSettings(defaultSettings(), {
      product: { width: 'wide', height: 200 },
      label: { text: null, enabled: 'yes' },
      area: { widthM: Number.NaN },
      extra: { anything: 1 },
    });
    const defaults = defaultSettings();
    expect(merged.product.width).toBe(defaults.product.width);
    expect(merged.product.height).toBe(200);
    expect(merged.label.text).toBe(defaults.label.text);
    expect(merged.label.enabled).toBe(true);
    expect(merged.area.widthM).toBe(defaults.area.widthM);
    expect('extra' in merged).toBe(false);
  });

  it('only accepts #RRGGBB colours and known output modes', () => {
    const merged = mergeSettings(defaultSettings(), {
      mode: 'engrave',
      styles: {
        laser: { colors: { water: '#00FF00', roads: 'red"/><script>alert(1)</script>' } },
        print: { background: 'url(x)' },
      },
    });
    const defaults = defaultSettings();
    expect(merged.mode).toBe('laser');
    expect(merged.styles.laser.colors.water).toBe('#00FF00');
    expect(merged.styles.laser.colors.roads).toBe(defaults.styles.laser.colors.roads);
    expect(merged.styles.print.background).toBe(defaults.styles.print.background);
  });

  it('drops areas that would break the map, and clamps other numbers like the render does', () => {
    const merged = mergeSettings(defaultSettings(), {
      area: { widthM: -5, lat: 95, lon: 500 },
      plotter: { penWidth: 0 },
      label: { size: 0, rotation: 45 },
    });
    const defaults = defaultSettings();
    expect(merged.area).toEqual(defaults.area);
    expect(merged.plotter.penWidth).toBe(0.05);
    expect(merged.label.size).toBe(40);
    expect(merged.label.rotation).toBe(defaults.label.rotation);
  });

  it('keeps values typed past a slider as they were rendered', () => {
    const settings = defaultSettings();
    settings.label.size = 300;
    settings.cleanup.lineSpacing = 8;
    const reloaded = mergeSettings(defaultSettings(), JSON.parse(JSON.stringify(settings)));
    expect(reloaded.label.size).toBe(250);
    expect(reloaded.cleanup.lineSpacing).toBe(7.5);
    expect(decodeSettings(encodeSettings(settings))!.label.size).toBe(250);
  });

  it('keeps a transparent background', () => {
    const merged = mergeSettings(defaultSettings(), { styles: { print: { background: null } } });
    expect(merged.styles.print.background).toBeNull();
  });

  it('keeps Overture buildings off for settings saved before the option', () => {
    const old = mergeSettings(defaultSettings(), { source: { tiles: 'https://tiles.example/{z}/{x}/{y}.pbf', maxZoom: 14, maxTiles: 50 } });
    expect(old.source).toEqual({ tiles: 'https://tiles.example/{z}/{x}/{y}.pbf', maxZoom: 14, maxTiles: 50, overtureBuildings: false });
    expect(mergeSettings(defaultSettings(), { source: { overtureBuildings: 'yes' } }).source.overtureBuildings).toBe(false);
    expect(mergeSettings(defaultSettings(), { source: { overtureBuildings: 1 } }).source.overtureBuildings).toBe(false);
    expect(mergeSettings(defaultSettings(), { source: { overtureBuildings: true } }).source.overtureBuildings).toBe(true);
    expect(toRenderSettings(mergeSettings(defaultSettings(), { source: { overtureBuildings: true } })).source.overtureBuildings).toBe(true);
  });
});

describe('saved routes', () => {
  it('come back from saved settings', () => {
    const merged = mergeSettings(defaultSettings(), { routes: { items: [ROUTE], gap: 0.8 } });
    expect(merged.routes.items).toEqual([ROUTE]);
    expect(merged.routes.gap).toBe(0.8);
    expect(merged.routes.markers).toBe(true);
    expect(toRenderSettings(merged).routes.items).toEqual([ROUTE]);
  });

  it('drop anything that is not a route', () => {
    const merged = mergeSettings(defaultSettings(), {
      routes: {
        items: [
          ROUTE,
          { ...ROUTE, id: 'quote', lines: ['abc"/><script>'] },
          { ...ROUTE, id: 7 },
          { ...ROUTE, id: 'nolines', lines: 'abc' },
          'route',
          { ...ROUTE, id: 'hidden', visible: false, name: 'x'.repeat(500) },
        ],
        width: 1e9,
      },
    });
    expect(merged.routes.items.map((r) => r.id)).toEqual(['abc123', 'hidden']);
    expect(merged.routes.items[1].visible).toBe(false);
    expect(merged.routes.items[1].name).toHaveLength(100);
    expect(merged.routes.width).toBe(10);
    expect(mergeSettings(defaultSettings(), { routes: { items: { 0: ROUTE } } }).routes.items).toEqual([]);
  });

  it('are brought under the caps when a link has too many points', () => {
    const many = Array.from({ length: 3000 }, (_, i) => encodePolyline([[i * 0.001, 0], [i * 0.001, 0.0005], [i * 0.001 + 0.0002, 0.001]]));
    const [route] = mergeSettings(defaultSettings(), { routes: { items: [{ ...ROUTE, lines: many }] } }).routes.items;
    expect(route.lines).toHaveLength(MAX_ROUTE_LINES);
    expect(decodeRoute(route).reduce((n, l) => n + l.length, 0)).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
  });

  it('only accept known ways of drawing them', () => {
    const merged = mergeSettings(defaultSettings(), { styles: { laser: { routeDraw: 'line' }, print: { routeDraw: 'glow' } } });
    expect(merged.styles.laser.routeDraw).toBe('line');
    expect(merged.styles.print.routeDraw).toBe(defaultSettings().styles.print.routeDraw);
  });

  it('are kept by Reset settings', () => {
    const app = useApp.getState();
    app.addRoutes([ROUTE]);
    app.setRoutes({ gap: 2, markers: false });
    useApp.getState().reset();
    expect(useApp.getState().routes).toEqual({ ...defaultSettings().routes, items: [ROUTE] });
    useApp.getState().removeRoute(ROUTE.id);
    expect(useApp.getState().routes.items).toEqual([]);
  });
});

describe('share links', () => {
  it('round-trip the settings', () => {
    const settings = defaultSettings();
    settings.mode = 'plotter';
    settings.label.text = 'SÃO PAULO';
    settings.styles.print.background = null;
    settings.area = { lon: -46.63, lat: -23.55, bearing: 12.5, widthM: 4200 };
    expect(decodeSettings(encodeSettings(settings))).toEqual(settings);
    settings.source.overtureBuildings = true;
    expect(decodeSettings(encodeSettings(settings))!.source.overtureBuildings).toBe(true);
  });

  it('only hold what changed', () => {
    const settings = defaultSettings();
    settings.label.text = 'ROME';
    const decode = (encoded: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))));
    expect(decode(encodeSettings(settings))).toEqual({ label: { text: 'ROME' } });
    settings.source = { ...settings.source, overtureBuildings: true };
    expect(decode(encodeSettings(settings))).toEqual({ label: { text: 'ROME' }, source: { overtureBuildings: true } });
  });

  it('carry the routes', () => {
    const settings = defaultSettings();
    settings.routes = { ...settings.routes, items: [ROUTE, { ...ROUTE, id: 'two', visible: false }] };
    expect(decodeSettings(encodeSettings(settings))).toEqual(settings);
  });

  it('ignore text that is not a share link', () => {
    expect(decodeSettings('not base64 json')).toBeNull();
  });
});

describe('picked roads', () => {
  const roadRoutes: RoadRoute[] = [{ id: 'r', name: 'Home', color: '#E4002B', width: 0.6, lines: [[[-87.62, 41.88], [-87.611234, 41.891234]]] }];
  const hiddenLines: LonLatLine[] = [[[-87.6, 41.9], [-87.59, 41.91], [-87.58, 41.905]]];

  it('come back from saved settings and go to the render', () => {
    const merged = mergeSettings(defaultSettings(), JSON.parse(JSON.stringify({ roadRoutes, hiddenLines })));
    expect(merged.roadRoutes).toEqual(roadRoutes);
    expect(merged.hiddenLines).toEqual(hiddenLines);
    expect(toRenderSettings(merged).roadRoutes).toEqual(roadRoutes);
    expect(toRenderSettings(merged).hiddenLines).toEqual(hiddenLines);
  });

  it('drop anything that is not a pick', () => {
    const merged = mergeSettings(defaultSettings(), { roadRoutes: [{ id: 'x', color: 'red', lines: [] }, 'route'], hiddenLines: 'roads' });
    expect(merged.roadRoutes).toEqual([]);
    expect(merged.hiddenLines).toEqual([]);
    // Settings from before picking roads have none.
    expect(mergeSettings(defaultSettings(), { label: { text: 'ROME' } }).roadRoutes).toEqual([]);
  });

  it('go in share links as polylines and come back the same', () => {
    const settings = { ...defaultSettings(), roadRoutes, hiddenLines };
    const encoded = encodeSettings(settings);
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    expect(typeof json.hiddenLines[0]).toBe('string');
    expect(typeof json.roadRoutes[0].lines[0]).toBe('string');
    expect(decodeSettings(encoded)).toEqual(settings);
    // None picked, nothing in the link.
    expect(encodeSettings(defaultSettings())).toBe(encodeSettings({ ...defaultSettings(), roadRoutes: [], hiddenLines: [] }));
  });

  it('are saved as polylines and read back the same', () => {
    const settings = { ...defaultSettings(), roadRoutes, hiddenLines };
    const saved = JSON.parse(JSON.stringify(packPicks(settings)));
    expect(typeof saved.hiddenLines[0]).toBe('string');
    expect(mergeSettings(defaultSettings(), unpackPicks(saved))).toEqual(settings);
    // Saved on every change, so only worked out again when the picks change.
    expect(packPicks(settings).hiddenLines).toBe(packPicks({ ...settings }).hiddenLines);
  });

  it('are kept by Reset settings', () => {
    useApp.getState().set({ roadRoutes, hiddenLines });
    useApp.getState().reset();
    expect(useApp.getState().roadRoutes).toEqual(roadRoutes);
    expect(useApp.getState().hiddenLines).toEqual(hiddenLines);
    useApp.getState().set({ roadRoutes: [], hiddenLines: [] });
  });
});
