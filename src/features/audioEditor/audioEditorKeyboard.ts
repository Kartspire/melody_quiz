export type AudioEditorKeyboardCommand =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'toggle-playback'
  | 'delete-selection'
  | 'split';

export type AudioEditorKeyboardContext = {
  advanced: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  hasActiveClip: boolean;
};

type KeyboardLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

export function getAudioEditorKeyboardCommand(
  event: KeyboardLike,
  context: AudioEditorKeyboardContext,
): AudioEditorKeyboardCommand | null {
  const modifier = event.ctrlKey || event.metaKey;

  if (modifier && event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
  if (modifier && event.code === 'KeyY') return 'redo';
  if (context.advanced && modifier && event.code === 'KeyC' && context.hasSelection) return 'copy';
  if (context.advanced && modifier && event.code === 'KeyV' && context.hasClipboard) return 'paste';
  if (event.code === 'Space') return 'toggle-playback';
  if ((event.code === 'Delete' || event.code === 'Backspace') && context.hasSelection) return 'delete-selection';
  if (event.code === 'KeyS' && context.hasActiveClip) return 'split';

  return null;
}
