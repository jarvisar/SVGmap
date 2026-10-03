import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MARK, type MapMark, layoutMark } from '../engine/marks/marks.ts';
import { insetShape, shapeContains } from '../engine/layout/shapes.ts';
import { dragMark, markAt, scaleMark } from './markDrag.ts';
import { addMark, duplicateMark, markSpot, nudgeMark, pieceLayout, removeMark, setMarkAnchor, updateMark, useMarkUi } from './marks.ts';
import { defaultSettings, mergeSettings } from './settings.ts';
import { decodeSettings, encodeSettings } from './share.ts';
import { selectSettings, useApp } from './store.ts';
import { describeChange, setupOf, startUndo, undoLabel, useUndo } from './undo.ts';

let initial: ReturnType<typeof useApp.getState>;

beforeAll(() => {
  vi.stubGlobal('window', new EventTarget());
  initial = useApp.getState();
  startUndo();
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  useApp.setState(initial, true);
  useMarkUi.setState({ editing: false, tool: null, selected: null, focusText: null, fresh: null });
  useUndo.setState({ past: [], future: [] });
});

const marks = () => useApp.getState().marks;
const mark = (patch: Partial<MapMark> = {}): MapMark => ({ ...DEFAULT_MARK, id: 'm1', ...patch });

describe('adding pins and text', () => {
  it('puts a mark near the middle of the map, selects it and names the step', () => {
    const id = addMark({ shape: 'heart' });
    expect(marks()).toHaveLength(1);
    expect(useMarkUi.getState().selected).toBe(id);
    const layout = pieceLayout(useApp.getState())!;
    const [x, y] = markSpot(marks()[0])!;
    expect(x).toBeCloseTo(layout.window.x + layout.window.w / 2, 3);
    expect(y).toBeCloseTo(layout.window.y + layout.window.h / 2, 3);
    expect(undoLabel(useUndo.getState().past, setupOf(useApp.getState()))).toBe('Add heart');
  });

  it("doesn't stack marks added one after another", () => {
    for (let i = 0; i < 5; i++) addMark({ shape: 'pin', text: 'Here' });
    const spots = marks().map((m) => markSpot(m)!);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1])).toBeGreaterThan(5);
    }
  });

  it('pulls a mark put down past the piece onto the map', () => {
    addMark({ shape: 'star' }, [-50, -50]);
    const w = pieceLayout(useApp.getState())!.window;
    const [x, y] = markSpot(marks()[0])!;
    expect(x).toBeGreaterThanOrEqual(w.x);
    expect(y).toBeGreaterThanOrEqual(w.y);
  });

  it('keeps automatically placed marks inside every crop shape, including narrow pieces', () => {
    for (const shape of ['rect', 'rounded', 'circle', 'hexagon'] as const) {
      useApp.setState(initial, true);
      useApp.getState().setProduct({ shape, width: 80, height: 40, cornerRadius: 12 });
      const window = insetShape(pieceLayout(useApp.getState())!.window, -0.001);
      for (let i = 0; i < 60; i++) {
        addMark({ shape: 'pin' });
        expect(shapeContains(window, markSpot(marks().at(-1)!)!), `${shape}, mark ${i + 1}`).toBe(true);
      }
    }
  });

  it('nudges, copies and deletes', () => {
    const id = addMark({ shape: 'dot' })!;
    const before = markSpot(marks()[0])!;
    nudgeMark(id, 2, -1);
    const after = markSpot(marks()[0])!;
    expect(after[0] - before[0]).toBeCloseTo(2, 3);
    expect(after[1] - before[1]).toBeCloseTo(-1, 3);
    const copy = duplicateMark(id)!;
    expect(marks()).toHaveLength(2);
    expect(useMarkUi.getState().selected).toBe(copy);
    removeMark(copy);
    expect(marks().map((m) => m.id)).toEqual([id]);
    expect(useMarkUi.getState().selected).toBeNull();
  });

  it('keeps a mark on its spot or on the page as the map moves', () => {
    const onMap = addMark({ shape: 'pin' })!;
    const onPage = addMark({ shape: 'pin', anchor: 'page' })!;
    const spot = (id: string) => markSpot(marks().find((m) => m.id === id)!)!;
    const [mapBefore, pageBefore] = [spot(onMap), spot(onPage)];
    useApp.getState().setArea({ lon: useApp.getState().area.lon + 0.005 });
    expect(spot(onMap)[0]).toBeLessThan(mapBefore[0] - 1);
    expect(spot(onPage)).toEqual(pageBefore);
  });

  it("stays where it is when it's switched between the map and the page", () => {
    const id = addMark({ shape: 'pin', anchor: 'page' })!;
    useApp.getState().setArea({ lon: useApp.getState().area.lon + 0.01 });
    const before = markSpot(marks()[0])!;
    setMarkAnchor(id, 'map');
    expect(marks()[0].anchor).toBe('map');
    expect(markSpot(marks()[0])![0]).toBeCloseTo(before[0], 3);
    expect(markSpot(marks()[0])![1]).toBeCloseTo(before[1], 3);
  });

  it('names the steps that change one', () => {
    const id = addMark({ shape: 'heart' })!;
    const from = setupOf(useApp.getState());
    const step = (patch: Partial<MapMark>) => {
      updateMark(id, patch);
      return describeChange(from, setupOf(useApp.getState()));
    };
    expect(step({ rotation: 30 })).toBe('Turn heart');
    expect(step({ size: 12 })).toBe('Resize heart');
    expect(step({ text: 'Us' })).toBe('Resize heart');
    useApp.setState(from);
    expect(step({ text: 'Us' })).toBe('Edit heart');
    useApp.setState(from);
    nudgeMark(id, 3, 0);
    expect(describeChange(from, setupOf(useApp.getState()))).toBe('Move heart');
  });
});

