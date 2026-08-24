import { crc32 } from './zipStore';

export type BlobDigest = { sha256: string; crc32?: number };

const WORKER_THRESHOLD = 256 * 1024;
const MAIN_THREAD_FALLBACK_LIMIT = 8 * 1024 * 1024;
let requestId = 0;
let hashWorker: Worker | null = null;
const pending = new Map<number, {
  resolve: (value: BlobDigest) => void;
  reject: (reason: Error) => void;
}>();

export async function sha256Blob(blob: Blob): Promise<string> {
  return (await digestBlob(blob, false)).sha256;
}

export async function digestBlobWithCrc(blob: Blob): Promise<{ sha256: string; crc32: number }> {
  const result = await digestBlob(blob, true);
  if (result.crc32 === undefined) throw new Error('Не удалось вычислить CRC32.');
  return { sha256: result.sha256, crc32: result.crc32 };
}

export async function crc32Blob(blob: Blob): Promise<number> {
  if (blob.size >= WORKER_THRESHOLD && canUseWorker()) {
    const result = await digestInWorker(blob, true);
    if (result.crc32 === undefined) throw new Error('Не удалось вычислить CRC32.');
    return result.crc32;
  }
  assertSafeMainThreadDigest(blob);
  return crc32(new Uint8Array(await blob.arrayBuffer()));
}

async function digestBlob(blob: Blob, includeCrc: boolean): Promise<BlobDigest> {
  if (blob.size >= WORKER_THRESHOLD && canUseWorker()) {
    try {
      return await digestInWorker(blob, includeCrc);
    } catch (error) {
      // Never retry a large failed hash on the UI thread: that would duplicate the
      // expensive allocation precisely when the worker/browser is already under pressure.
      if (blob.size > MAIN_THREAD_FALLBACK_LIMIT) throw error;
      console.warn('Hash worker failed for a small file, falling back to main thread.', error);
    }
  }

  assertSafeMainThreadDigest(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = bytesToHex(new Uint8Array(digest));
  return { sha256, ...(includeCrc ? { crc32: crc32(bytes) } : {}) };
}

function assertSafeMainThreadDigest(blob: Blob) {
  if (blob.size <= MAIN_THREAD_FALLBACK_LIMIT) return;
  throw new Error('Большой аудиофайл нельзя безопасно проверить без фонового Web Worker. Обновите браузер или используйте файл меньшего размера.');
}

function canUseWorker() {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

function getHashWorker() {
  if (hashWorker) return hashWorker;
  const worker = new Worker(new URL('./hash.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; sha256?: string; crc32?: number; error?: string }>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error || !event.data.sha256) {
      request.reject(new Error(event.data.error || 'Не удалось вычислить контрольную сумму.'));
      return;
    }
    request.resolve({ sha256: event.data.sha256, crc32: event.data.crc32 });
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Ошибка фонового хеширования.');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker.terminate();
    hashWorker = null;
  };
  hashWorker = worker;
  return worker;
}

function digestInWorker(blob: Blob, includeCrc: boolean): Promise<BlobDigest> {
  const id = ++requestId;
  const worker = getHashWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, blob, includeCrc });
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
