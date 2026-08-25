import { encodeStereoWav } from './wav';

const SAMPLE_RATE = 44_100;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 8 * 60;
const ORT_MODULE_URL = 'https://unpkg.com/onnxruntime-web@1.27.0/dist/ort.webgpu.bundle.min.mjs';
const ORT_WASM_BASE_URL = 'https://unpkg.com/onnxruntime-web@1.27.0/dist/';
const DEMUCS_MODULE_URL = 'https://unpkg.com/demucs-web@1.0.2/src/index.js';
const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';

export type VocalRemovalPhase =
  | 'runtime'
  | 'decode'
  | 'model-download'
  | 'model-init'
  | 'separate'
  | 'encode';

export type VocalRemovalProgress = {
  phase: VocalRemovalPhase;
  progress: number | null;
  message: string;
};

type ProgressHandler = (progress: VocalRemovalProgress) => void;

type Stem = {
  left: Float32Array;
  right: Float32Array;
};

type SeparationResult = {
  drums: Stem;
  bass: Stem;
  other: Stem;
  vocals: Stem;
};

type DemucsProcessorLike = {
  onProgress: (info: { progress: number; currentSegment: number; totalSegments: number }) => void;
  onLog: (phase: string, message: string) => void;
  onDownloadProgress: (loaded: number, total: number) => void;
  session?: { release?: () => Promise<void> | void } | null;
  loadModel: (pathOrBuffer?: string | ArrayBuffer) => Promise<unknown>;
  separate: (left: Float32Array, right: Float32Array) => Promise<SeparationResult>;
};

type DemucsModule = {
  DemucsProcessor: new (options: {
    ort: unknown;
    sessionOptions?: Record<string, unknown>;
    onProgress?: DemucsProcessorLike['onProgress'];
    onLog?: DemucsProcessorLike['onLog'];
    onDownloadProgress?: DemucsProcessorLike['onDownloadProgress'];
  }) => DemucsProcessorLike;
};

type OrtModule = {
  env: {
    wasm: {
      wasmPaths?: string;
      numThreads?: number;
    };
  };
};

let processorPromise: Promise<DemucsProcessorLike> | null = null;
let processor: DemucsProcessorLike | null = null;
let activeProgressHandler: ProgressHandler | null = null;
let separationInProgress = false;
let releaseRequested = false;
let activeAbortSignal: AbortSignal | null = null;

export async function createInstrumental(
  file: File,
  onProgress: ProgressHandler,
  signal?: AbortSignal,
): Promise<Blob> {
  if (separationInProgress) throw new Error('Сейчас уже обрабатывается другой трек.');
  assertSupportedFile(file);

  signal?.throwIfAborted();
  separationInProgress = true;
  releaseRequested = false;
  activeProgressHandler = onProgress;
  activeAbortSignal = signal ?? null;

  let audioContext: AudioContext | null = null;
  try {
    emit('runtime', null, 'Подготавливаем модуль разделения…');
    const currentProcessor = await getProcessor();
    signal?.throwIfAborted();

    emit('decode', null, 'Декодируем аудиофайл…');
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const sourceBytes = await file.arrayBuffer();
    signal?.throwIfAborted();
    const decoded = await audioContext.decodeAudioData(sourceBytes);
    signal?.throwIfAborted();

    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
      throw new Error('Не удалось определить длительность аудиофайла.');
    }
    if (decoded.duration > MAX_DURATION_SECONDS) {
      throw new Error('Трек слишком длинный. Для обработки в браузере поддерживаются файлы до 8 минут.');
    }

    const left = new Float32Array(decoded.getChannelData(0));
    const right = decoded.numberOfChannels > 1
      ? new Float32Array(decoded.getChannelData(1))
      : new Float32Array(left);

    emit('separate', 0, 'Отделяем вокал от музыки…');
    let result: SeparationResult | null = await currentProcessor.separate(left, right);
    signal?.throwIfAborted();

    emit('encode', null, 'Собираем инструментальную дорожку…');
    const instrumental = mixInstrumental(result);
    result = null;
    signal?.throwIfAborted();

    return encodeStereoWav(instrumental.left, instrumental.right, SAMPLE_RATE);
  } catch (error) {
    if (!processor) processorPromise = null;
    throw normalizeSeparationError(error);
  } finally {
    activeProgressHandler = null;
    activeAbortSignal = null;
    separationInProgress = false;
    if (audioContext) void audioContext.close().catch(() => undefined);
    if (releaseRequested) void releaseVocalSeparator();
  }
}

