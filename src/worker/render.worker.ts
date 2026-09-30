import { CancelledError, RenderService, type RenderProgress, type RenderRequest } from '../engine/service.ts';
import { download } from '../engine/download.ts';
import type { RenderResult } from '../engine/result.ts';

// seq counts every message sent. The page uses the ack to tell a worker stuck in a long loop.
export type WorkerRequest = { type: 'render'; id: number; seq: number; baseUrl: string; request: RenderRequest };

export type WorkerResponse =
  | { type: 'ack'; seq: number }
  | { type: 'progress'; id: number; progress: RenderProgress }
  | { type: 'result'; id: number; result: RenderResult }
  | { type: 'error'; id: number; message: string };

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};
let baseUrl = '';
let latest = 0;

// Fonts, cached by the service worker, so normally instant.
const ASSET_IDLE_MS = 30_000;

const service = new RenderService(async (path) => {
  const { status, bytes } = await download(new URL(path, baseUrl).href, ASSET_IDLE_MS);
  if (!bytes) throw new Error(`Could not load ${path} (${status}).`);
  return bytes;
});

const post = (message: WorkerResponse) => scope.postMessage(message);

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  post({ type: 'ack', seq: message.seq });
  if (message.type !== 'render') return;
  const { id } = message;
  latest = id;
  baseUrl = message.baseUrl;
  // A newer request replaces this one, and the page only listens for the newest.
  const current = () => id === latest;
  try {
    const result = await service.render(
      message.request,
      (progress) => {
        if (current()) post({ type: 'progress', id, progress });
      },
      () => !current(),
    );
    if (current()) post({ type: 'result', id, result });
  } catch (error) {
    if (error instanceof CancelledError || !current()) return;
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
