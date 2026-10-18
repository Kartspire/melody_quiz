import { analyzeStereo48k } from './loudness';
self.onmessage = (event: MessageEvent<Float32Array[]>) => {
  try { self.postMessage({ result: analyzeStereo48k(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Ошибка анализа' }); }
};
