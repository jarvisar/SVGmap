import { create } from 'zustand';
import type { RenderResult } from '../engine/result.ts';
import type { RenderSettings } from '../engine/settings.ts';
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

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../worker/render.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.id !== latestId) return;
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
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function settingsKey(settings: RenderSettings, customFont: CustomFont | null): string {
  return JSON.stringify([settings, customFont?.name ?? null, customFont?.data.byteLength ?? 0]);
}

export function requestRender(settings: RenderSettings, customFont: CustomFont | null): void {
  const key = settingsKey(settings, customFont);
  if (key === latestKey && useRender.getState().status === 'working') return;
  latestKey = key;
  const id = ++latestId;
  useRender.setState({ status: 'working', error: null, progress: { stage: 'tiles', message: 'Starting' } });
  const message: WorkerRequest = {
    type: 'render',
    id,
    baseUrl: new URL(import.meta.env.BASE_URL, document.baseURI).href,
    request: { settings, customFont },
  };
  getWorker().postMessage(message);
}
