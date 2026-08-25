import { useEffect, useMemo, useRef, useState } from 'react';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { getErrorMessage } from '../../lib/errors';
import { createTrimmedWav, MIN_CLIP_SECONDS, type TrimRange } from './audioClip';
import { assertAudioProcessingFile } from './audioProcessingLimits';
import { clampNumber } from './audioTime';
import {
  createInstrumental,
  getVocalRemovalCapabilities,
  prepareVocalSeparator,
  releaseVocalSeparator,
  type VocalRemovalProgress,
} from './separator';
import { TrackTrimEditor } from './TrackTrimEditor';
import { addGeneratedTrackToLibrary, type AddGeneratedTrackResult } from './addGeneratedTrackToLibrary';
import { useFeedback } from '../../components/feedback/FeedbackProvider';
import { VocalDropzone, VocalOriginalTrackPanel, VocalProgressPanel, VocalRemovalHeader, VocalResultPanel, VocalSeparationActions } from './VocalRemovalPanels';

const INITIAL_PROGRESS: VocalRemovalProgress = {
  phase: 'runtime',
  progress: null,
  message: '',
};

type MinusScope = 'full' | 'fragment';
type GeneratedResultKind = 'source' | 'trim' | 'minus';
type LibraryResult = Pick<AddGeneratedTrackResult, 'status'> & { trackId: string };

