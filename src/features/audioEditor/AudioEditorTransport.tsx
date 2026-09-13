import type { AudioEditorMode } from './audioEditorUi';
import { AudioEditorHelpTip } from './AudioEditorGuide';

export function AudioEditorTransport({
  mode,
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
  mode: AudioEditorMode;
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
        <label className="audio-editor-zoom">
          Масштаб
          <AudioEditorHelpTip text="Приближает таймлайн для точной нарезки. Также работает Ctrl/Cmd + колесо мыши над таймлайном." />
          <input aria-label="Масштаб таймлайна" type="range" min={16} max={180} step={4} value={zoom} onChange={(event) => onZoomChange(Number(event.target.value))} />
        </label>
      </div>

      {mode === 'advanced' ? (
        <>
          <div className="audio-editor-editbar">
            <label className="audio-editor-ripple-toggle">
              <input type="checkbox" checked={ripple} onChange={(event) => onRippleChange(event.target.checked)} />
              <span>Ripple</span>
              <AudioEditorHelpTip text="Когда включён: вставка раздвигает материал справа, а удаление стягивает оставшиеся фрагменты. Выключите для наложений." />
            </label>
            <button className="secondary-button" title="Поставить метку в позиции курсора" onClick={onAddMarker}>+ Маркер</button>
            <button className="secondary-button" title="Скопировать выбранные фрагменты (Ctrl/Cmd+C)" disabled={selectedCount === 0} onClick={onCopy}>Копировать</button>
            <button className="secondary-button" title="Вставить скопированные фрагменты в позицию курсора (Ctrl/Cmd+V)" disabled={!canPaste} onClick={onPaste}>Вставить</button>
            <button className="secondary-button" title="Создать плавный переход между двумя выбранными пересекающимися фрагментами" disabled={!canCrossfade} onClick={onCrossfade}>Crossfade</button>
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
      ) : (
        <div className="audio-editor-simple-hint">
          <span>Подсказка:</span> кликните по фрагменту, затем тяните его края для обрезки. <kbd>S</kbd> разрезает фрагмент в позиции курсора.
        </div>
      )}
    </>
  );
}

function formatMs(ms: number) {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0')}`;
}
