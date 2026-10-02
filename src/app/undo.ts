// Undo and redo for the settings: everything set up on the map, in the
// sidebar and in the preview, like a dragged title or picked roads.
//
// Steps are recorded from the store, so actions don't have to record
// anything. Changes are grouped the way people think of them: everything one
// click or key did, one press of the pointer (a drag, a slider pulled),
// typing in one field, or the same key pressed on one thing in a row.

import { create } from 'zustand';
import type { LabelSettings } from '../engine/text/label.ts';
import { flash } from './flash.ts';
import type { Settings } from './settings.ts';
import { type AppState, selectSettings, useApp } from './store.ts';

export type Setup = Settings & { scaleLocked: boolean };

export interface SetupStep {
  /** The setup undo goes back to, or redo forward to. */
  setup: Setup;
  /** Given by the action, like 'Reset settings'. Otherwise worked out from what changed. */
  label?: string;
}

export const HISTORY_LIMIT = 100;

export const useUndo = create<{ past: SetupStep[]; future: SetupStep[] }>()(() => ({ past: [], future: [] }));

export function setupOf(state: AppState): Setup {
  return { ...selectSettings(state), scaleLocked: state.scaleLocked };
}

// Presses of the same key on one thing this close together undo as one.
const IDLE_MS = 1000;

interface Open {
  step: SetupStep;
  /** What the last change touched, like 'area.lon area.lat' or 'label.size'. */
  keys: string;
  at: number;
  /** Opened by typing, so typing on in the field adds to it. */
  typed: boolean;
  /** The redo steps it cleared, given back if it comes to nothing. */
  future: SetupStep[];
}

// The step changes go into, until a new gesture starts one of their own.
let open: Open | null = null;
let applying = false;
let quiet = 0;
let naming: string | null = null;
let sameTask = false;
let typing = false;
// The text field typed in since it was focused. Ctrl+Z there is the field's own.
let typedIn: EventTarget | null = null;
const pointers = new Set<number>();
let started = false;

export function startUndo(): void {
  if (started) return;
  started = true;
  useApp.subscribe(record);
  if (typeof window === 'undefined') return;
  window.addEventListener(
    'pointerdown',
    (event) => {
      pointers.add(event.pointerId);
      close();
    },
    true,
  );
  const release = (event: PointerEvent) => pointers.delete(event.pointerId);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  // A mouse let go outside the window never sends its pointerup here.
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!event.buttons) pointers.delete(event.pointerId);
    },
    { capture: true, passive: true },
  );
  window.addEventListener('blur', () => pointers.clear());
  window.addEventListener(
    'focusin',
    () => {
      typedIn = null;
      close();
    },
    true,
  );
  window.addEventListener(
    'input',
    (event) => {
      if (!isTextField(event.target)) return;
      typedIn = event.target;
      typing = true;
      // Not a microtask: those run between listeners, before React's onChange.
      setTimeout(() => (typing = false));
    },
    true,
  );
  window.addEventListener('keydown', onKey);
}

function close(): void {
  open = null;
}

function record(state: AppState, previous: AppState): void {
  if (applying || quiet) return;
  const keys = changedKeys(previous, state);
  if (!keys) return;
  const now = performance.now();
  if (!open || !joins(open, keys, now)) {
    const { past, future } = useUndo.getState();
    const step: SetupStep = { setup: setupOf(previous), ...(naming ? { label: naming } : {}) };
    open = { step, keys, at: now, typed: typing, future };
    useUndo.setState({ past: [...past, step].slice(-HISTORY_LIMIT), future: [] });
  }
  open.keys = keys;
  open.at = now;
  if (!sameTask) {
    sameTask = true;
    queueMicrotask(() => (sameTask = false));
  }
  // Taken back, like a drag called off with Esc: nothing to undo, and redo stays.
  if (sameSetup(open.step.setup, setupOf(state))) {
    const step = open.step;
    useUndo.setState({ past: useUndo.getState().past.filter((item) => item !== step), future: open.future });
    close();
  }
}

function joins(step: Open, keys: string, now: number): boolean {
  if (sameTask || pointers.size) return true;
  if (keys !== step.keys) return false;
  return (typing && step.typed) || now - step.at < IDLE_MS;
}

/** Undoes the last change, or only `only` when it's the last. Returns whether it did. */
export function undoChange(only?: SetupStep): boolean {
  close();
  const { past, future } = useUndo.getState();
  const now = setupOf(useApp.getState());
  const i = lastUndo(past, now);
  const step = past[i];
  if (!step || (only && step !== only)) return false;
  apply(step.setup);
  useUndo.setState({ past: past.slice(0, i), future: [{ setup: now, label: step.label }, ...future] });
  flash(`Undone: ${step.label ?? describeChange(step.setup, now)}`);
  return true;
}

export function redoChange(): boolean {
  close();
  const { past, future } = useUndo.getState();
  const now = setupOf(useApp.getState());
  const i = firstRedo(future, now);
  const step = future[i];
  if (!step) return false;
  apply(step.setup);
  useUndo.setState({ past: [...past, { setup: now, label: step.label }].slice(-HISTORY_LIMIT), future: future.slice(i + 1) });
  flash(`Redone: ${step.label ?? describeChange(now, step.setup)}`);
  return true;
}

// Steps that change nothing any more are passed over by undo, redo and their
// buttons alike.
function lastUndo(past: SetupStep[], now: Setup): number {
  let i = past.length - 1;
  while (i >= 0 && sameSetup(past[i].setup, now)) i--;
  return i;
}