export function VocalRemovalPage({ active = true }: { active?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const separationAbortRef = useRef<AbortController | null>(null);
  const clipAbortRef = useRef<AbortController | null>(null);
  const separatorReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const { notify } = useFeedback();
  const capabilities = useMemo(() => getVocalRemovalCapabilities(), []);
  const sourceUrl = useObjectUrl(file ?? undefined);
  const trimResultUrl = useObjectUrl(trimResult ?? undefined);
  const minusResultUrl = useObjectUrl(minusResult ?? undefined);
  const working = busy || clipBusy || libraryBusy !== null;
  const trimRange = useMemo<TrimRange>(() => ({ start: trimStart, end: trimEnd }), [trimEnd, trimStart]);
  const selectedDuration = Math.max(0, trimEnd - trimStart);
  const sourceTooLongToDecode = sourceDuration > capabilities.maxDecodeDurationSeconds;
  const fullTrackTooLong = sourceDuration > capabilities.maxDurationSeconds;
  const fragmentTooLong = selectedDuration > capabilities.maxDurationSeconds;
  const canCreateFragment = sourceDuration > 0 && !sourceTooLongToDecode && selectedDuration >= MIN_CLIP_SECONDS;
  const canProcessFragment = canCreateFragment && !fragmentTooLong;
  const canProcessFullTrack = sourceDuration > 0 && !sourceTooLongToDecode && !fullTrackTooLong;

  useEffect(() => () => {
    if (separatorReleaseTimerRef.current) clearTimeout(separatorReleaseTimerRef.current);
    separationAbortRef.current?.abort();
    clipAbortRef.current?.abort();
    void releaseVocalSeparator();
  }, []);

  useEffect(() => {
    if (active) {
      if (separatorReleaseTimerRef.current) {
        clearTimeout(separatorReleaseTimerRef.current);
        separatorReleaseTimerRef.current = null;
      }
      prepareVocalSeparator();
      return;
    }

    setDragging(false);
    separationAbortRef.current?.abort();
    clipAbortRef.current?.abort();
    if (separatorReleaseTimerRef.current) clearTimeout(separatorReleaseTimerRef.current);
    separatorReleaseTimerRef.current = setTimeout(() => {
      separatorReleaseTimerRef.current = null;
      void releaseVocalSeparator();
    }, 5 * 60 * 1000);

    return () => {
      if (!separatorReleaseTimerRef.current) return;
      clearTimeout(separatorReleaseTimerRef.current);
      separatorReleaseTimerRef.current = null;
    };
  }, [active]);

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
    try {
      assertAudioProcessingFile(nextFile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось открыть аудиофайл.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setFile(nextFile);
    setSourceDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setTrimResult(null);
    setMinusResult(null);
    setMinusScope('full');
    setLibraryResults({});
    setLibraryError(null);
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
    if (!file || working || !canCreateFragment) return;
    const controller = new AbortController();
    clipAbortRef.current = controller;
    setClipBusy(true);
    setTrimResult(null);
    setLibraryResults((current) => ({ ...current, trim: undefined }));
    setLibraryError(null);
    setError(null);
    try {
      setTrimResult(await createTrimmedWav(file, trimRange, controller.signal));
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : 'Не удалось обрезать трек.');
      }
    } finally {
      if (clipAbortRef.current === controller) clipAbortRef.current = null;
      setClipBusy(false);
    }
  };

  const processFile = async (scope: MinusScope) => {
    if (!file || working) return;
    if (scope === 'fragment' && !canProcessFragment) return;
    if (scope === 'full' && !canProcessFullTrack) return;
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
        const fragment = await createTrimmedWav(file, trimRange, controller.signal);
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

  const cancelSeparation = () => {
    separationAbortRef.current?.abort();
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
      notify({
        kind: result.status === 'existing' ? 'info' : 'success',
        message: libraryNoticeMessage(kind, result.status),
      });
    } catch (caught) {
      setLibraryError({
        kind,
        message: getErrorMessage(caught, 'Не удалось добавить трек в медиатеку.'),
      });
    } finally {
      setLibraryBusy(null);
    }
  };

  const clipOutputName = file ? buildClipOutputName(file.name) : 'fragment.wav';
  const minusOutputName = file ? buildMinusOutputName(file.name, minusScope) : 'minus.wav';

  return (
    <main className="vocal-removal-page page-shell">
      <VocalRemovalHeader webGpu={capabilities.webGpu} />

      <section className="vocal-removal-workspace">
        <VocalDropzone
          file={file}
          working={working}
          dragging={dragging}
          inputRef={inputRef}
          onDraggingChange={setDragging}
          onSelectFile={selectFile}
        />

        {file && sourceUrl && (
          <VocalOriginalTrackPanel
            file={file}
            source={sourceUrl}
            disabled={working || !active}
            addLabel={libraryResults.source ? libraryResultLabel('source', libraryResults.source.status) : libraryBusy === 'source' ? 'Добавляем оригинал…' : 'Добавить оригинал в медиатеку'}
            addDisabled={working || Boolean(libraryResults.source)}
            libraryError={libraryError?.kind === 'source' ? libraryError.message : undefined}
            onDuration={(duration) => {
              if (!Number.isFinite(duration) || duration <= 0) return;
              setSourceDuration(duration);
              setTrimStart((current) => clampNumber(current, 0, Math.max(0, duration - MIN_CLIP_SECONDS)));
              setTrimEnd((current) => current > 0 ? clampNumber(current, MIN_CLIP_SECONDS, duration) : duration);
            }}
            onAdd={() => void addResultToLibrary('source', file, file.name)}
          />
        )}

        {file && sourceUrl && sourceDuration > 0 && (
          <TrackTrimEditor
            source={sourceUrl}
            duration={sourceDuration}
            range={trimRange}
            disabled={working || !active || sourceTooLongToDecode}
            busy={clipBusy}
            onChange={updateTrimRange}
            onCreateClip={() => void createClip()}
            resultUrl={trimResultUrl ?? undefined}
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
          <VocalSeparationActions
            working={working}
            busy={busy}
            minusScope={minusScope}
            sourceDuration={sourceDuration}
            selectedDuration={selectedDuration}
            canProcessFragment={canProcessFragment}
            canProcessFullTrack={canProcessFullTrack}
            fullTrackTooLong={fullTrackTooLong}
            fragmentTooLong={fragmentTooLong}
            sourceTooLongToDecode={sourceTooLongToDecode}
            maxDurationSeconds={capabilities.maxDurationSeconds}
            maxDecodeDurationSeconds={capabilities.maxDecodeDurationSeconds}
            maxSourceBytes={capabilities.maxSourceBytes}
            onProcess={(scope) => void processFile(scope)}
          />
        )}

        {busy && <VocalProgressPanel progress={progress} onCancel={cancelSeparation} />}

        {error && (
          <section className="vocal-error-card" role="alert">
            <strong>Не удалось обработать трек</strong>
            <p>{error}</p>
          </section>
        )}

        {minusResult && minusResultUrl && (
          <VocalResultPanel
            outputName={minusOutputName}
            scope={minusScope}
            trimStart={trimStart}
            trimEnd={trimEnd}
            source={minusResultUrl}
            disabled={working || !active}
            addLabel={libraryResults.minus ? libraryResultLabel('minus', libraryResults.minus.status) : libraryBusy === 'minus' ? 'Добавляем минус…' : 'Добавить минус в медиатеку'}
            addDisabled={working || Boolean(libraryResults.minus)}
            libraryError={libraryError?.kind === 'minus' ? libraryError.message : undefined}
            onAdd={() => void addResultToLibrary('minus', minusResult, minusOutputName)}
          />
        )}
      </section>

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
