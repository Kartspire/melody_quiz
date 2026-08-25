import { assertAudioProcessingFile, assertDecodableDuration } from './audioProcessingLimits';
import { readAudioDuration } from './audioMetadata';
import { encodeStereoWav } from './wav';

export const MIN_CLIP_SECONDS = 0.1;

export type TrimRange = {
  start: number;
  end: number;
};

export async function createTrimmedWav(
  file: File,
  range: TrimRange,
  signal?: AbortSignal,
): Promise<Blob> {
  assertAudioProcessingFile(file);
  signal?.throwIfAborted();

  let audioContext: AudioContext | null = null;
  let abortHandler: (() => void) | null = null;
  try {
    const metadataDuration = await readAudioDuration(file, signal);
    assertDecodableDuration(metadataDuration);
    signal?.throwIfAborted();

    audioContext = new AudioContext();
    const context = audioContext;
    abortHandler = () => {
      void context.close().catch(() => undefined);
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    const sourceBytes = await file.arrayBuffer();
    signal?.throwIfAborted();
    const decoded = await context.decodeAudioData(sourceBytes);
    signal?.throwIfAborted();
    assertDecodableDuration(decoded.duration);

    const { startSample, endSample } = resolveTrimSampleRange(
      decoded.duration,
      decoded.sampleRate,
      range.start,
      range.end,
    );

    const leftSource = decoded.getChannelData(0);
    const rightSource = decoded.numberOfChannels > 1
      ? decoded.getChannelData(1)
      : leftSource;

    signal?.throwIfAborted();
    const left = leftSource.slice(startSample, endSample);
    const right = rightSource.slice(startSample, endSample);
    signal?.throwIfAborted();
    return encodeStereoWav(left, right, decoded.sampleRate);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Операция отменена.', 'AbortError');
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof Error && /слишком короткий|границ|слишком длинный|Максимальн/i.test(error.message)) throw error;
    const message = error instanceof Error ? error.message : '';
    throw new Error(message ? `Не удалось обрезать аудио: ${message}` : 'Не удалось обрезать аудио.');
  } finally {
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch(() => undefined);
    }
  }
}

export function resolveTrimSampleRange(
  duration: number,
  sampleRate: number,
  requestedStart: number,
  requestedEnd: number,
) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Не удалось определить границы аудиофайла.');
  }

  const start = clamp(requestedStart, 0, duration);
  const end = clamp(requestedEnd, 0, duration);
  if (end - start < MIN_CLIP_SECONDS) {
    throw new Error('Выбранный фрагмент слишком короткий. Оставьте хотя бы 0,1 секунды.');
  }

  const totalSamples = Math.max(1, Math.round(duration * sampleRate));
  const startSample = Math.min(totalSamples - 1, Math.max(0, Math.floor(start * sampleRate)));
  const endSample = Math.min(totalSamples, Math.max(startSample + 1, Math.ceil(end * sampleRate)));

  return { start, end, startSample, endSample };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
