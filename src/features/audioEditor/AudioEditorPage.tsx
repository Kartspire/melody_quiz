import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUnit } from 'effector-react';
import { $audioAssets, $audioProjects, $mediaTracks } from '../../model/game';
import type { AudioClip, AudioProject } from '../../model/types';
import { addMediaTrackFileFx } from '../../model/media';
import { downloadBlob } from '../../lib/download';
import { getErrorMessage } from '../../lib/errors';
import { useFeedback } from '../../components/feedback/FeedbackProvider';
import { clearDecodedAudioBufferCache, decodeAudioAsset } from './audioBuffers';
import { renderAudioProjectToWav } from './audioEngine';
import {
  createAudioClip,
  createAudioEditorLane,
  createAudioProject,
  getClipTimelineEndMs,
  getProjectDurationMs,
  normalizeAudioClip,
  splitAudioClip,
} from './audioProject';
import { audioProjectAdded, audioProjectDeleted, audioProjectReplaced } from './model';
import {
  addProjectMarker,
  applyAutoCrossfades,
  applyCrossfadeToSelection,
  copyClips,
  deleteClips,
  findClip,
  insertClip,
  moveClipsToLane,
  pasteClips,
  removeProjectMarker,
  snapTimelinePosition,
  type AudioClipboard,
} from './timelineEditing';
import { clearWaveformPeakCache } from './waveformPeaks';
import { useAudioEditorHistory } from './useAudioEditorHistory';
import { useAudioEditorPlayback } from './useAudioEditorPlayback';
import { AudioEditorTransport } from './AudioEditorTransport';
import { AudioEditorTimeline } from './AudioEditorTimeline';
import { AudioEditorClipInspector } from './AudioEditorClipInspector';

const DEFAULT_PIXELS_PER_SECOND = 36;

type ProjectChangeOptions = {
  recordHistory?: boolean;
  historySnapshot?: AudioProject;
};

