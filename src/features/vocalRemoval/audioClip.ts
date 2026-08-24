import { encodeStereoWav } from './wav';

export const MIN_CLIP_SECONDS = 0.1;

export type TrimRange = {
  start: number;
  end: number;
};

export async function createTrimmedWav(file: File, range: TrimRange): Promise<Blob> {
  if (!(file instanceof File) || file.size <= 0) {
    throw new Error('Выберите непустой аудиофайл.');
  }

  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContext();
    const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
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

    const left = leftSource.slice(startSample, endSample);
    const right = rightSource.slice(startSample, endSample);
    return encodeStereoWav(left, right, decoded.sampleRate);
  } catch (error) {
    if (error instanceof Error && /слишком короткий|границ/i.test(error.message)) throw error;
    const message = error instanceof Error ? error.message : '';
    throw new Error(message ? `Не удалось обрезать аудио: ${message}` : 'Не удалось обрезать аудио.');
  } finally {
    if (audioContext) void audioContext.close().catch(() => undefined);
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
