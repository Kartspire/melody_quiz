export function AudioEditorHelpTip({ text }: { text: string }) {
  return <span className="audio-editor-help-tip" tabIndex={0} role="note" aria-label={text} data-tooltip={text}>?</span>;
}
