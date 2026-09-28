import { CancelledError, RenderService, type RenderProgress, type RenderRequest } from '../engine/service.ts';
import type { RenderResult } from '../engine/result.ts';

export type WorkerRequest = { type: 'render'; id: number; baseUrl: string; request: RenderRequest };

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: RenderProgress }
  | { type: 'result'; id: number; result: RenderResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'cancelled'; id: number };

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};
let baseUrl = '';
let latest = 0;

const service = new RenderService(async (path) => {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  return response.arrayBuffer();
});

const post = (message: WorkerResponse) => scope.postMessage(message);

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'render') return;
  const { id } = message;
  latest = id;
  baseUrl = message.baseUrl;
  try {
    const result = await service.render(
      message.request,
      (progress) => {
        if (id === latest) post({ type: 'progress', id, progress });
      },
      () => id !== latest,
    );
    if (id === latest) post({ type: 'result', id, result });
    else post({ type: 'cancelled', id });
  } catch (error) {
    if (error instanceof CancelledError) post({ type: 'cancelled', id });
    else post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