export async function releaseVocalSeparator() {
  if (separationInProgress) {
    releaseRequested = true;
    return;
  }

  const current = processor;
  processor = null;
  processorPromise = null;
  releaseRequested = false;
  try {
    await current?.session?.release?.();
  } catch (error) {
    console.warn('Failed to release vocal separator session', error);
  }
}

export function getVocalRemovalCapabilities() {
  return {
    webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    maxSourceBytes: MAX_SOURCE_BYTES,
    maxDurationSeconds: MAX_DURATION_SECONDS,
  };
}

async function getProcessor() {
  if (processor) return processor;
  if (processorPromise) return processorPromise;

  processorPromise = (async () => {
    emit('runtime', null, 'Загружаем локальный ML-runtime…');
    const [ort, demucs] = await Promise.all([
      importRemote<OrtModule>(ORT_MODULE_URL),
      importRemote<DemucsModule>(DEMUCS_MODULE_URL),
    ]);

    ort.env.wasm.wasmPaths = ORT_WASM_BASE_URL;
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated
      ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
      : 1;

    const created = new demucs.DemucsProcessor({
      ort,
      sessionOptions: {
        enableCpuMemArena: false,
        enableMemPattern: false,
      },
      onProgress: ({ progress, currentSegment, totalSegments }) => {
        emit(
          'separate',
          clampProgress(progress),
          `Отделяем вокал: фрагмент ${currentSegment} из ${totalSegments}`,
        );
      },
      onDownloadProgress: (loaded, total) => {
        emit(
          'model-download',
          total > 0 ? clampProgress(loaded / total) : null,
          `Загружаем модель: ${formatMegabytes(loaded)} из ${formatMegabytes(total)}`,
        );
      },
      onLog: (phase, message) => {
        if (phase === 'model' && /loading/i.test(message)) {
          emit('model-init', null, 'Подготавливаем модель HTDemucs…');
        }
      },
    });

    emit('model-download', 0, 'Загружаем модель HTDemucs (~180 МБ)…');
    await created.loadModel(MODEL_URL);
    emit('model-init', 1, 'Модель готова');
    processor = created;
    return created;
  })().catch((error) => {
    processorPromise = null;
    processor = null;
    throw error;
  });

  return processorPromise;
}

function mixInstrumental(result: SeparationResult) {
  const length = Math.min(
    result.drums.left.length,
    result.drums.right.length,
    result.bass.left.length,
    result.bass.right.length,
    result.other.left.length,
    result.other.right.length,
  );
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let peak = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = result.drums.left[index] + result.bass.left[index] + result.other.left[index];
    const rightValue = result.drums.right[index] + result.bass.right[index] + result.other.right[index];
    left[index] = leftValue;
    right[index] = rightValue;
    peak = Math.max(peak, Math.abs(leftValue), Math.abs(rightValue));
  }

  if (peak > 0.99) {
    const gain = 0.99 / peak;
    for (let index = 0; index < length; index += 1) {
      left[index] *= gain;
      right[index] *= gain;
    }
  }

  return { left, right };
}

function assertSupportedFile(file: File) {
  if (!(file instanceof File) || file.size <= 0) throw new Error('Выберите непустой аудиофайл.');
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Файл слишком большой. Максимальный размер для браузерной обработки — 100 МБ.');
  }
  const knownAudioExtension = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(file.name);
  if (file.type && !file.type.startsWith('audio/') && !knownAudioExtension) {
    throw new Error('Выбранный файл не похож на аудио. Используйте MP3, WAV, OGG, M4A или другой формат, который читает браузер.');
  }
}

function normalizeSeparationError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message || '';
    if (/fetch|network|failed to load|dynamically imported/i.test(message)) {
      return new Error('Не удалось загрузить модель или ML-модуль. Проверьте подключение к интернету и попробуйте ещё раз.');
    }
    if (/memory|allocation|out of memory/i.test(message)) {
      return new Error('Браузеру не хватило памяти для обработки трека. Закройте лишние вкладки или попробуйте файл короче.');
    }
    if (/decode|encoding|media|audio/i.test(message)) {
      return new Error(`Не удалось прочитать аудиофайл: ${message}`);
    }
    return error;
  }
  return new Error('Не удалось сделать минус. Попробуйте другой аудиофайл.');
}

function emit(phase: VocalRemovalPhase, progress: number | null, message: string) {
  if (activeAbortSignal?.aborted) return;
  activeProgressHandler?.({ phase, progress, message });
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatMegabytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 МБ';
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} МБ`;
}

async function importRemote<T>(url: string): Promise<T> {
  return import(/* @vite-ignore */ url) as Promise<T>;
}
