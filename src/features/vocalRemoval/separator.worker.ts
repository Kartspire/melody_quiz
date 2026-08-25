import { encodeStereoWav } from './wav';

const ORT_MODULE_URL = 'https://unpkg.com/onnxruntime-web@1.27.0/dist/ort.webgpu.bundle.min.mjs';
const ORT_WASM_BASE_URL = 'https://unpkg.com/onnxruntime-web@1.27.0/dist/';
const DEMUCS_MODULE_URL = 'https://unpkg.com/demucs-web@1.0.2/src/index.js';
const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';

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

type SeparateRequest = {
  type: 'separate';
  requestId: number;
  left: ArrayBuffer;
  right: ArrayBuffer;
  sampleRate: number;
};

type PrepareRequest = {
  type: 'prepare';
};

type WorkerRequest = SeparateRequest | PrepareRequest;

type WorkerProgress = {
  type: 'progress';
  requestId: number;
  phase: 'runtime' | 'model-download' | 'model-init' | 'separate' | 'encode';
  progress: number | null;
  message: string;
};

type WorkerResult = {
  type: 'result';
  requestId: number;
  blob: Blob;
};

type WorkerFailure = {
  type: 'error';
  requestId: number;
  error: { name: string; message: string; stack?: string };
};

type WorkerScope = typeof globalThis & {
  postMessage: (message: WorkerProgress | WorkerResult | WorkerFailure) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void) => void;
};

const scope = globalThis as WorkerScope;
let processorPromise: Promise<DemucsProcessorLike> | null = null;
let processor: DemucsProcessorLike | null = null;
let activeRequestId = 0;

scope.addEventListener('message', (event) => {
  if (event.data.type === 'prepare') {
    void getProcessor().catch(() => undefined);
    return;
  }
  void separate(event.data);
});

async function separate(request: SeparateRequest) {
  activeRequestId = request.requestId;
  try {
    emit('runtime', null, 'Подготавливаем модуль разделения…');
    const currentProcessor = await getProcessor();
    const left = new Float32Array(request.left);
    const right = new Float32Array(request.right);

    emit('separate', 0, 'Отделяем вокал от музыки…');
    let result: SeparationResult | null = await currentProcessor.separate(left, right);

    emit('encode', null, 'Собираем инструментальную дорожку…');
    const instrumental = mixInstrumentalInPlace(result);
    result = null;
    const blob = encodeStereoWav(instrumental.left, instrumental.right, request.sampleRate);

    scope.postMessage({ type: 'result', requestId: request.requestId, blob });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      requestId: request.requestId,
      error: serializeError(error),
    });
  }
}

async function getProcessor() {
  if (processor) return processor;
  if (processorPromise) return processorPromise;

  processorPromise = (async () => {
    emit('runtime', null, 'Загружаем ML-runtime…');
    const [ort, demucs] = await Promise.all([
      importRemote<OrtModule>(ORT_MODULE_URL),
      importRemote<DemucsModule>(DEMUCS_MODULE_URL),
    ]);

    ort.env.wasm.wasmPaths = ORT_WASM_BASE_URL;
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated
      ? Math.max(1, Math.min(4, globalThis.navigator?.hardwareConcurrency || 1))
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

function mixInstrumentalInPlace(result: SeparationResult) {
  const left = result.other.left;
  const right = result.other.right;
  const length = Math.min(
    left.length,
    right.length,
    result.drums.left.length,
    result.drums.right.length,
    result.bass.left.length,
    result.bass.right.length,
  );
  let peak = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] + result.drums.left[index] + result.bass.left[index];
    const rightValue = right[index] + result.drums.right[index] + result.bass.right[index];
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

  return {
    left: left.length === length ? left : left.subarray(0, length),
    right: right.length === length ? right : right.subarray(0, length),
  };
}

function emit(
  phase: WorkerProgress['phase'],
  progress: number | null,
  message: string,
) {
  scope.postMessage({
    type: 'progress',
    requestId: activeRequestId,
    phase,
    progress,
    message,
  });
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatMegabytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 МБ';
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} МБ`;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: 'Error', message: String(error || 'Неизвестная ошибка') };
}

async function importRemote<T>(url: string): Promise<T> {
  return import(/* @vite-ignore */ url) as Promise<T>;
}