export function AudioEditorPage() {
  const [projects, mediaTracks, audioAssets] = useUnit([$audioProjects, $mediaTracks, $audioAssets]);
  const { notify, confirm } = useFeedback();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [sourceTrackId, setSourceTrackId] = useState(mediaTracks[0]?.id ?? '');
  const [zoom, setZoom] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [ripple, setRipple] = useState(true);
  const [clipboard, setClipboard] = useState<AudioClipboard | null>(null);
  const [busy, setBusy] = useState<'source' | 'render' | 'library' | null>(null);
  const [rendered, setRendered] = useState<{ blob: Blob; projectUpdatedAt: number } | null>(null);
  const [sourceDurations, setSourceDurations] = useState<Record<string, number>>({});
  const history = useAudioEditorHistory();

  const project = projects.find((item) => item.id === selectedProjectId) ?? projects[0] ?? null;
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const assetById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);
  const activeClip = useMemo(() => project && activeClipId ? findClip(project, activeClipId) : null, [activeClipId, project]);

  const handlePlaybackError = useCallback((error: unknown) => {
    notify({ kind: 'error', title: 'Не удалось воспроизвести монтаж', message: getErrorMessage(error, 'Проверьте исходные треки.') });
  }, [notify]);
  const playback = useAudioEditorPlayback({ project, mediaTracks, audioAssets, onError: handlePlaybackError });
  const historyStatus = history.status(project?.id);
  const canCrossfade = useMemo(() => Boolean(project && applyCrossfadeToSelection(project, selectedClipIds)), [project, selectedClipIds]);

  useEffect(() => {
    if (!projects.length) {
      setSelectedProjectId(null);
      setSelectedClipIds([]);
      setActiveClipId(null);
      setSelectedLaneId(null);
      return;
    }
    if (!projects.some((item) => item.id === selectedProjectId)) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!mediaTracks.some((track) => track.id === sourceTrackId)) setSourceTrackId(mediaTracks[0]?.id ?? '');
  }, [mediaTracks, sourceTrackId]);

  useEffect(() => {
    if (!project) return;
    setRendered((current) => current && current.projectUpdatedAt === project.updatedAt ? current : null);
    if (!project.lanes.some((lane) => lane.id === selectedLaneId)) setSelectedLaneId(project.lanes[0]?.id ?? null);
    const existingIds = new Set(project.lanes.flatMap((lane) => lane.clips.map((clip) => clip.id)));
    const validSelection = selectedClipIds.filter((id) => existingIds.has(id));
    if (validSelection.length !== selectedClipIds.length) setSelectedClipIds(validSelection);
    if (activeClipId && !existingIds.has(activeClipId)) setActiveClipId(validSelection[validSelection.length - 1] ?? null);
  }, [activeClipId, project, selectedClipIds, selectedLaneId]);

  useEffect(() => {
    if (!project) return;
    const referenced = new Set(project.lanes.flatMap((lane) => lane.clips.map((clip) => clip.sourceTrackId)));
    for (const trackId of referenced) {
      if (sourceDurations[trackId] !== undefined) continue;
      const track = trackById.get(trackId);
      const asset = track ? assetById.get(track.audioId) : undefined;
      if (!asset) continue;
      void decodeAudioAsset(asset).then((buffer) => {
        setSourceDurations((current) => current[trackId] !== undefined ? current : { ...current, [trackId]: buffer.duration * 1000 });
      }).catch(() => undefined);
    }
  }, [assetById, project, sourceDurations, trackById]);

  useEffect(() => () => {
    clearDecodedAudioBufferCache();
    clearWaveformPeakCache();
  }, []);

  const replaceProject = (next: AudioProject, options: ProjectChangeOptions = {}) => {
    const { recordHistory = true, historySnapshot } = options;
    if (recordHistory) history.push(historySnapshot ?? project ?? next);
    audioProjectReplaced({ ...next, updatedAt: Date.now() });
  };

  const undo = () => {
    if (!project) return;
    const previous = history.undo(project);
    if (previous) audioProjectReplaced({ ...previous, updatedAt: Date.now() });
  };

  const redo = () => {
    if (!project) return;
    const next = history.redo(project);
    if (next) audioProjectReplaced({ ...next, updatedAt: Date.now() });
  };

  const createProject = () => {
    const next = createAudioProject();
    audioProjectAdded(next);
    setSelectedProjectId(next.id);
    setSelectedLaneId(next.lanes[0].id);
    setSelectedClipIds([]);
    setActiveClipId(null);
    playback.reset();
  };

  const deleteProject = async () => {
    if (!project) return;
    const accepted = await confirm({
      title: `Удалить монтаж «${project.name}»?`,
      description: 'Исходные треки из медиатеки останутся на месте.',
      confirmLabel: 'Удалить монтаж',
      tone: 'danger',
    });
    if (!accepted) return;
    playback.reset();
    audioProjectDeleted(project.id);
    history.clear(project.id);
  };

  const addSourceClip = async () => {
    if (!project || !sourceTrackId) return;
    const track = trackById.get(sourceTrackId);
    const asset = track ? assetById.get(track.audioId) : undefined;
    if (!track || !asset) return;
    try {
      setBusy('source');
      const buffer = await decodeAudioAsset(asset);
      const duration = buffer.duration * 1000;
      setSourceDurations((current) => ({ ...current, [track.id]: duration }));
      const targetLaneId = selectedLaneId && project.lanes.some((lane) => lane.id === selectedLaneId) ? selectedLaneId : project.lanes[0].id;
      const position = snapTimelinePosition(project, playback.playheadMs, { pixelsPerSecond: zoom }).valueMs;
      const clip = createAudioClip(track.id, duration, position);
      replaceProject(insertClip(project, targetLaneId, clip, position, ripple));
      setSelectedLaneId(targetLaneId);
      setSelectedClipIds([clip.id]);
      setActiveClipId(clip.id);
      playback.seek(getClipTimelineEndMs(clip));
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось прочитать аудио', message: getErrorMessage(error, 'Попробуйте другой трек.') });
    } finally {
      setBusy(null);
    }
  };

  const addLane = () => {
    if (!project || project.lanes.length >= 32) return;
    const lane = createAudioEditorLane(project.lanes.length);
    replaceProject({ ...project, lanes: [...project.lanes, lane] });
    setSelectedLaneId(lane.id);
  };

  const removeLane = (laneId: string) => {
    if (!project || project.lanes.length <= 1) return;
    const lane = project.lanes.find((item) => item.id === laneId);
    if (!lane || lane.clips.length > 0) {
      notify({ kind: 'info', message: 'Сначала удалите или перенесите фрагменты с дорожки.' });
      return;
    }
    replaceProject({ ...project, lanes: project.lanes.filter((item) => item.id !== laneId) });
  };

  const patchActiveClip = (patch: Partial<AudioClip>) => {
    if (!project || !activeClip) return;
    const lanes = project.lanes.map((lane) => lane.id === activeClip.lane.id ? {
      ...lane,
      clips: lane.clips.map((clip) => clip.id === activeClip.clip.id ? normalizeAudioClip({ ...clip, ...patch }) : clip),
    } : lane);
    replaceProject(applyAutoCrossfades({ ...project, lanes }, new Set([activeClip.lane.id])));
  };

  const moveSelectionToLane = (targetLaneId: string) => {
    if (!project || !activeClipId) return;
    const ids = selectedClipIds.includes(activeClipId) ? selectedClipIds : [activeClipId];
    replaceProject(moveClipsToLane(project, ids, targetLaneId));
    setSelectedLaneId(targetLaneId);
  };

  const deleteSelection = () => {
    if (!project || selectedClipIds.length === 0) return;
    replaceProject(deleteClips(project, selectedClipIds, ripple));
    setSelectedClipIds([]);
    setActiveClipId(null);
  };

  const copySelection = () => {
    if (!project || selectedClipIds.length === 0) return;
    const copied = copyClips(project, selectedClipIds);
    if (copied) setClipboard(copied);
  };

  const pasteClipboard = () => {
    if (!project || !clipboard) return;
    const laneId = selectedLaneId && project.lanes.some((lane) => lane.id === selectedLaneId) ? selectedLaneId : project.lanes[0].id;
    const result = pasteClips(project, clipboard, playback.playheadMs, laneId, ripple);
    if (result.clipIds.length === 0) return;
    replaceProject(result.project);
    setSelectedClipIds(result.clipIds);
    setActiveClipId(result.clipIds[result.clipIds.length - 1] ?? null);
    const ends = result.clipIds.map((id) => findClip(result.project, id)).filter(Boolean).map((location) => getClipTimelineEndMs(location!.clip));
    if (ends.length > 0) playback.seek(Math.max(...ends));
  };

  const duplicateSelection = () => {
    if (!project || selectedClipIds.length === 0) return;
    const copied = copyClips(project, selectedClipIds);
    if (!copied) return;
    const selectedEnds = selectedClipIds.map((id) => findClip(project, id)).filter(Boolean).map((location) => getClipTimelineEndMs(location!.clip));
    const position = (selectedEnds.length ? Math.max(...selectedEnds) : playback.playheadMs) + 100;
    const laneId = activeClip?.lane.id ?? selectedLaneId ?? project.lanes[0].id;
    const result = pasteClips(project, copied, position, laneId, false);
    replaceProject(result.project);
    setSelectedClipIds(result.clipIds);
    setActiveClipId(result.clipIds[result.clipIds.length - 1] ?? null);
  };

  const splitActiveClip = () => {
    if (!project || !activeClip) return;
    const split = splitAudioClip(activeClip.clip, playback.playheadMs);
    if (!split) {
      notify({ kind: 'info', message: 'Поставьте курсор внутри активного фрагмента, не слишком близко к краю.' });
      return;
    }
    const lanes = project.lanes.map((lane) => lane.id === activeClip.lane.id ? {
      ...lane,
      clips: lane.clips.flatMap((clip) => clip.id === activeClip.clip.id ? split : [clip]),
    } : lane);
    replaceProject({ ...project, lanes });
    const preserved = selectedClipIds.filter((id) => id !== activeClip.clip.id);
    setSelectedClipIds([...preserved, split[0].id, split[1].id]);
    setActiveClipId(split[1].id);
  };

  const applyCrossfade = () => {
    if (!project) return;
    const next = applyCrossfadeToSelection(project, selectedClipIds);
    if (!next) {
      notify({ kind: 'info', message: 'Выберите два пересекающихся фрагмента на одной дорожке.' });
      return;
    }
    replaceProject(next);
  };

  const addMarker = () => {
    if (!project) return;
    const result = addProjectMarker(project, playback.playheadMs);
    if (!result) {
      notify({ kind: 'info', message: 'В проекте уже максимальное количество маркеров.' });
      return;
    }
    replaceProject(result.project);
  };

  const removeMarker = (markerId: string) => {
    if (!project) return;
    replaceProject(removeProjectMarker(project, markerId));
  };

  const seek = (positionMs: number) => {
    if (!project) return playback.seek(positionMs);
    const snapped = snapTimelinePosition(project, positionMs, { pixelsPerSecond: zoom });
    playback.seek(snapped.valueMs);
  };

  const prepareRender = async () => {
    if (!project) return;
    try {
      setBusy('render');
      const blob = await renderAudioProjectToWav(project, mediaTracks, audioAssets);
      setRendered({ blob, projectUpdatedAt: project.updatedAt });
      notify({ kind: 'success', message: 'WAV готов. Его можно скачать или сохранить в медиатеку.' });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось собрать WAV', message: getErrorMessage(error, 'Проверьте монтаж и исходные треки.') });
    } finally {
      setBusy(null);
    }
  };

  const saveRenderedToLibrary = async () => {
    if (!project || !rendered || rendered.projectUpdatedAt !== project.updatedAt) return;
    try {
      setBusy('library');
      const result = await addMediaTrackFileFx({ blob: rendered.blob, fileName: `${safeFileName(project.name)}.wav` });
      notify({ kind: 'success', message: result.status === 'created' ? `Трек «${result.track.name}» добавлен в медиатеку.` : 'Такой результат уже есть в медиатеке.' });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось сохранить результат', message: getErrorMessage(error, 'Попробуйте ещё раз.') });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (modifier && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (modifier && key === 'c' && selectedClipIds.length > 0) {
        event.preventDefault();
        copySelection();
        return;
      }
      if (modifier && key === 'v' && clipboard) {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (!busy) void playback.toggle();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClipIds.length > 0) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (key === 's' && activeClip) {
        event.preventDefault();
        splitActiveClip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <main className="audio-editor-page page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Недеструктивный монтаж</span>
          <h1>Аудиоредактор</h1>
          <p>Нарезайте треки, переставляйте фрагменты и собирайте миксы. Исходные файлы в медиатеке не изменяются.</p>
        </div>
        <div className="page-heading__actions">
          <button className="primary-button" onClick={createProject}>+ Новый монтаж</button>
          <button className="secondary-button" disabled={!project} onClick={() => void deleteProject()}>Удалить монтаж</button>
        </div>
      </div>

      {projects.length === 0 || !project ? (
        <section className="empty-state audio-editor-empty">
          <strong>Монтажей пока нет</strong>
          <span>Создайте проект, добавьте исходники из медиатеки и соберите свой первый микс.</span>
          <button className="primary-button" onClick={createProject}>Создать монтаж</button>
        </section>
      ) : (
        <div className="audio-editor-layout">
          <aside className="audio-editor-projects">
            <strong>Проекты</strong>
            <div className="audio-editor-project-list">
              {projects.map((item) => (
                <button
                  key={item.id}
                  className={item.id === project.id ? 'audio-editor-project audio-editor-project--active' : 'audio-editor-project'}
                  onClick={() => {
                    playback.reset();
                    setSelectedProjectId(item.id);
                    setSelectedClipIds([]);
                    setActiveClipId(null);
                  }}
                >
                  <span>{item.name}</span>
                  <small>{formatMs(getProjectDurationMs(item))}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="audio-editor-workspace">
            <div className="audio-editor-header">
              <label>
                <span>Название монтажа</span>
                <input value={project.name} maxLength={200} onChange={(event) => replaceProject({ ...project, name: event.target.value || 'Без названия' })} />
              </label>
              <div className="audio-editor-history-actions">
                <button className="secondary-button" title="Ctrl/Cmd+Z" disabled={!historyStatus.canUndo} onClick={undo}>↶ Отменить</button>
                <button className="secondary-button" title="Ctrl/Cmd+Shift+Z или Ctrl/Cmd+Y" disabled={!historyStatus.canRedo} onClick={redo}>↷ Вернуть</button>
              </div>
            </div>

            <div className="audio-editor-sourcebar">
              <label>
                <span>Добавить из медиатеки</span>
                <select value={sourceTrackId} onChange={(event) => setSourceTrackId(event.target.value)}>
                  {mediaTracks.length === 0 && <option value="">В медиатеке нет аудио</option>}
                  {mediaTracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
                </select>
              </label>
              <label>
                <span>На дорожку</span>
                <select value={selectedLaneId ?? ''} onChange={(event) => setSelectedLaneId(event.target.value)}>
                  {project.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}
                </select>
              </label>
              <button className="primary-button" disabled={!sourceTrackId || busy === 'source'} onClick={() => void addSourceClip()}>{busy === 'source' ? 'Читаем аудио…' : ripple ? '+ Вставить и раздвинуть' : '+ Вставить в курсор'}</button>
              <button className="secondary-button" disabled={project.lanes.length >= 32} onClick={addLane}>+ Дорожка</button>
            </div>

            <AudioEditorTransport
              playheadMs={playback.playheadMs}
              durationMs={playback.durationMs}
              isPlaying={playback.isPlaying}
              zoom={zoom}
              ripple={ripple}
              selectedCount={selectedClipIds.length}
              canPaste={Boolean(clipboard)}
              canCrossfade={canCrossfade}
              onTogglePlayback={() => void playback.toggle()}
              onSeek={seek}
              onZoomChange={setZoom}
              onRippleChange={setRipple}
              onAddMarker={addMarker}
              onCopy={copySelection}
              onPaste={pasteClipboard}
              onCrossfade={applyCrossfade}
            />

            <AudioEditorTimeline
              project={project}
              trackById={trackById}
              assetById={assetById}
              sourceDurations={sourceDurations}
              pixelsPerSecond={zoom}
              playheadMs={playback.playheadMs}
              isPlaying={playback.isPlaying}
              selectedClipIds={selectedClipIds}
              activeClipId={activeClipId}
              onSeek={seek}
              onSelectionChange={(ids, activeId, laneId) => {
                setSelectedClipIds(ids);
                setActiveClipId(activeId);
                if (laneId) setSelectedLaneId(laneId);
              }}
              onSelectLane={setSelectedLaneId}
              onProjectChange={(next, options) => replaceProject(next, options)}
              onToggleLane={(laneId, key) => replaceProject({ ...project, lanes: project.lanes.map((lane) => lane.id === laneId ? { ...lane, [key]: !lane[key] } : lane) })}
              onRenameLane={(laneId, name) => replaceProject({ ...project, lanes: project.lanes.map((lane) => lane.id === laneId ? { ...lane, name: name || 'Дорожка' } : lane) })}
              onRemoveLane={removeLane}
              onZoomChange={setZoom}
              onRemoveMarker={removeMarker}
            />

            {activeClip && (
              <AudioEditorClipInspector
                project={project}
                clip={activeClip.clip}
                laneId={activeClip.lane.id}
                sourceName={trackById.get(activeClip.clip.sourceTrackId)?.name ?? 'Исходник удалён'}
                sourceDurationMs={sourceDurations[activeClip.clip.sourceTrackId]}
                playheadMs={playback.playheadMs}
                selectedCount={selectedClipIds.length}
                onPatch={patchActiveClip}
                onMoveLane={moveSelectionToLane}
                onSplit={splitActiveClip}
                onDuplicate={duplicateSelection}
                onDelete={deleteSelection}
              />
            )}

            <section className="audio-editor-render-card">
              <div>
                <strong>Готовый микс</strong>
                <span>Результат рендерится локально в браузере в WAV и может быть добавлен в общую медиатеку.</span>
              </div>
              <div className="audio-editor-render-actions">
                <button className="primary-button" disabled={playback.durationMs <= 0 || busy === 'render'} onClick={() => void prepareRender()}>{busy === 'render' ? 'Собираем WAV…' : 'Подготовить WAV'}</button>
                {rendered && rendered.projectUpdatedAt === project.updatedAt && (
                  <>
                    <button className="secondary-button" onClick={() => downloadBlob(rendered.blob, `${safeFileName(project.name)}.wav`)}>Скачать WAV</button>
                    <button className="secondary-button" disabled={busy === 'library'} onClick={() => void saveRenderedToLibrary()}>{busy === 'library' ? 'Сохраняем…' : 'В медиатеку'}</button>
                  </>
                )}
              </div>
            </section>
          </section>
        </div>
      )}
    </main>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function formatMs(ms: number) {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0')}`;
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'audio-mix';
}
