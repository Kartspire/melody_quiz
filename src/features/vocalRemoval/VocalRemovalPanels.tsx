import type { RefObject } from 'react';
import { formatProcessingLimit } from './audioProcessingLimits';
import { formatAudioTime } from './audioTime';
import type { VocalRemovalProgress } from './separator';
import { InlineAudioPlayer } from './InlineAudioPlayer';

type MinusScope = 'full' | 'fragment';

export function VocalRemovalHeader({ webGpu }: { webGpu: boolean }) {
  return (
    <>
      <div className="page-heading vocal-removal-heading">
        <div>
          <span className="eyebrow">Инструмент для ведущего</span>
          <h1>Обработка трека</h1>
          <p>Обрежьте нужный фрагмент песни или удалите из него вокал. Нарезка выполняется локально, а для минуса HTDemucs отделяет голос от инструментов прямо в браузере.</p>
        </div>
        <div className="vocal-removal-badges" aria-label="Возможности обработки">
          <span className={webGpu ? 'runtime-badge runtime-badge--ready' : 'runtime-badge'}>
            {webGpu ? 'WebGPU поддерживается' : 'WASM режим'}
          </span>
          <span className="runtime-badge">Локальная обработка</span>
        </div>
      </div>

      <section className="vocal-removal-info">
        <div><strong>Нарезка без загрузок</strong><span>Выбранный участок вырезается на вашем компьютере и сохраняется в WAV.</span></div>
        <div><strong>Минус работает локально</strong><span>Исходная песня не отправляется на сервер приложения. Модель скачивается только при первом запуске разделения.</span></div>
        <div><strong>Фрагмент обрабатывается быстрее</strong><span>Для игры можно сначала оставить 30–60 секунд, а затем запускать HTDemucs только для этого участка.</span></div>
      </section>
    </>
  );
}