describe('saved pins and text', () => {
  it('come back from saved settings and links, and broken ones are dropped', () => {
    const merged = mergeSettings(defaultSettings(), { marks: [mark({ text: 'Home' }), { id: 'x y' }, 'pin'] });
    expect(merged.marks.map((m) => m.text)).toEqual(['Home']);
    const settings = { ...defaultSettings(), marks: [mark({ shape: 'flag', text: 'Finish', color: '#FF0000' })] };
    expect(decodeSettings(encodeSettings(settings))!.marks).toEqual(settings.marks);
  });

  it('are kept by Reset settings', () => {
    addMark({ shape: 'house', text: 'Home' });
    useApp.getState().reset();
    expect(selectSettings(useApp.getState()).marks.map((m) => m.text)).toEqual(['Home']);
  });
});

describe('dragging a mark', () => {
  const placed = (patch: Partial<MapMark> = {}) => {
    const m = mark(patch);
    return { mark: m, art: layoutMark(m, null), at: [50, 50] as [number, number] };
  };

  it('settles on square angles, and goes in 15° steps with Shift', () => {
    const from = placed({ shape: 'arrow' });
    // From straight above the spot to a little short of straight right of it.
    const drag = { grip: 'rotate' as const, start: [50, 20] as [number, number], from };
    expect(dragMark(drag, [80, 52]).patch.rotation).toBe(90);
    expect(dragMark(drag, [80, 60]).patch.rotation).toBeCloseTo(108.4, 1);
    expect(dragMark(drag, [80, 60], true).patch.rotation).toBe(105);
  });

  it('keeps to one axis with Shift', () => {
    const drag = { grip: 'move' as const, start: [50, 50] as [number, number], from: placed() };
    expect(dragMark(drag, [60, 53], true).at).toEqual([60, 50]);
  });

  it('resizes the shape and text together, within their ranges', () => {
    const m = mark({ shape: 'pin', size: 10, text: 'Hi', textSize: 2 });
    expect(scaleMark(m, 2)).toEqual({ size: 20, textSize: 4 });
    // The text can't go under 0.8 mm, so the pin stops at 4 mm.
    expect(scaleMark(m, 0.1)).toEqual({ size: 4, textSize: 0.8 });
  });

  it('keeps unused sizes valid when scaling shapes without text or text without a shape', () => {
    expect(scaleMark(mark({ shape: 'pin', size: 1, text: '', textSize: 3 }), 150)).toEqual({ size: 150, textSize: 60 });
    expect(scaleMark(mark({ shape: 'none', size: 150, text: 'Hi', textSize: 3 }), 20)).toEqual({ size: 150, textSize: 60 });
    expect(scaleMark(mark({ shape: 'none', size: 1, text: 'Hi', textSize: 60 }), 0.01)).toEqual({ size: 1, textSize: 0.8 });
  });

  it('leaves empty text unchanged when resized', () => {
    expect(scaleMark(mark({ shape: 'none', text: '' }), 0)).toEqual({ size: 7, textSize: 3 });
  });

  it('finds a turned mark by its own outline', () => {
    const p = placed({ shape: 'arrow', size: 10, rotation: 90 });
    // The arrow points up from its tip, so turned it lies to the left of it.
    expect(markAt([p], [44, 50], 0)).toBe('m1');
    expect(markAt([p], [50, 44], 0)).toBeNull();
  });
});
