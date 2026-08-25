import { assertAudioProcessingFile } from './audioProcessingLimits';

export async function readAudioDuration(file: File, signal?: AbortSignal): Promise<number> {
  assertAudioProcessingFile(file);
  signal?.throwIfAborted();

  const source = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';

  try {
    return await new Promise<number>((resolve, reject) => {
      let settled = false;

      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('error', handleError);
        signal?.removeEventListener('abort', handleAbort);
        action();
      };

      const handleLoadedMetadata = () => {
        const duration = audio.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          finish(() => reject(new Error('Не удалось определить длительность аудиофайла.')));
          return;
        }
        finish(() => resolve(duration));
      };

      const handleError = () => {
        finish(() => reject(new Error('Браузер не смог прочитать метаданные аудиофайла.')));
      };

      const handleAbort = () => {
        finish(() => reject(createAbortError()));
      };

      audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      audio.addEventListener('error', handleError, { once: true });
      signal?.addEventListener('abort', handleAbort, { once: true });
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      audio.src = source;
      audio.load();
    });
  } finally {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(source);
  }
}

function createAbortError() {
  return new DOMException('Операция отменена.', 'AbortError');
}
