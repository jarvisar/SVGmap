import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoadRoute } from '../engine/routes/picks.ts';
import { useFlash } from './flash.ts';
import { clearPicks, deleteRoadRoute } from './picks.ts';
import { useApp } from './store.ts';
import { asChange, describeChange, quietly, redoChange, redoLabel, setupOf, startUndo, undoChange, undoLabel, useUndo } from './undo.ts';

// Tests run without a DOM, so the listeners go on a bare EventTarget.
const target = new EventTarget();
let clock = 0;

function fire(type: string, props: Record<string, unknown> = {}, from?: unknown): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), props);
  if (from) Object.defineProperty(event, 'target', { value: from });
  target.dispatchEvent(event);
  return event;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const press = () => fire('pointerdown', { pointerId: 1 });
const release = () => fire('pointerup', { pointerId: 1 });
const key = (k: string, more: Record<string, unknown> = {}, from?: unknown) =>
  fire('keydown', { key: k, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...more }, from);
const nudge = (dx: number) => useApp.getState().setArea({ lon: useApp.getState().area.lon + dx });
const steps = () => useUndo.getState().past.length;
const route = (id: string, lines = [[[0, 0], [1, 1]]] as RoadRoute['lines']): RoadRoute => ({ id, name: id, color: '#E4002B', width: 0.6, lines });

let initial: ReturnType<typeof useApp.getState>;

beforeAll(() => {
  vi.stubGlobal('window', target);
  vi.stubGlobal('confirm', () => true);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  initial = useApp.getState();
  startUndo();
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  quietly(() => useApp.setState(initial, true));
  useUndo.setState({ past: [], future: [] });
  fire('focusin');
  clock += 10_000;
  await tick();
});

