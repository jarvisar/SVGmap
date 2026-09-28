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
  // The settings the current result was made from, as a string to compare.
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
let nextId = 0;
const keys = new Map<number, string>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../worker/render.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.id !== nextId) return; // a newer request superseded this one
    switch (message.type) {
      case 'progress':
        useRender.setState({ progress: message.progress });
        break;
      case 'result':
        useRender.setState({
          status: 'done',
          result: message.result,
          error: null,
          progress: null,
          renderedKey: keys.get(message.id) ?? null,
        });
        keys.delete(message.id);
        break;
      case 'error':
        useRender.setState({ status: 'error', error: message.message, progress: null, renderedKey: keys.get(message.id) ?? null });
        keys.delete(message.id);
        break;
      case 'cancelled':
        keys.delete(message.id);
        break;
    }
  };
  worker.onerror = (event) => {
    useRender.setState({ status: 'error', error: event.message || 'The renderer stopped unexpectedly.', progress: null });
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function settingsKey(settings: RenderSettings, customFont: CustomFont | null): string {
  return JSON.stringify([settings, customFont?.name ?? null, customFont?.data.byteLength ?? 0]);
}

export function requestRender(settings: RenderSettings, customFont: CustomFont | null): void {
  const id = ++nextId;
  keys.set(id, settingsKey(settings, customFont));
  useRender.setState({ status: 'working', error: null, progress: { stage: 'tiles', message: 'Starting' } });
  const message: WorkerRequest = {
    type: 'render',
    id,
    baseUrl: new URL(import.meta.env.BASE_URL, document.baseURI).href,
    request: { settings, customFont },
  };
  getWorker().postMessage(message);
}
