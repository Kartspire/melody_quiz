export function AudioEditorTransport({
  playheadMs,
  durationMs,
  isPlaying,
  selectedCount,
  canCrossfade,
  onTogglePlayback,
  onSeek,
  onAddMarker,
  onCrossfade,
}: {
  playheadMs: number;
  durationMs: number;
  isPlaying: boolean;
  selectedCount: number;
  canCrossfade: boolean;
  onTogglePlayback: () => void;
  onSeek: (positionMs: number) => void;
  onAddMarker: () => void;
  onCrossfade: () => void;
}) {
  return (
    <>
      <div className="audio-editor-transport">
        <button
          className="audio-editor-play"
          title="Воспроизвести или поставить на паузу (Space)"
          aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
          disabled={durationMs <= 0}
          onClick={onTogglePlayback}
        >{isPlaying ? 'Ⅱ' : '▶'}</button>
        <strong title="Текущая позиция курсора">{formatMs(playheadMs)}</strong>
        <input
          aria-label="Позиция воспроизведения"
          title="Перетащите, чтобы быстро переместить курсор"
          type="range"
          min={0}
          max={Math.max(durationMs, playheadMs, 1_000)}
          step={10}
          value={playheadMs}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <span title="Длительность готового монтажа">{formatMs(durationMs)}</span>
      </div>

      <div className="audio-editor-editbar">
        <button className="secondary-button" title="Поставить метку в позиции курсора" onClick={onAddMarker}>+ Маркер</button>
        <button className="secondary-button" title="Применить Fade In и Fade Out по 1 секунде ко всем выбранным фрагментам. Положение и дорожка не важны." disabled={!canCrossfade} onClick={onCrossfade}>Crossfade 1 с</button>
        <span className="audio-editor-selection-summary">{selectedCount > 0 ? `Выбрано: ${selectedCount}` : 'Фрагменты не выбраны'}</span>
      </div>

      <div className="audio-editor-shortcuts" aria-label="Горячие клавиши аудиоредактора">
        <span><kbd>Space</kbd> play/pause</span>
        <span><kbd>S</kbd> разрезать</span>
        <span><kbd>Delete</kbd> удалить</span>
        <span><kbd>Ctrl/Cmd+C</kbd> копировать</span>
        <span><kbd>Ctrl/Cmd+V</kbd> вставить</span>
        <span><kbd>Ctrl/Cmd+Z</kbd> отменить</span>
        <span><kbd>Ctrl/Cmd+Shift+Z</kbd> вернуть</span>
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
