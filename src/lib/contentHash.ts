import { crc32 } from './zipStore';

export type BlobDigest = { sha256: string; crc32?: number };

const WORKER_THRESHOLD = 256 * 1024;
let requestId = 0;

export async function sha256Blob(blob: Blob): Promise<string> {
  return (await digestBlob(blob, false)).sha256;
}

export async function digestBlobWithCrc(blob: Blob): Promise<{ sha256: string; crc32: number }> {
  const result = await digestBlob(blob, true);
  if (result.crc32 === undefined) throw new Error('Не удалось вычислить CRC32.');
  return { sha256: result.sha256, crc32: result.crc32 };
}

export async function crc32Blob(blob: Blob): Promise<number> {
  if (canUseWorker() && blob.size >= WORKER_THRESHOLD) {
    return (await digestBlob(blob, true)).crc32 ?? 0;
  }
  return crc32(new Uint8Array(await blob.arrayBuffer()));
}

async function digestBlob(blob: Blob, includeCrc: boolean): Promise<BlobDigest> {
  if (canUseWorker() && blob.size >= WORKER_THRESHOLD) {
    try {
      return await digestInWorker(blob, includeCrc);
    } catch (error) {
      console.warn('Hash worker failed, falling back to main thread.', error);
    }
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { sha256, ...(includeCrc ? { crc32: crc32(bytes) } : {}) };
}

function canUseWorker() {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

async function digestInWorker(blob: Blob, includeCrc: boolean): Promise<BlobDigest> {
  const id = ++requestId;
  const buffer = await blob.arrayBuffer();
  const worker = new Worker(new URL('./hash.worker.js', import.meta.url), { type: 'module' });

  return new Promise((resolve, reject) => {
    const cleanup = () => worker.terminate();
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Ошибка фонового хеширования.'));
    };
    worker.onmessage = (event: MessageEvent<{ id: number; sha256?: string; crc32?: number; error?: string }>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.error || !event.data.sha256) {
        reject(new Error(event.data.error || 'Не удалось вычислить контрольную сумму.'));
        return;
      }
      resolve({ sha256: event.data.sha256, crc32: event.data.crc32 });
    };
    worker.postMessage({ id, buffer, includeCrc }, [buffer]);
  });
}
