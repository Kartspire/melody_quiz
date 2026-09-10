import { loadState, saveState, subscribeToExternalStorageChanges } from '../../src/lib/storage';
import type { PersistedState } from '../../src/model/types';

if (import.meta.env.MODE !== 'test-browser') throw new Error('Test mode required');
let snapshot: PersistedState;
let externalRevision = 0;
subscribeToExternalStorageChanges((revision) => { externalRevision = revision; });
window.addEventListener('message', async (event) => {
  if (event.origin !== location.origin || event.source !== parent) return;
  try {
    if (event.data.command === 'load') snapshot = await loadState();
    if (event.data.command === 'save') await saveState(snapshot);
    parent.postMessage({ id: event.data.id, externalRevision }, location.origin);
  } catch (error) {
    parent.postMessage({ id: event.data.id, error: error instanceof Error ? error.name : String(error), externalRevision }, location.origin);
  }
});
