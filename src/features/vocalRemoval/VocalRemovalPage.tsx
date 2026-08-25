import { useEffect, useMemo, useRef, useState } from 'react';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { getErrorMessage } from '../../lib/errors';
import { createTrimmedWav, MIN_CLIP_SECONDS, type TrimRange } from './audioClip';
import { clampNumber, formatAudioTime } from './audioTime';
import { InlineAudioPlayer } from './InlineAudioPlayer';
import {
  createInstrumental,
  getVocalRemovalCapabilities,
  releaseVocalSeparator,
  type VocalRemovalProgress,
} from './separator';
import { TrackTrimEditor } from './TrackTrimEditor';
import { addGeneratedTrackToLibrary, type AddGeneratedTrackResult } from './addGeneratedTrackToLibrary';

const INITIAL_PROGRESS: VocalRemovalProgress = {
  phase: 'runtime',
  progress: null,
  message: '',
};

type MinusScope = 'full' | 'fragment';
type GeneratedResultKind = 'source' | 'trim' | 'minus';
type LibraryResult = Pick<AddGeneratedTrackResult, 'status'> & { trackId: string };
type LibraryNotice = { id: number; message: string };

export function VocalRemovalPage({ active = true }: { active?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const separationAbortRef = useRef<AbortController | null>(null);
  const libraryNoticeTimerRef = useRef<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimResult, setTrimResult] = useState<Blob | null>(null);
  const [minusResult, setMinusResult] = useState<Blob | null>(null);
  const [minusScope, setMinusScope] = useState<MinusScope>('full');
  const [progress, setProgress] = useState<VocalRemovalProgress>(INITIAL_PROGRESS);
  const [busy, setBusy] = useState(false);
  const [clipBusy, setClipBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState<GeneratedResultKind | null>(null);
  const [libraryError, setLibraryError] = useState<{ kind: GeneratedResultKind; message: string } | null>(null);
  const [libraryResults, setLibraryResults] = useState<Partial<Record<GeneratedResultKind, LibraryResult>>>({});
  const [libraryNotice, setLibraryNotice] = useState<LibraryNotice | null>(null);
  const capabilities = useMemo(() => getVocalRemovalCapabilities(), []);
  const sourceUrl = useObjectUrl(file ?? undefined);
  const trimResultUrl = useObjectUrl(trimResult ?? undefined);
  const minusResultUrl = useObjectUrl(minusResult ?? undefined);
  const working = busy || clipBusy || libraryBusy !== null;
  const trimRange = useMemo<TrimRange>(() => ({ start: trimStart, end: trimEnd }), [trimEnd, trimStart]);
  const selectedDuration = Math.max(0, trimEnd - trimStart);

  useEffect(() => () => {
    separationAbortRef.current?.abort();
    if (libraryNoticeTimerRef.current !== null) window.clearTimeout(libraryNoticeTimerRef.current);
    void releaseVocalSeparator();
  }, []);

  useEffect(() => {
    if (!active) setDragging(false);
  }, [active]);

  const showLibraryNotice = (message: string) => {
    if (libraryNoticeTimerRef.current !== null) window.clearTimeout(libraryNoticeTimerRef.current);
    setLibraryNotice({ id: Date.now(), message });
    libraryNoticeTimerRef.current = window.setTimeout(() => {
      setLibraryNotice(null);
      libraryNoticeTimerRef.current = null;
    }, 3200);
  };

  const clearTrimDependentResults = () => {
    setTrimResult(null);
    setLibraryResults((current) => ({ ...current, trim: undefined }));
    if (minusScope === 'fragment') {
      setMinusResult(null);
      setLibraryResults((current) => ({ ...current, minus: undefined }));
    }
    setLibraryError(null);
    setError(null);
  };

  const selectFile = (nextFile?: File | null) => {
    if (!nextFile || working) return;
    setFile(nextFile);
    setSourceDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setTrimResult(null);
    setMinusResult(null);
    setMinusScope('full');
    setLibraryResults({});
    setLibraryError(null);
    setLibraryNotice(null);
    setError(null);
    setProgress(INITIAL_PROGRESS);
  };

  const updateTrimRange = (next: TrimRange) => {
    if (working || sourceDuration <= 0) return;
    const start = clampNumber(next.start, 0, Math.max(0, sourceDuration - MIN_CLIP_SECONDS));
    const end = clampNumber(next.end, start + MIN_CLIP_SECONDS, sourceDuration);
    setTrimStart(start);
    setTrimEnd(end);
    clearTrimDependentResults();
  };

  const createClip = async () => {
    if (!file || working || selectedDuration < MIN_CLIP_SECONDS) return;
    setClipBusy(true);
    setTrimResult(null);
    setLibraryResults((current) => ({ ...current, trim: undefined }));
    setLibraryError(null);
    setError(null);
    try {
      setTrimResult(await createTrimmedWav(file, trimRange));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось обрезать трек.');
    } finally {
      setClipBusy(false);
    }
  };

  const processFile = async (scope: MinusScope) => {
    if (!file || working) return;
    if (scope === 'fragment' && selectedDuration < MIN_CLIP_SECONDS) return;
    const controller = new AbortController();
    separationAbortRef.current = controller;
    setBusy(true);
    setMinusResult(null);
    setLibraryResults((current) => ({ ...current, minus: undefined }));
    setLibraryError(null);
    setMinusScope(scope);
    setError(null);

    try {
      let source = file;
      if (scope === 'fragment') {
        setProgress({ phase: 'decode', progress: null, message: 'Готовим выбранный фрагмент…' });
        const fragment = await createTrimmedWav(file, trimRange);
        controller.signal.throwIfAborted();
        source = new File([fragment], buildClipOutputName(file.name), { type: 'audio/wav' });
      }
      const instrumental = await createInstrumental(source, setProgress, controller.signal);
      controller.signal.throwIfAborted();
      setMinusResult(instrumental);
      setProgress({ phase: 'encode', progress: 1, message: 'Минус готов' });
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : 'Не удалось сделать минус.');
      }
    } finally {
      if (separationAbortRef.current === controller) separationAbortRef.current = null;
      setBusy(false);
    }
  };

  const addResultToLibrary = async (kind: GeneratedResultKind, blob: Blob, outputName: string) => {
    if (working || libraryResults[kind]) return;
    setLibraryBusy(kind);
    setLibraryError(null);
    try {
      const result = await addGeneratedTrackToLibrary(blob, outputName);
      setLibraryResults((current) => ({
        ...current,
        [kind]: { trackId: result.track.id, status: result.status },
      }));
      showLibraryNotice(libraryNoticeMessage(kind, result.status));
    } catch (caught) {
      setLibraryError({
        kind,
        message: getErrorMessage(caught, 'Не удалось добавить трек в медиатеку.'),
      });
    } finally {
      setLibraryBusy(null);
    }
  };

  const reset = () => {
    if (working) return;
    setFile(null);
    setSourceDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setTrimResult(null);
    setMinusResult(null);
    setMinusScope('full');
    setLibraryResults({});
    setLibraryError(null);
    setLibraryNotice(null);
    setError(null);
    setProgress(INITIAL_PROGRESS);
    if (inputRef.current) inputRef.current.value = '';
  };

  const clipOutputName = file ? buildClipOutputName(file.name) : 'fragment.wav';
  const minusOutputName = file ? buildMinusOutputName(file.name, minusScope) : 'minus.wav';

  return (
    <main className="vocal-removal-page page-shell">
      <div className="page-heading vocal-removal-heading">
        <div>
          <span className="eyebrow">Инструмент для ведущего</span>
          <h1>Обработка трека</h1>
          <p>Обрежьте нужный фрагмент песни или удалите из него вокал. Нарезка выполняется локально, а для минуса HTDemucs отделяет голос от инструментов прямо в браузере.</p>
        </div>
        <div className="vocal-removal-badges" aria-label="Возможности обработки">
          <span className={capabilities.webGpu ? 'runtime-badge runtime-badge--ready' : 'runtime-badge'}>
            {capabilities.webGpu ? 'WebGPU поддерживается' : 'WASM режим'}
          </span>
          <span className="runtime-badge">Локальная обработка</span>
        </div>
      </div>

      <section className="vocal-removal-info">
        <div>
          <strong>Нарезка без загрузок</strong>
          <span>Выбранный участок вырезается на вашем компьютере и сохраняется в WAV.</span>
        </div>
        <div>
          <strong>Минус работает локально</strong>
          <span>Исходная песня не отправляется на сервер приложения. Модель скачивается только при первом запуске разделения.</span>
        </div>
        <div>
          <strong>Фрагмент обрабатывается быстрее</strong>
          <span>Для игры можно сначала оставить 30–60 секунд, а затем запускать HTDemucs только для этого участка.</span>
        </div>
      </section>

      <section className="vocal-removal-workspace">
        <div
          className={dragging ? 'vocal-dropzone vocal-dropzone--dragging' : file ? 'vocal-dropzone vocal-dropzone--ready' : 'vocal-dropzone'}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!working) setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            const related = event.relatedTarget;
            if (!(related instanceof Node) || !event.currentTarget.contains(related)) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            selectFile(event.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
            disabled={working}
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
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

        {file && sourceUrl && (
          <section className="vocal-track-card">
            <div className="vocal-track-card__heading">
              <div>
                <span className="eyebrow">Оригинал</span>
                <strong>{file.name}</strong>
              </div>
              <span>{formatBytes(file.size)}</span>
            </div>
            <InlineAudioPlayer
              source={sourceUrl}
              label="Оригинальный трек"
              disabled={working || !active}
              onDuration={(duration) => {
                if (!Number.isFinite(duration) || duration <= 0) return;
                setSourceDuration(duration);
                setTrimStart((current) => clampNumber(current, 0, Math.max(0, duration - MIN_CLIP_SECONDS)));
                setTrimEnd((current) => current > 0 ? clampNumber(current, MIN_CLIP_SECONDS, duration) : duration);
              }}
            />
            <div className="vocal-result-actions">
              <button
                className="secondary-button"
                disabled={working || Boolean(libraryResults.source)}
                onClick={() => void addResultToLibrary('source', file, file.name)}
              >
                {libraryResults.source
                  ? libraryResultLabel('source', libraryResults.source.status)
                  : libraryBusy === 'source'
                    ? 'Добавляем оригинал…'
                    : 'Добавить оригинал в медиатеку'}
              </button>
            </div>
            {libraryError?.kind === 'source' && <small className="vocal-library-error" role="alert">{libraryError.message}</small>}
          </section>
        )}

        {file && sourceUrl && sourceDuration > 0 && (
          <TrackTrimEditor
            source={sourceUrl}
            duration={sourceDuration}
            range={trimRange}
            disabled={working || !active}
            busy={clipBusy}
            onChange={updateTrimRange}
            onCreateClip={() => void createClip()}
            resultUrl={trimResultUrl}
            outputName={clipOutputName}
            addToLibraryLabel={
              libraryResults.trim
                ? libraryResultLabel('trim', libraryResults.trim.status)
                : libraryBusy === 'trim'
                  ? 'Добавляем фрагмент…'
                  : 'Добавить фрагмент в медиатеку'
            }
            addToLibraryDisabled={working || Boolean(libraryResults.trim)}
            libraryError={libraryError?.kind === 'trim' ? libraryError.message : undefined}
            onAddToLibrary={() => {
              if (trimResult) void addResultToLibrary('trim', trimResult, clipOutputName);
            }}
          />
        )}

        {file && (
          <section className="minus-action-card">
            <div className="minus-action-card__heading">
              <span className="eyebrow">Удаление вокала</span>
              <h2>Сделать минус</h2>
              <p>Для короткой игровой нарезки лучше обрабатывать выбранный фрагмент — это быстрее и требует меньше памяти.</p>
            </div>
            <div className="minus-action-options">
              <button
                className="primary-button primary-button--large"
                disabled={working || sourceDuration <= 0 || selectedDuration < MIN_CLIP_SECONDS}
                onClick={() => void processFile('fragment')}
              >
                {busy && minusScope === 'fragment'
                  ? 'Делаем минус…'
                  : sourceDuration > 0
                    ? `Минус из фрагмента · ${formatAudioTime(selectedDuration)}`
                    : 'Минус из фрагмента · ждём длительность'}
              </button>
              <button className="secondary-button" disabled={working} onClick={() => void processFile('full')}>
                {busy && minusScope === 'full'
                  ? 'Делаем минус…'
                  : sourceDuration > 0
                    ? `Минус из всего трека · ${formatAudioTime(sourceDuration)}`
                    : 'Минус из всего трека'}
              </button>
            </div>
            <small>Ограничение разделения вокала: до {Math.round(capabilities.maxSourceBytes / 1024 / 1024)} МБ и {Math.round(capabilities.maxDurationSeconds / 60)} минут на обрабатываемый источник.</small>
          </section>
        )}

        {busy && (
          <section className="vocal-progress-card" aria-live="polite">
            <div className="vocal-progress-card__header">
              <div>
                <span className="eyebrow">Обработка</span>
                <strong>{progress.message || 'Подготавливаем обработку…'}</strong>
              </div>
              {progress.progress !== null && <b>{Math.round(progress.progress * 100)}%</b>}
            </div>
            <div className="vocal-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.progress === null ? undefined : Math.round(progress.progress * 100)}>
              <span className={progress.progress === null ? 'vocal-progress-track__indeterminate' : ''} style={progress.progress === null ? undefined : { width: `${progress.progress * 100}%` }} />
            </div>
            <p>{phaseHint(progress.phase)}</p>
          </section>
        )}

        {error && (
          <section className="vocal-error-card" role="alert">
            <strong>Не удалось обработать трек</strong>
            <p>{error}</p>
          </section>
        )}

        {minusResult && minusResultUrl && (
          <section className="vocal-result-card">
            <div className="vocal-result-card__status"><span>✓</span><strong>Минус готов</strong></div>
            <h2>{minusOutputName}</h2>
            <p>{minusScope === 'fragment'
              ? `Обработан только выбранный участок ${formatAudioTime(trimStart)} — ${formatAudioTime(trimEnd)}. В дорожке оставлены барабаны, бас и остальные инструменты.`
              : 'Обработан весь трек. В дорожке оставлены барабаны, бас и остальные инструменты.'} Небольшие остатки вокала или реверберации возможны — это нормальное ограничение нейросетевого разделения.</p>
            <InlineAudioPlayer source={minusResultUrl} label="Готовый минус" disabled={working || !active} />
            <div className="vocal-result-actions">
              <a className="primary-button vocal-download-button" href={minusResultUrl} download={minusOutputName}>Скачать минус WAV</a>
              <button
                className="secondary-button"
                disabled={working || Boolean(libraryResults.minus)}
                onClick={() => void addResultToLibrary('minus', minusResult, minusOutputName)}
              >
                {libraryResults.minus ? libraryResultLabel('minus', libraryResults.minus.status) : libraryBusy === 'minus' ? 'Добавляем минус…' : 'Добавить минус в медиатеку'}
              </button>
              <button className="secondary-button" disabled={working} onClick={reset}>Обработать другой трек</button>
            </div>
            {libraryError?.kind === 'minus' && <small className="vocal-library-error" role="alert">{libraryError.message}</small>}
          </section>
        )}
      </section>

      {libraryNotice && (
        <div key={libraryNotice.id} className="vocal-media-toast" role="status" aria-live="polite">
          <span aria-hidden="true">✓</span>
          <strong>{libraryNotice.message}</strong>
        </div>
      )}
    </main>
  );
}

function libraryNoticeMessage(kind: GeneratedResultKind, status: AddGeneratedTrackResult['status']) {
  if (status === 'existing') return 'Этот трек уже есть в медиатеке';
  if (kind === 'source') return 'Оригинал добавлен в медиатеку';
  if (kind === 'trim') return 'Фрагмент добавлен в медиатеку';
  return 'Минус добавлен в медиатеку';
}

function libraryResultLabel(kind: GeneratedResultKind, status: AddGeneratedTrackResult['status']) {
  if (status === 'existing') return '✓ Уже есть в медиатеке';
  if (kind === 'source') return '✓ Оригинал добавлен в медиатеку';
  if (kind === 'trim') return '✓ Фрагмент добавлен в медиатеку';
  return '✓ Минус добавлен в медиатеку';
}

function buildClipOutputName(name: string) {
  return `${baseName(name)} - фрагмент.wav`;
}

function buildMinusOutputName(name: string, scope: MinusScope) {
  return scope === 'fragment'
    ? `${baseName(name)} - фрагмент - минус.wav`
    : `${baseName(name)} - минус.wav`;
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').trim() || 'track';
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
