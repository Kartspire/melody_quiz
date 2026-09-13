import { describe, expect, it } from 'vitest';
import { getAudioEditorKeyboardCommand } from './audioEditorKeyboard';

const context = {
  advanced: true,
  hasSelection: true,
  hasClipboard: true,
  hasActiveClip: true,
};

describe('audio editor keyboard shortcuts', () => {
  it('uses physical key codes so shortcuts do not depend on keyboard layout', () => {
    expect(getAudioEditorKeyboardCommand({ code: 'KeyC', key: 'с', ctrlKey: true, metaKey: false, shiftKey: false }, context)).toBe('copy');
    expect(getAudioEditorKeyboardCommand({ code: 'KeyV', key: 'м', ctrlKey: true, metaKey: false, shiftKey: false }, context)).toBe('paste');
    expect(getAudioEditorKeyboardCommand({ code: 'KeyZ', key: 'я', ctrlKey: true, metaKey: false, shiftKey: false }, context)).toBe('undo');
    expect(getAudioEditorKeyboardCommand({ code: 'KeyS', key: 'ы', ctrlKey: false, metaKey: false, shiftKey: false }, context)).toBe('split');
  });

  it('keeps advanced-only clipboard shortcuts disabled in simple mode', () => {
    const simple = { ...context, advanced: false };
    expect(getAudioEditorKeyboardCommand({ code: 'KeyC', key: 'с', ctrlKey: true, metaKey: false, shiftKey: false }, simple)).toBeNull();
    expect(getAudioEditorKeyboardCommand({ code: 'Space', key: ' ', ctrlKey: false, metaKey: false, shiftKey: false }, simple)).toBe('toggle-playback');
  });
});
