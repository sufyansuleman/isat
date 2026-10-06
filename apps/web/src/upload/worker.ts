import { runBatch, type RunRequest, type WorkerMessage } from '@isat/core';

const ctx = self as unknown as { postMessage(m: WorkerMessage): void; onmessage: ((e: MessageEvent<RunRequest>) => void) | null };

ctx.onmessage = (e) => {
  try {
    for (const m of runBatch(e.data)) ctx.postMessage(m);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
