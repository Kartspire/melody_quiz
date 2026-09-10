export function AudioEditorTransport({
  playheadMs,
  durationMs,
  isPlaying,
  zoom,
  ripple,
  selectedCount,
  canPaste,
  canCrossfade,
  onTogglePlayback,
  onSeek,
  onZoomChange,
  onRippleChange,
  onAddMarker,
  onCopy,
  onPaste,
  onCrossfade,
}: {
  playheadMs: number;
  durationMs: number;
  isPlaying: boolean;
  zoom: number;
  ripple: boolean;
  selectedCount: number;
  canPaste: boolean;
  canCrossfade: boolean;
  onTogglePlayback: () => void;
  onSeek: (positionMs: number) => void;
  onZoomChange: (value: number) => void;
  onRippleChange: (value: boolean) => void;
  onAddMarker: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onCrossfade: () => void;
}) {
  return (
    <>
      <div className="audio-editor-transport">
        <button className="audio-editor-play" title="Пробел" disabled={durationMs <= 0} onClick={onTogglePlayback}>{isPlaying ? 'Ⅱ' : '▶'}</button>
        <strong>{formatMs(playheadMs)}</strong>
        <input
          aria-label="Позиция воспроизведения"
          type="range"
          min={0}
          max={Math.max(durationMs, playheadMs, 1_000)}
          step={10}
          value={playheadMs}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <span>{formatMs(durationMs)}</span>
        <label className="audio-editor-zoom">Масштаб <input type="range" min={16} max={180} step={4} value={zoom} onChange={(event) => onZoomChange(Number(event.target.value))} /></label>
      </div>
      <div className="audio-editor-editbar">
        <label className="audio-editor-ripple-toggle" title="При вставке раздвигать материал справа, при удалении — стягивать">
          <input type="checkbox" checked={ripple} onChange={(event) => onRippleChange(event.target.checked)} />
          <span>Ripple</span>
        </label>
        <button className="secondary-button" onClick={onAddMarker}>+ Маркер</button>
        <button className="secondary-button" disabled={selectedCount === 0} onClick={onCopy}>Копировать</button>
        <button className="secondary-button" disabled={!canPaste} onClick={onPaste}>Вставить</button>
        <button className="secondary-button" disabled={!canCrossfade} onClick={onCrossfade}>Crossfade</button>
        <span className="audio-editor-selection-summary">{selectedCount > 0 ? `Выбрано: ${selectedCount}` : 'Фрагменты не выбраны'}</span>
      </div>
      <div className="audio-editor-shortcuts" aria-label="Горячие клавиши аудиоредактора">
        <span><kbd>Space</kbd> play/pause</span>
        <span><kbd>S</kbd> разрезать</span>
        <span><kbd>Delete</kbd> удалить</span>
        <span><kbd>Ctrl/Cmd+C</kbd> копировать</span>
        <span><kbd>Ctrl/Cmd+V</kbd> вставить</span>
        <span><kbd>Ctrl/Cmd+Z</kbd> отменить</span>
        <span><kbd>Ctrl/Cmd+колесо</kbd> масштаб</span>
      </div>
    </>
  );
}

function formatMs(ms: number) {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0')}`;
}
