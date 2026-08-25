const MEBIBYTE = 1024 * 1024;

export const AUDIO_PROCESSING_SAMPLE_RATE = 44_100;
export const MAX_AUDIO_SOURCE_BYTES = 100 * MEBIBYTE;
export const MAX_AUDIO_DECODE_SECONDS = 8 * 60;
export const MAX_VOCAL_REMOVAL_SECONDS = 90;
export const RECOMMENDED_VOCAL_REMOVAL_SECONDS = 60;

const KNOWN_AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i;

export function assertAudioProcessingFile(file: File) {
  if (!(file instanceof File) || file.size <= 0) {
    throw new Error('Выберите непустой аудиофайл.');
  }
  if (file.size > MAX_AUDIO_SOURCE_BYTES) {
    throw new Error(`Файл слишком большой. Максимальный размер для браузерной обработки — ${formatMegabytes(MAX_AUDIO_SOURCE_BYTES)}.`);
  }
  if (file.type && !file.type.startsWith('audio/') && !KNOWN_AUDIO_EXTENSION.test(file.name)) {
    throw new Error('Выбранный файл не похож на аудио. Используйте MP3, WAV, OGG, M4A или другой формат, который читает браузер.');
  }
}

export function assertDecodableDuration(duration: number) {
  assertFiniteDuration(duration);
  if (duration > MAX_AUDIO_DECODE_SECONDS) {
    throw new Error(`Трек слишком длинный для безопасной нарезки в браузере. Максимальная длительность исходника — ${formatProcessingLimit(MAX_AUDIO_DECODE_SECONDS)}.`);
  }
}

export function assertVocalRemovalDuration(duration: number) {
  assertFiniteDuration(duration);
  if (duration > MAX_VOCAL_REMOVAL_SECONDS) {
    throw new Error(`Для удаления вокала выберите фрагмент не длиннее ${formatProcessingLimit(MAX_VOCAL_REMOVAL_SECONDS)}. Это ограничение защищает вкладку от нехватки памяти.`);
  }
}

export function estimateDecodedStereoBytes(duration: number, sampleRate = AUDIO_PROCESSING_SAMPLE_RATE) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  return Math.ceil(duration * sampleRate) * 2 * Float32Array.BYTES_PER_ELEMENT;
}

export function formatProcessingLimit(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${minutes} мин` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function assertFiniteDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Не удалось определить длительность аудиофайла.');
  }
}

function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / MEBIBYTE)} МБ`;
}