describe('undo for the settings', () => {
  it('takes a drag back as one step, and redo puts it back', async () => {
    const start = useApp.getState().area;
    press();
    for (let i = 0; i < 4; i++) {
      nudge(0.001);
      clock += 2000;
      await tick();
    }
    release();
    const end = useApp.getState().area;
    expect(steps()).toBe(1);
    expect(undoChange()).toBe(true);
    expect(useApp.getState().area).toEqual(start);
    expect(useFlash.getState().text).toBe('Undone: Move map');
    expect(redoChange()).toBe(true);
    expect(useApp.getState().area).toEqual(end);
  });

  it('keeps separate clicks apart, and one handler together', async () => {
    press();
    release();
    useApp.getState().setLabel({ boxBorder: false });
    await tick();
    press();
    release();
    useApp.getState().setLabel({ divider: false });
    await tick();
    expect(steps()).toBe(2);
    // Like applyPlace: the area and the title in one go.
    nudge(0.002);
    useApp.getState().setLabel({ text: 'ROME' });
    await tick();
    expect(steps()).toBe(3);
    undoChange();
    expect(useApp.getState().label.text).toBe(initial.label.text);
    expect(useApp.getState().area).toEqual(initial.area);
  });

  it('joins presses of one key in a row until a pause or another key', async () => {
    nudge(0.001);
    await tick();
    clock += 500;
    nudge(0.001);
    await tick();
    expect(steps()).toBe(1);
    clock += 1500;
    nudge(0.001);
    await tick();
    expect(steps()).toBe(2);
    clock += 100;
    useApp.getState().setLabel({ size: 120 });
    await tick();
    expect(steps()).toBe(3);
  });

  it('keeps typing in one field together until the focus moves', async () => {
    const field = { tagName: 'INPUT', type: 'text' };
    fire('input', {}, field);
    useApp.getState().setLabel({ text: 'A' });
    await tick();
    clock += 5000;
    fire('input', {}, field);
    useApp.getState().setLabel({ text: 'AB' });
    await tick();
    expect(steps()).toBe(1);
    fire('focusin');
    fire('input', {}, field);
    useApp.getState().setLabel({ text: 'ABC' });
    await tick();
    expect(steps()).toBe(2);
    undoChange();
    expect(useApp.getState().label.text).toBe('AB');
  });

  it('leaves nothing for a change taken back, and keeps what redo had', async () => {
    useApp.getState().setLabel({ size: 120 });
    await tick();
    undoChange();
    expect(useUndo.getState().future).toHaveLength(1);
    press();
    nudge(0.01);
    await tick();
    nudge(-0.01);
    release();
    // Esc on a drag puts back the exact start.
    useApp.getState().set({ area: initial.area });
    await tick();
    expect(steps()).toBe(0);
    expect(redoChange()).toBe(true);
    expect(useApp.getState().label.size).toBe(120);
  });

  it('names a step for an action and only undoes it while it is the last', async () => {
    useApp.getState().setLabel({ size: 120 });
    await tick();
    const step = asChange('Reset settings', () => useApp.getState().reset());
    expect(step?.label).toBe('Reset settings');
    expect(useApp.getState().label.size).toBe(initial.label.size);
    nudge(0.001);
    await tick();
    expect(undoChange(step!)).toBe(false);
    undoChange();
    expect(undoChange(step!)).toBe(true);
    expect(useApp.getState().label.size).toBe(120);
  });

  it('leaves out what the app changes by itself and what undo leaves alone', async () => {
    quietly(() => useApp.getState().setLabel({ font: 'oswald' }));
    useApp.getState().setPreviewLook('colors');
    useApp.getState().setView('preview');
    await tick();
    expect(steps()).toBe(0);
  });

  it('takes back the scale lock with the map', async () => {
    useApp.getState().setScaleLocked(true);
    await tick();
    expect(undoLabel(useUndo.getState().past, setupOf(useApp.getState()))).toBe('Change scale lock');
    undoChange();
    expect(useApp.getState().scaleLocked).toBe(false);
  });

  it('brings back picked roads cleared or a road route deleted', async () => {
    useApp.getState().set({ roadRoutes: [route('home'), route('race')], hiddenLines: [[[2, 2], [3, 3]]] });
    await tick();
    clearPicks();
    expect(useApp.getState().hiddenLines).toEqual([]);
    expect(undoLabel(useUndo.getState().past, setupOf(useApp.getState()))).toBe('Clear picked roads');
    undoChange();
    expect(useApp.getState().hiddenLines).toHaveLength(1);
    expect(useApp.getState().roadRoutes[0].lines).toHaveLength(1);
    deleteRoadRoute('race');
    expect(useApp.getState().roadRoutes.map((r) => r.id)).toEqual(['home']);
    undoChange();
    expect(useApp.getState().roadRoutes.map((r) => r.id)).toEqual(['home', 'race']);
  });

  it('names what undo and redo would do', async () => {
    const labels = () => {
      const { past, future } = useUndo.getState();
      const now = setupOf(useApp.getState());
      return { undo: undoLabel(past, now), redo: redoLabel(future, now) };
    };
    press();
    release();
    useApp.getState().setLabel({ offsetX: 0.2 });
    await tick();
    expect(labels()).toEqual({ undo: 'Move title', redo: null });
    undoChange();
    expect(labels()).toEqual({ undo: null, redo: 'Move title' });
  });

  it('names what changed', () => {
    const before = setupOf(useApp.getState());
    const label = (patch: Partial<typeof before.label>) => ({ ...before, label: { ...before.label, ...patch } });
    expect(describeChange(before, label({ offsetX: 0.3 }))).toBe('Move title');
    expect(describeChange(before, label({ size: 80, offsetX: 0.3 }))).toBe('Resize title');
    expect(describeChange(before, label({ boxWidth: 80 }))).toBe('Resize title');
    expect(describeChange(before, label({ text: 'PARIS' }))).toBe('Edit title');
    expect(describeChange(before, { ...before, area: { ...before.area, bearing: 10 } })).toBe('Rotate map');
    expect(describeChange(before, { ...before, area: { ...before.area, widthM: 10 } })).toBe('Zoom map');
    expect(describeChange(before, { ...before, area: { ...before.area, lat: before.area.lat + 0.01, widthM: before.area.widthM * 1.0001 } })).toBe('Move map');
    expect(describeChange(before, { ...before, hiddenLines: [[[0, 0], [1, 1]]] })).toBe('Change picked roads');
    expect(describeChange(before, { ...before, product: { ...before.product, width: 300 } })).toBe('Change piece');
  });
});

describe('undo keys', () => {
  it('undo with Ctrl+Z, redo with Ctrl+Y or Ctrl+Shift+Z', async () => {
    useApp.getState().setLabel({ size: 120 });
    await tick();
    expect(key('z').defaultPrevented).toBe(true);
    expect(useApp.getState().label.size).toBe(initial.label.size);
    key('y');
    expect(useApp.getState().label.size).toBe(120);
    key('z');
    key('Z', { shiftKey: true });
    expect(useApp.getState().label.size).toBe(120);
  });

  it("leaves a field's own typing to the field", async () => {
    const field = { tagName: 'INPUT', type: 'text' };
    useApp.getState().setLabel({ size: 120 });
    await tick();
    fire('focusin');
    fire('input', {}, field);
    expect(key('z', {}, field).defaultPrevented).toBe(false);
    // Focused again but not typed in, it has nothing of its own to undo.
    fire('focusin');
    expect(key('z', {}, field).defaultPrevented).toBe(true);
  });

  it('does nothing mid-drag', async () => {
    useApp.getState().setLabel({ size: 120 });
    await tick();
    press();
    key('z');
    release();
    expect(useApp.getState().label.size).toBe(120);
  });
});
