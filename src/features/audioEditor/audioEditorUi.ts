export type AudioEditorMode = 'simple' | 'advanced';

const MODE_STORAGE_KEY = 'melody-quiz:audio-editor-mode:v1';
const GUIDE_STORAGE_KEY = 'melody-quiz:audio-editor-guide:v1';

export function readAudioEditorMode(storage = getBrowserStorage()): AudioEditorMode {
  if (!storage) return 'simple';
  try {
    return storage.getItem(MODE_STORAGE_KEY) === 'advanced' ? 'advanced' : 'simple';
  } catch {
    return 'simple';
  }
}

export function writeAudioEditorMode(mode: AudioEditorMode, storage = getBrowserStorage()) {
  if (!storage) return;
  try {
    storage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable in private/sandboxed contexts. The editor still works in-memory.
  }
}

export function hasSeenAudioEditorGuide(storage = getBrowserStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(GUIDE_STORAGE_KEY) === 'seen';
  } catch {
    return false;
  }
}

export function markAudioEditorGuideSeen(storage = getBrowserStorage()) {
  if (!storage) return;
  try {
    storage.setItem(GUIDE_STORAGE_KEY, 'seen');
  } catch {
    // Non-critical preference; ignore storage failures.
  }
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