function firstRedo(future: SetupStep[], now: Setup): number {
  let i = 0;
  while (i < future.length && sameSetup(future[i].setup, now)) i++;
  return i;
}

function apply(setup: Setup): void {
  applying = true;
  try {
    useApp.setState(setup);
  } finally {
    applying = false;
  }
}

/** Runs an action as one step named `label`. Returns the step, or null when nothing changed. */
export function asChange(label: string, run: () => void): SetupStep | null {
  close();
  naming = label;
  try {
    run();
    return open?.step ?? null;
  } finally {
    naming = null;
    close();
  }
}

/** A change the app makes by itself, kept out of the history. */
export function quietly(run: () => void): void {
  quiet++;
  try {
    run();
  } finally {
    quiet--;
  }
}

/** What undo and redo would do now, for their buttons. Null for nothing. */
export function useUndoLabels(): { undo: string | null; redo: string | null } {
  const { past, future } = useUndo();
  // Worked out from the setup, so a map drag doesn't re-render the buttons
  // every frame unless what they say changes.
  const undo = useApp((state) => undoLabel(past, setupOf(state)));
  const redo = useApp((state) => redoLabel(future, setupOf(state)));
  return { undo, redo };
}

export function undoLabel(past: SetupStep[], now: Setup): string | null {
  const step = past[lastUndo(past, now)];
  return step ? (step.label ?? describeChange(step.setup, now)) : null;
}

export function redoLabel(future: SetupStep[], now: Setup): string | null {
  const step = future[firstRedo(future, now)];
  return step ? (step.label ?? describeChange(now, step.setup)) : null;
}

function onKey(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  if (event.target === typedIn && isTextField(event.target)) return;
  event.preventDefault();
  // Mid-drag the drag would carry on from where it started.
  if (pointers.size) return;
  if (key === 'z' && !event.shiftKey) undoChange();
  else redoChange();
}

const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

function isTextField(target: EventTarget | null): boolean {
  const element = target as HTMLInputElement | null;
  if (!element?.tagName) return false;
  return element.isContentEditable || element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' && TEXT_TYPES.has(element.type));
}

// ------------------------------------------------------------ comparing

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function changedKeys(before: AppState, after: AppState): string {
  const a = setupOf(before);
  const b = setupOf(after);
  const keys: string[] = [];
  for (const key of Object.keys(b) as (keyof Setup)[]) {
    const x: unknown = a[key];
    const y: unknown = b[key];
    if (x === y) continue;
    if (isPlain(x) && isPlain(y)) {
      for (const inner of Object.keys(y)) if (x[inner] !== y[inner]) keys.push(`${key}.${inner}`);
    } else keys.push(key);
  }
  return keys.join(' ');
}

function sameSetup(a: Setup, b: Setup): boolean {
  return (Object.keys(b) as (keyof Setup)[]).every((key) => same(a[key], b[key]));
}

// Setups share everything a change didn't touch, so this only walks what did.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

// ------------------------------------------------------------ naming

const TITLE_SIZE: (keyof LabelSettings)[] = ['size', 'boxWidth', 'boxHeight', 'bandHeight'];
const TITLE_PLACE: (keyof LabelSettings)[] = ['offsetX', 'offsetY', 'bandOffsetX', 'bandOffsetY', 'position', 'bandPosition'];

/** A step's name, from what it changed: 'Move map', 'Resize title'. */
export function describeChange(from: Setup, to: Setup): string {
  if (from.product !== to.product || from.productPreset !== to.productPreset || from.border !== to.border) return 'Change piece';
  if (from.area !== to.area) {
    const x = from.area;
    const y = to.area;
    // Panning north or south changes the width a little too, since a pixel
    // covers a different distance there.
    if (Math.abs(y.widthM / x.widthM - 1) > 0.005) return 'Zoom map';
    if (x.bearing !== y.bearing) return 'Rotate map';
    return 'Move map';
  }
  if (from.label !== to.label) {
    const changed = (fields: (keyof LabelSettings)[]) => fields.some((field) => from.label[field] !== to.label[field]);
    if (changed(['text', 'subtitle'])) return 'Edit title';
    if (changed(TITLE_SIZE)) return 'Resize title';
    if (changed(TITLE_PLACE)) return 'Move title';
    return 'Change title';
  }
  if (from.roadRoutes !== to.roadRoutes || from.hiddenLines !== to.hiddenLines) return 'Change picked roads';
  if (from.routes !== to.routes) {
    const added = to.routes.items.length - from.routes.items.length;
    if (added > 0) return added === 1 ? 'Add route' : 'Add routes';
    if (added < 0) return 'Remove route';
    return 'Change routes';
  }
  if (from.scaleLocked !== to.scaleLocked) return 'Change scale lock';
  if (from.mode !== to.mode) return 'Change output';
  if (from.styles !== to.styles || from.laserPalette !== to.laserPalette || from.printTheme !== to.printTheme) return 'Change colours and styles';
  if (from.layers !== to.layers || from.filters !== to.filters || from.water !== to.water || from.decks !== to.decks) return 'Change layers';
  if (from.cleanup !== to.cleanup || from.cleanupPreset !== to.cleanupPreset) return 'Change cleanup';
  if (from.source !== to.source) return 'Change map data';
  if (from.plotter !== to.plotter) return 'Change plotter settings';
  return 'Change settings';
}
