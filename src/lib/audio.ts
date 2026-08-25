import type { AudioAsset } from '../model/types';
import { DATA_LIMITS } from '../model/limits';
import {
  AUDIO_FILE_ACCEPT,
  canonicalAudioMimeType,
  inferAudioFormat,
  inspectAudioHeader,
  type AudioBlobInspection,
} from '../model/media/domain/audioAsset';
import { sha256Blob } from './contentHash';

export { AUDIO_FILE_ACCEPT };

export async function createContentAddressedAudioAsset(file: File): Promise<AudioAsset> {
  const inspection = await validateAudioBlob(file, file.name, file.type, true);
  const sha256 = await sha256Blob(file);
  return {
    id: sha256,
    name: sanitizeAudioName(file.name),
    type: inspection.mimeType,
    blob: file,
    sha256,
    verified: true,
  };
}

export async function canonicalizeAudioAsset(
  asset: Partial<AudioAsset> & { id?: string; name?: string; type?: string; blob?: Blob },
  options: { verifyBrowserPlayback?: boolean; verifyMetadata?: boolean } = {},
): Promise<AudioAsset> {
  if (!(asset.blob instanceof Blob)) throw new Error('В хранилище найден повреждённый аудиофайл без Blob-данных.');
  const name = sanitizeAudioName(asset.name || 'audio');
  const type = typeof asset.type === 'string' ? asset.type : '';
  const verifyBrowserPlayback = options.verifyBrowserPlayback ?? false;
  const verifyMetadata = options.verifyMetadata ?? verifyBrowserPlayback;
  const inspection = await validateAudioBlob(asset.blob, name, type, verifyBrowserPlayback, verifyMetadata);
  const knownHash = typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(asset.sha256) ? asset.sha256.toLowerCase() : null;
  const sha256 = knownHash && asset.id === knownHash ? knownHash : await sha256Blob(asset.blob);
  return {
    id: sha256,
    name,
    type: inspection.mimeType,
    blob: asset.blob,
    sha256,
    verified: true,
  };
}

/**
 * Verifies the physical container independently from browser decodability.
 * `verifyBrowserPlayback` is intentionally an admission-time check only: an
 * AudioAsset's persisted `verified` flag means its content hash/container were
 * verified, not that every future browser can decode that codec.
 */
export async function validateAudioBlob(
  blob: Blob,
  name: string,
  type: string,
  verifyBrowserPlayback: boolean,
  verifyMetadata = verifyBrowserPlayback,
): Promise<AudioBlobInspection> {
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error(`Аудиофайл «${name}» пустой или повреждён.`);
  const maxBytes = verifyBrowserPlayback ? DATA_LIMITS.audioUploadBytes : DATA_LIMITS.audioFileBytes;
  if (blob.size > maxBytes) throw new Error(`Аудиофайл «${name}» превышает лимит ${formatBytes(maxBytes)}.`);

  const header = new Uint8Array(await blob.slice(0, Math.min(blob.size, 32)).arrayBuffer());
  const inspection = inspectAudioHeader(header);
  if (!inspection) {
    throw new Error(`Аудиофайл «${name}» не похож на корректный MP3, WAV, OGG/Opus, FLAC или M4A/MP4 файл.`);
  }

  const hintedFormat = inferAudioFormat(name, type);
  if (verifyMetadata && hintedFormat && hintedFormat !== inspection.format) {
    throw new Error(`Расширение или MIME-тип файла «${name}» не соответствует его аудиоформату.`);
  }

  if (verifyBrowserPlayback) await validateBrowserPlayback(blob, name);
  return { ...inspection, mimeType: canonicalAudioMimeType(inspection.format) };
}

async function validateBrowserPlayback(blob: Blob, name: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return;

  const audio = document.createElement('audio');
  const url = URL.createObjectURL(blob);
  audio.preload = 'metadata';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`Не удалось проверить аудиофайл «${name}»: браузер не прочитал метаданные.`)), 15_000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        audio.onloadedmetadata = null;
        audio.onerror = null;
      };
      audio.onloadedmetadata = () => {
        cleanup();
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
          reject(new Error(`Аудиофайл «${name}» не содержит воспроизводимого аудио.`));
          return;
        }
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error(`Браузер не смог прочитать аудиофайл «${name}». Используйте MP3, WAV, OGG/Opus, FLAC или M4A.`));
      };
      audio.src = url;
      audio.load();
    });
  } finally {
    audio.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

function sanitizeAudioName(value: string) {
  return value.trim().replace(/[\u0000-\u001f]/g, '').slice(0, DATA_LIMITS.text.audioName) || 'audio';
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  return `${Math.round(bytes / 1024 ** 2)} МБ`;
}
