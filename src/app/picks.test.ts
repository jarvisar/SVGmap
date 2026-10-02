import { describe, expect, it } from 'vitest';
import { MAX_ROAD_ROUTES } from '../engine/routes/picks.ts';
import { addRoadRoute } from './picks.ts';
import { useApp } from './store.ts';

describe('road routes', () => {
  it('each get a colour of their own, apart from the layers', () => {
    for (let i = 0; i < MAX_ROAD_ROUTES; i++) addRoadRoute();
    const s = useApp.getState();
    const colours = s.roadRoutes.map((r) => r.color);
    expect(colours).toHaveLength(MAX_ROAD_ROUTES);
    expect(new Set(colours).size).toBe(MAX_ROAD_ROUTES);
    const layers = new Set(Object.values(s.styles[s.mode].colors));
    expect(colours.filter((c) => layers.has(c))).toEqual([]);
  });
});
