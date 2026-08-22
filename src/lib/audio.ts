import type { AudioAsset } from '../model/types';
import { DATA_LIMITS } from '../model/limits';
import { sha256Blob } from './contentHash';

export const AUDIO_FILE_ACCEPT = 'audio/*,.mp3,.wav,.ogg,.opus,.flac,.m4a,.mp4';

export async function createContentAddressedAudioAsset(file: File): Promise<AudioAsset> {
  await validateAudioBlob(file, file.name, file.type, true);
  const sha256 = await sha256Blob(file);
  return {
    id: sha256,
    name: sanitizeAudioName(file.name),
    type: file.type || inferAudioType(file.name),
    blob: file,
    sha256,
    verified: true,
  };
}

export async function canonicalizeAudioAsset(asset: Partial<AudioAsset> & { id?: string; name?: string; type?: string; blob?: Blob }): Promise<AudioAsset> {
  if (!(asset.blob instanceof Blob)) throw new Error('В хранилище найден повреждённый аудиофайл без Blob-данных.');
  const name = sanitizeAudioName(asset.name || 'audio');
  const type = typeof asset.type === 'string' ? asset.type : '';
  await validateAudioBlob(asset.blob, name, type, false);
  const knownHash = typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(asset.sha256) ? asset.sha256.toLowerCase() : null;
  const sha256 = knownHash && asset.id === knownHash ? knownHash : await sha256Blob(asset.blob);
  return { id: sha256, name, type: type || inferAudioType(name), blob: asset.blob, sha256, verified: true };
}

export async function validateAudioBlob(blob: Blob, name: string, type: string, verifyBrowserPlayback: boolean): Promise<void> {
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error(`Аудиофайл «${name}» пустой или повреждён.`);
  if (blob.size > DATA_LIMITS.audioFileBytes) throw new Error(`Аудиофайл «${name}» превышает лимит ${formatBytes(DATA_LIMITS.audioFileBytes)}.`);

  const header = new Uint8Array(await blob.slice(0, Math.min(blob.size, 32)).arrayBuffer());
  if (!matchesKnownAudioSignature(header, type, name)) {
    throw new Error(`Аудиофайл «${name}» не похож на корректный MP3, WAV, OGG, FLAC или M4A/MP4 файл.`);
  }

  if (verifyBrowserPlayback) await validateBrowserPlayback(blob, name);
}

function matchesKnownAudioSignature(bytes: Uint8Array, type: string, name: string) {
  const lowerType = type.toLowerCase();
  const lowerName = name.toLowerCase();
  const known = lowerType || lowerName;

  if (known.includes('mpeg') || lowerName.endsWith('.mp3')) {
    return ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  if (known.includes('wav') || lowerName.endsWith('.wav')) {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
  }
  if (known.includes('ogg') || lowerName.endsWith('.ogg') || lowerName.endsWith('.opus')) {
    return ascii(bytes, 0, 4) === 'OggS';
  }
  if (known.includes('flac') || lowerName.endsWith('.flac')) {
    return ascii(bytes, 0, 4) === 'fLaC';
  }
  if (known.includes('mp4') || known.includes('m4a') || lowerName.endsWith('.m4a') || lowerName.endsWith('.mp4')) {
    return ascii(bytes, 4, 4) === 'ftyp';
  }

  // Unknown browser-supported formats are allowed; the browser metadata check below is authoritative for uploads.
  return true;
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
        reject(new Error(`Браузер не смог прочитать аудиофайл «${name}». Используйте MP3, WAV, OGG, FLAC или M4A.`));
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

function inferAudioType(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  return 'application/octet-stream';
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  return `${Math.round(bytes / 1024 ** 2)} МБ`;
}
