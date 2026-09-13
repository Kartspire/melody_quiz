import { describe, expect, it } from 'vitest';
import { hasSeenAudioEditorGuide, markAudioEditorGuideSeen, readAudioEditorMode, writeAudioEditorMode } from './audioEditorUi';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('audio editor UI preferences', () => {
  it('defaults to simple mode and persists the advanced choice', () => {
    const storage = new MemoryStorage() as unknown as Storage;
    expect(readAudioEditorMode(storage)).toBe('simple');
    writeAudioEditorMode('advanced', storage);
    expect(readAudioEditorMode(storage)).toBe('advanced');
  });

  it('tracks whether the first-run guide was completed', () => {
    const storage = new MemoryStorage() as unknown as Storage;
    expect(hasSeenAudioEditorGuide(storage)).toBe(false);
    markAudioEditorGuideSeen(storage);
    expect(hasSeenAudioEditorGuide(storage)).toBe(true);
  });
});