export function VocalDropzone({
  file,
  working,
  dragging,
  inputRef,
  onDraggingChange,
  onSelectFile,
}: {
  file: File | null;
  working: boolean;
  dragging: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onDraggingChange: (dragging: boolean) => void;
  onSelectFile: (file?: File | null) => void;
}) {
  return (
    <div
      className={dragging ? 'vocal-dropzone vocal-dropzone--dragging' : file ? 'vocal-dropzone vocal-dropzone--ready' : 'vocal-dropzone'}
      onDragEnter={(event) => { event.preventDefault(); if (!working) onDraggingChange(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        const related = event.relatedTarget;
        if (!(related instanceof Node) || !event.currentTarget.contains(related)) onDraggingChange(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDraggingChange(false);
        onSelectFile(event.dataTransfer.files?.[0]);
      }}
    >
      <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" disabled={working} onChange={(event) => onSelectFile(event.target.files?.[0])} />
      <div className="vocal-dropzone__icon" aria-hidden="true">♫</div>
      {file ? (
        <>
          <strong>{file.name}</strong>
          <span>{formatBytes(file.size)}</span>
          <button className="secondary-button" disabled={working} onClick={() => inputRef.current?.click()}>Выбрать другой файл</button>
        </>
      ) : (
        <>
          <strong>Перетащите песню сюда</strong>
          <span>MP3, WAV, OGG, M4A и другие форматы, которые поддерживает браузер</span>
          <button className="primary-button" onClick={() => inputRef.current?.click()}>Выбрать файл</button>
        </>
      )}
    </div>
  );
}


export function VocalOriginalTrackPanel({
  file,
  source,
  disabled,
  addLabel,
  addDisabled,
  libraryError,
  onDuration,
  onAdd,
}: {
  file: File;
  source: string;
  disabled: boolean;
  addLabel: string;
  addDisabled: boolean;
  libraryError?: string;
  onDuration: (duration: number) => void;
  onAdd: () => void;
}) {
  return (
    <section className="vocal-track-card">
      <div className="vocal-track-card__heading">
        <div><span className="eyebrow">Оригинал</span><strong>{file.name}</strong></div>
        <span>{formatBytes(file.size)}</span>
      </div>
      <InlineAudioPlayer source={source} label="Оригинальный трек" disabled={disabled} onDuration={onDuration} />
      <div className="vocal-result-actions">
        <button className="secondary-button" disabled={addDisabled} onClick={onAdd}>{addLabel}</button>
      </div>
      {libraryError && <small className="vocal-library-error" role="alert">{libraryError}</small>}
    </section>
  );
}

export function VocalSeparationActions({
  working,
  busy,
  minusScope,
  sourceDuration,
  selectedDuration,
  canProcessFragment,
  canProcessFullTrack,
  fullTrackTooLong,
  fragmentTooLong,
  sourceTooLongToDecode,
  maxDurationSeconds,
  maxDecodeDurationSeconds,
  maxSourceBytes,
  onProcess,
}: {
  working: boolean;
  busy: boolean;
  minusScope: MinusScope;
  sourceDuration: number;
  selectedDuration: number;
  canProcessFragment: boolean;
  canProcessFullTrack: boolean;
  fullTrackTooLong: boolean;
  fragmentTooLong: boolean;
  sourceTooLongToDecode: boolean;
  maxDurationSeconds: number;
  maxDecodeDurationSeconds: number;
  maxSourceBytes: number;
  onProcess: (scope: MinusScope) => void;
}) {
  return (
    <section className="minus-action-card">
      <div className="minus-action-card__heading">
        <span className="eyebrow">Удаление вокала</span>
        <h2>Сделать минус</h2>
        <p>Для короткой игровой нарезки лучше обрабатывать выбранный фрагмент — это быстрее и требует меньше памяти.</p>
      </div>
      <div className="minus-action-options">
        <button className="primary-button primary-button--large" disabled={working || !canProcessFragment} onClick={() => onProcess('fragment')}>
          {busy && minusScope === 'fragment' ? 'Делаем минус…' : sourceDuration > 0 ? `Минус из фрагмента · ${formatAudioTime(selectedDuration)}` : 'Минус из фрагмента · ждём длительность'}
        </button>
        <button className="secondary-button" disabled={working || !canProcessFullTrack} onClick={() => onProcess('full')}>
          {busy && minusScope === 'full' ? 'Делаем минус…' : sourceDuration > 0 ? `Минус из всего трека · ${formatAudioTime(sourceDuration)}` : 'Минус из всего трека · ждём длительность'}
        </button>
      </div>
      <small>Для безопасной работы HTDemucs обрабатывает не более {formatProcessingLimit(maxDurationSeconds)} за один запуск. Исходник для локальной нарезки — до {formatProcessingLimit(maxDecodeDurationSeconds)} и {Math.round(maxSourceBytes / 1024 / 1024)} МБ.</small>
      {sourceDuration > 0 && fullTrackTooLong && !sourceTooLongToDecode && <small className="vocal-processing-warning">Весь трек длиннее безопасного лимита для HTDemucs. Выберите участок до {formatProcessingLimit(maxDurationSeconds)} и запустите минус из фрагмента.</small>}
      {fragmentTooLong && !sourceTooLongToDecode && <small className="vocal-processing-warning">Текущий фрагмент слишком длинный для удаления вокала. Сократите его до {formatProcessingLimit(maxDurationSeconds)}.</small>}
      {sourceTooLongToDecode && <small className="vocal-processing-warning vocal-processing-warning--danger">Исходник длиннее {formatProcessingLimit(maxDecodeDurationSeconds)}. В текущем browser-only режиме его безопасная нарезка отключена, чтобы не переполнить память вкладки.</small>}
    </section>
  );
}

export function VocalProgressPanel({ progress, onCancel }: { progress: VocalRemovalProgress; onCancel: () => void }) {
  return (
    <section className="vocal-progress-card" aria-live="polite">
      <div className="vocal-progress-card__header">
        <div><span className="eyebrow">Обработка</span><strong>{progress.message || 'Подготавливаем обработку…'}</strong></div>
        {progress.progress !== null && <b>{Math.round(progress.progress * 100)}%</b>}
      </div>
      <div className="vocal-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.progress === null ? undefined : Math.round(progress.progress * 100)}>
        <span className={progress.progress === null ? 'vocal-progress-track__indeterminate' : ''} style={progress.progress === null ? undefined : { width: `${progress.progress * 100}%` }} />
      </div>
      <div className="vocal-progress-card__footer">
        <p>{phaseHint(progress.phase)}</p>
        <button className="secondary-button" onClick={onCancel}>Отменить обработку</button>
      </div>
    </section>
  );
}

export function VocalResultPanel({
  outputName,
  scope,
  trimStart,
  trimEnd,
  source,
  disabled,
  addLabel,
  addDisabled,
  libraryError,
  onAdd,
  onReset,
}: {
  outputName: string;
  scope: MinusScope;
  trimStart: number;
  trimEnd: number;
  source: string;
  disabled: boolean;
  addLabel: string;
  addDisabled: boolean;
  libraryError?: string;
  onAdd: () => void;
  onReset: () => void;
}) {
  return (
    <section className="vocal-result-card">
      <div className="vocal-result-card__status"><span>✓</span><strong>Минус готов</strong></div>
      <h2>{outputName}</h2>
      <p>{scope === 'fragment'
        ? `Обработан только выбранный участок ${formatAudioTime(trimStart)} — ${formatAudioTime(trimEnd)}. В дорожке оставлены барабаны, бас и остальные инструменты.`
        : 'Обработан весь трек. В дорожке оставлены барабаны, бас и остальные инструменты.'} Небольшие остатки вокала или реверберации возможны — это нормальное ограничение нейросетевого разделения.</p>
      <InlineAudioPlayer source={source} label="Готовый минус" disabled={disabled} />
      <div className="vocal-result-actions">
        <a className="primary-button vocal-download-button" href={source} download={outputName}>Скачать минус WAV</a>
        <button className="secondary-button" disabled={addDisabled} onClick={onAdd}>{addLabel}</button>
        <button className="secondary-button" disabled={disabled} onClick={onReset}>Обработать другой трек</button>
      </div>
      {libraryError && <small className="vocal-library-error" role="alert">{libraryError}</small>}
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function phaseHint(phase: VocalRemovalProgress['phase']) {
  switch (phase) {
    case 'runtime': return 'ML-модуль загружается только для этого инструмента и не влияет на старт обычной игры.';
    case 'decode': return 'Браузер подготавливает выбранный источник для модели.';
    case 'model-download': return 'Это самая большая загрузка. При повторном использовании файл модели обычно берётся из HTTP-кэша браузера.';
    case 'model-init': return 'ONNX Runtime подготавливает модель для вашего GPU или WASM.';
    case 'separate': return 'HTDemucs обрабатывает песню фрагментами и выделяет vocals, drums, bass и other.';
    case 'encode': return 'Инструментальные дорожки объединяются и сохраняются в совместимый WAV.';
  }
}
