import { create } from 'zustand';
import type { RenderResult } from '../engine/result.ts';
import type { RenderSettings } from '../engine/settings.ts';
import { fontFingerprint } from '../engine/text/fonts.ts';
import type { CustomFont, RenderProgress } from '../engine/service.ts';
import type { WorkerRequest, WorkerResponse } from '../worker/render.worker.ts';

export interface RenderState {
  status: 'idle' | 'working' | 'done' | 'error';
  progress: RenderProgress | null;
  result: RenderResult | null;
  error: string | null;
  // The settings the current result or error came from, as a string to compare.
  renderedKey: string | null;
}

export const useRender = create<RenderState>(() => ({
  status: 'idle',
  progress: null,
  result: null,
  error: null,
  renderedKey: null,
}));

let worker: Worker | null = null;
// Only the newest request matters. The worker drops older ones and anything
// they still send is ignored here.
let latestId = 0;
let latestKey: string | null = null;
let latestRequest: WorkerRequest | null = null;

// The worker picks up a newer render between the steps of the one it's on.
// One that doesn't answer within this long is stuck in a loop and can't be
// stopped any other way, so it's replaced, losing its downloaded tiles.
const STUCK_MS = 8000;
// A render may be running in the worker, so a message now may wait on it.
let busy = false;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
// The message the watchdog waits to hear back about. An ack for an earlier
// one, still on its way, says nothing about it.
let awaited = 0;

function send(message: Omit<WorkerRequest, 'seq'>) {
  const target = getWorker();
  const sent: WorkerRequest = { ...message, seq: ++seq };
  if (busy) {
    awaited = sent.seq;
    clearTimeout(watchdog);
    watchdog = setTimeout(replaceStuckWorker, STUCK_MS);
  }
  target.postMessage(sent);
  busy = true;
  latestRequest = sent;
}

function replaceStuckWorker() {
  worker?.terminate();
  worker = null;
  busy = false;
  // The render still wanted starts over in a new worker.
  if (useRender.getState().status === 'working' && latestRequest?.id === latestId) {
    getWorker().postMessage(latestRequest);
    busy = true;
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../worker/render.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    // Messages are read in order, so this one or a later one means it got it.
    if (message.type === 'ack') {
      if (message.seq >= awaited) clearTimeout(watchdog);
      return;
    }
    if (message.id !== latestId) return;
    if (message.type !== 'progress') busy = false;
    if (message.type === 'progress') {
      useRender.setState({ progress: message.progress });
    } else if (message.type === 'result') {
      useRender.setState({ status: 'done', result: message.result, error: null, progress: null, renderedKey: latestKey });
    } else {
      useRender.setState({ status: 'error', error: message.message, progress: null, renderedKey: latestKey });
    }
  };
  worker.onerror = (event) => {
    // renderedKey is set so the live preview doesn't retry in a loop. Generate still retries.
    useRender.setState({
      status: 'error',
      error: event.message || 'The renderer stopped unexpectedly.',
      progress: null,
      renderedKey: latestKey,
    });
    clearTimeout(watchdog);
    busy = false;
    worker?.terminate();
    worker = null;
  };
  return worker;
}

// How far along the bar is, 0 to 1.
export function renderFraction(progress: RenderProgress | null): number {
  if (!progress) return 0;
  if (progress.stage === 'tiles') return 0.1 + 0.55 * ((progress.done ?? 0) / Math.max(progress.total ?? 1, 1));
  // Overture's buildings and sidewalks come after the tiles' geometry.
  if (progress.stage === 'buildings' || progress.stage === 'sidewalks') return 0.75 + 0.14 * Math.min(1, Math.max(0, progress.fraction ?? 0));
  return progress.stage === 'geometry' ? 0.75 : 0.9;
}

// Picked roads go in the key as a number per list. Written out, tens of
// thousands of points held up every frame of a map drag. The lists are only
// ever replaced, never changed in place, so a new list is new picks.
const listIds = new WeakMap<object, number>();
let lastListId = 0;

function listId(list: object): number {
  let id = listIds.get(list);
  if (id === undefined) listIds.set(list, (id = ++lastListId));
  return id;
}

export function settingsKey(settings: RenderSettings, customFont: CustomFont | null): string {
  const picks = { roadRoutes: listId(settings.roadRoutes), hiddenLines: listId(settings.hiddenLines) };
  return JSON.stringify([{ ...settings, ...picks }, customFont ? fontFingerprint(customFont.data) : null]);
}

export function requestRender(settings: RenderSettings, customFont: CustomFont | null): void {
  const key = settingsKey(settings, customFont);
  if (key === latestKey && useRender.getState().status === 'working') return;
  latestKey = key;
  const id = ++latestId;
  useRender.setState({ status: 'working', error: null, progress: { stage: 'tiles', message: 'Starting' } });
  send({
    type: 'render',
    id,
    baseUrl: new URL(import.meta.env.BASE_URL, document.baseURI).href,
    request: { settings, customFont },
  });
}
