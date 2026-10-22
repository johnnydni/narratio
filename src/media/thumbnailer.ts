import type { ImageInfo, Thumbnailer } from '../store/media';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (i: ImageInfo) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./thumbs.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; info?: ImageInfo; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.info) p.resolve(e.data.info);
    else p.reject(new Error(e.data.error ?? 'Vorschau fehlgeschlagen'));
  };
  return worker;
}

/** Vorschaubilder im Web Worker. Ohne OffscreenCanvas (alte Browser) gibt es keine Vorschau. */
export const workerThumbnailer: Thumbnailer = (blob) => {
  if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') {
    return Promise.reject(new Error('Vorschaubilder werden in diesem Browser nicht unterstützt'));
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, blob });
  });
};
