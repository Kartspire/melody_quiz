import {
  AUDIO_PROCESSING_SAMPLE_RATE,
  MAX_AUDIO_DECODE_SECONDS,
  MAX_AUDIO_SOURCE_BYTES,
  MAX_VOCAL_REMOVAL_SECONDS,
  RECOMMENDED_VOCAL_REMOVAL_SECONDS,
  assertAudioProcessingFile,
  assertDecodableDuration,
  assertVocalRemovalDuration,
} from './audioProcessingLimits';
import { readAudioDuration } from './audioMetadata';

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

type WorkerProgressMessage = VocalRemovalProgress & {
  type: 'progress';
  requestId: number;
};

type WorkerResultMessage = {
  type: 'result';
  requestId: number;
  blob: Blob;
};

type WorkerErrorMessage = {
  type: 'error';
  requestId: number;
  error: { name: string; message: string; stack?: string };
};

type SeparatorWorkerMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

type ActiveRequest = {
  requestId: number;
  onProgress: ProgressHandler;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

let separatorWorker: Worker | null = null;
let activeRequest: ActiveRequest | null = null;
let nextRequestId = 1;
let separationInProgress = false;

export async function createInstrumental(
  file: File,
  onProgress: ProgressHandler,
  signal?: AbortSignal,
): Promise<Blob> {
  if (separationInProgress) throw new Error('Сейчас уже обрабатывается другой трек.');
  assertAudioProcessingFile(file);
  signal?.throwIfAborted();
  separationInProgress = true;

  try {
    onProgress({ phase: 'decode', progress: null, message: 'Проверяем длительность аудиофайла…' });
    const metadataDuration = await readAudioDuration(file, signal);
    assertDecodableDuration(metadataDuration);
    assertVocalRemovalDuration(metadataDuration);
    signal?.throwIfAborted();

    onProgress({ phase: 'decode', progress: null, message: 'Декодируем аудиофайл…' });
    const decoded = await decodeStereo(file, signal);
    assertVocalRemovalDuration(decoded.duration);
    signal?.throwIfAborted();

    return await separateInWorker(decoded.left, decoded.right, onProgress, signal);
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    throw normalizeSeparationError(error);
  } finally {
    separationInProgress = false;
  }
}

export async function releaseVocalSeparator() {
  const request = activeRequest;
  if (request) {
    clearActiveRequest();
    request.reject(createAbortError());
  }
  terminateWorker();
}

export function getVocalRemovalCapabilities() {
  return {
    webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    maxSourceBytes: MAX_AUDIO_SOURCE_BYTES,
    maxDurationSeconds: MAX_VOCAL_REMOVAL_SECONDS,
    maxDecodeDurationSeconds: MAX_AUDIO_DECODE_SECONDS,
    recommendedDurationSeconds: RECOMMENDED_VOCAL_REMOVAL_SECONDS,
  };
}

async function decodeStereo(file: File, signal?: AbortSignal) {
  let audioContext: AudioContext | null = null;
  let abortHandler: (() => void) | null = null;

  try {
    audioContext = new AudioContext({ sampleRate: AUDIO_PROCESSING_SAMPLE_RATE });
    const context = audioContext;
    abortHandler = () => {
      void context.close().catch(() => undefined);
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    const sourceBytes = await file.arrayBuffer();
    signal?.throwIfAborted();
    const decoded = await context.decodeAudioData(sourceBytes);
    signal?.throwIfAborted();

    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
      throw new Error('Не удалось определить длительность аудиофайла.');
    }

    const left = decoded.getChannelData(0).slice();
    const right = decoded.numberOfChannels > 1
      ? decoded.getChannelData(1).slice()
      : left.slice();

    return { left, right, duration: decoded.duration };
  } finally {
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch(() => undefined);
    }
  }
}

function separateInWorker(
  left: Float32Array,
  right: Float32Array,
  onProgress: ProgressHandler,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (activeRequest) throw new Error('Сейчас уже обрабатывается другой трек.');

  const worker = getWorker();
  const requestId = nextRequestId++;

  return new Promise<Blob>((resolve, reject) => {
    const request: ActiveRequest = { requestId, onProgress, resolve, reject, signal };
    if (signal) {
      request.onAbort = () => {
        if (activeRequest?.requestId !== requestId) return;
        const rejection = createAbortError();
        clearActiveRequest();
        terminateWorker();
        reject(rejection);
      };
      signal.addEventListener('abort', request.onAbort, { once: true });
    }
    activeRequest = request;
    if (signal?.aborted) {
      request.onAbort?.();
      return;
    }

    try {
      worker.postMessage(
      {
        type: 'separate',
        requestId,
        left: left.buffer,
        right: right.buffer,
        sampleRate: AUDIO_PROCESSING_SAMPLE_RATE,
      },
        [left.buffer, right.buffer],
      );
    } catch (error) {
      clearActiveRequest();
      terminateWorker();
      reject(error);
    }
  });
}

function getWorker() {
  if (separatorWorker) return separatorWorker;

  const worker = new Worker(new URL('./separator.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', handleWorkerCrash);
  separatorWorker = worker;
  return worker;
}

function handleWorkerMessage(event: MessageEvent<SeparatorWorkerMessage>) {
  const message = event.data;
  const request = activeRequest;
  if (!request || message.requestId !== request.requestId) return;

  if (message.type === 'progress') {
    if (!request.signal?.aborted) {
      request.onProgress({ phase: message.phase, progress: message.progress, message: message.message });
    }
    return;
  }

  clearActiveRequest();
  if (message.type === 'result') {
    request.resolve(message.blob);
    return;
  }

  const error = new Error(message.error.message);
  error.name = message.error.name || 'Error';
  if (message.error.stack) error.stack = message.error.stack;
  terminateWorker();
  request.reject(error);
}

function handleWorkerCrash(event: ErrorEvent) {
  const request = activeRequest;
  clearActiveRequest();
  terminateWorker();
  request?.reject(new Error(event.message || 'ML Worker завершился с ошибкой.'));
}

function clearActiveRequest() {
  if (!activeRequest) return;
  if (activeRequest.signal && activeRequest.onAbort) {
    activeRequest.signal.removeEventListener('abort', activeRequest.onAbort);
  }
  activeRequest = null;
}

function terminateWorker() {
  const worker = separatorWorker;
  separatorWorker = null;
  if (!worker) return;
  worker.removeEventListener('message', handleWorkerMessage);
  worker.removeEventListener('error', handleWorkerCrash);
  worker.terminate();
}

function normalizeSeparationError(error: unknown) {
  if (isAbortError(error)) return createAbortError();
  if (error instanceof Error) {
    const message = error.message || '';
    if (/fetch|network|failed to load|dynamically imported/i.test(message)) {
      return new Error('Не удалось загрузить модель или ML-модуль. Проверьте подключение к интернету и попробуйте ещё раз.');
    }
    if (/memory|allocation|out of memory/i.test(message)) {
      return new Error('Браузеру не хватило памяти для обработки трека. Выберите более короткий фрагмент и попробуйте ещё раз.');
    }
    if (/decode|encoding|media|audio/i.test(message) && !/длительност/i.test(message)) {
      return new Error(`Не удалось прочитать аудиофайл: ${message}`);
    }
    return error;
  }
  return new Error('Не удалось сделать минус. Попробуйте другой аудиофайл.');
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function createAbortError() {
  return new DOMException('Операция отменена.', 'AbortError');
}
