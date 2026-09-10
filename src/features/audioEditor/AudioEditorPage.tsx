import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useUnit } from 'effector-react';
import { $audioAssets, $audioProjects, $mediaTracks } from '../../model/game';
import type { AudioAsset, AudioClip, AudioProject, MediaTrack } from '../../model/types';
import { createId } from '../../lib/ids';
import { addMediaTrackFileFx } from '../../model/media';
import { downloadBlob } from '../../lib/download';
import { getErrorMessage } from '../../lib/errors';
import { useFeedback } from '../../components/feedback/FeedbackProvider';
import { clearDecodedAudioBufferCache, decodeAudioAsset } from './audioBuffers';
import { playAudioProject, renderAudioProjectToWav, type AudioProjectPlayback } from './audioEngine';
import {
  AUDIO_EDITOR_MIN_CLIP_MS,
  createAudioClip,
  createAudioEditorLane,
  createAudioProject,
  getClipTimelineDurationMs,
  getClipTimelineEndMs,
  getProjectDurationMs,
  normalizeAudioClip,
  splitAudioClip,
} from './audioProject';
import { audioProjectAdded, audioProjectDeleted, audioProjectReplaced } from './model';
import { WaveformCanvas } from './WaveformCanvas';

const DEFAULT_PIXELS_PER_SECOND = 36;
const SNAP_MS = 50;
const MAX_HISTORY = 100;

export function AudioEditorPage() {
  const [projects, mediaTracks, audioAssets] = useUnit([$audioProjects, $mediaTracks, $audioAssets]);
  const { notify, confirm } = useFeedback();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [sourceTrackId, setSourceTrackId] = useState(mediaTracks[0]?.id ?? '');
  const [zoom, setZoom] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [busy, setBusy] = useState<'source' | 'render' | 'library' | null>(null);
  const [rendered, setRendered] = useState<{ blob: Blob; projectUpdatedAt: number } | null>(null);
  const [sourceDurations, setSourceDurations] = useState<Record<string, number>>({});
  const playbackRef = useRef<AudioProjectPlayback | null>(null);
  const playbackClockRef = useRef<{ startedAt: number; fromMs: number } | null>(null);
  const animationRef = useRef<number | null>(null);
  const historyRef = useRef<Record<string, { past: AudioProject[]; future: AudioProject[] }>>({});
  const [, forceHistoryRender] = useState(0);

  const project = projects.find((item) => item.id === selectedProjectId) ?? projects[0] ?? null;
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const assetById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);
  const selectedClip = useMemo(() => {
    if (!project || !selectedClipId) return null;
    for (const lane of project.lanes) {
      const clip = lane.clips.find((item) => item.id === selectedClipId);
      if (clip) return { clip, laneId: lane.id };
    }
    return null;
  }, [project, selectedClipId]);
  const durationMs = project ? getProjectDurationMs(project) : 0;
  const history = project ? historyRef.current[project.id] : undefined;

  useEffect(() => {
    if (!projects.length) {
      setSelectedProjectId(null);
      setSelectedClipId(null);
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
    if (selectedClipId && !project.lanes.some((lane) => lane.clips.some((clip) => clip.id === selectedClipId))) setSelectedClipId(null);
  }, [project, selectedClipId, selectedLaneId]);

  useEffect(() => () => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    playbackClockRef.current = null;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    clearDecodedAudioBufferCache();
  }, []);

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

  const replaceProject = (next: AudioProject, recordHistory = true, historySnapshot?: AudioProject) => {
    if (recordHistory) pushHistory(historySnapshot ?? project ?? next);
    audioProjectReplaced({ ...next, updatedAt: Date.now() });
  };

  const pushHistory = (snapshot: AudioProject) => {
    const entry = historyRef.current[snapshot.id] ?? { past: [], future: [] };
    entry.past.push(cloneProject(snapshot));
    if (entry.past.length > MAX_HISTORY) entry.past.shift();
    entry.future = [];
    historyRef.current[snapshot.id] = entry;
    forceHistoryRender((value) => value + 1);
  };

  const undo = () => {
    if (!project) return;
    const entry = historyRef.current[project.id];
    const previous = entry?.past.pop();
    if (!entry || !previous) return;
    entry.future.push(cloneProject(project));
    audioProjectReplaced({ ...previous, updatedAt: Date.now() });
    forceHistoryRender((value) => value + 1);
  };

  const redo = () => {
    if (!project) return;
    const entry = historyRef.current[project.id];
    const next = entry?.future.pop();
    if (!entry || !next) return;
    entry.past.push(cloneProject(project));
    audioProjectReplaced({ ...next, updatedAt: Date.now() });
    forceHistoryRender((value) => value + 1);
  };

  const createProject = () => {
    const next = createAudioProject();
    audioProjectAdded(next);
    setSelectedProjectId(next.id);
    setSelectedLaneId(next.lanes[0].id);
    setSelectedClipId(null);
    setPlayheadMs(0);
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
    stopPlayback();
    audioProjectDeleted(project.id);
    delete historyRef.current[project.id];
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
      const start = snapMs(playheadMs);
      const clip = createAudioClip(track.id, duration, start);
      const next = mapProject(project, (lane) => lane.id === targetLaneId ? { ...lane, clips: [...lane.clips, clip] } : lane);
      replaceProject(next);
      setSelectedLaneId(targetLaneId);
      setSelectedClipId(clip.id);
      setPlayheadMs(getClipTimelineEndMs(clip));
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось прочитать аудио', message: getErrorMessage(error, 'Попробуйте другой трек.') });
    } finally {
      setBusy(null);
    }
  };

  const addLane = () => {
    if (!project) return;
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

  const patchClip = (clipId: string, patch: Partial<AudioClip>, recordHistory = true, historySnapshot?: AudioProject) => {
    if (!project) return;
    const next = mapProject(project, (lane) => ({
      ...lane,
      clips: lane.clips.map((clip) => clip.id === clipId ? normalizeAudioClip({ ...clip, ...patch }) : clip),
    }));
    replaceProject(next, recordHistory, historySnapshot);
  };

  const moveClipToLane = (clipId: string, targetLaneId: string) => {
    if (!project) return;
    let moving: AudioClip | undefined;
    const lanesWithout = project.lanes.map((lane) => ({
      ...lane,
      clips: lane.clips.filter((clip) => {
        if (clip.id !== clipId) return true;
        moving = clip;
        return false;
      }),
    }));
    if (!moving) return;
    const lanes = lanesWithout.map((lane) => lane.id === targetLaneId ? { ...lane, clips: [...lane.clips, moving!] } : lane);
    replaceProject({ ...project, lanes });
    setSelectedLaneId(targetLaneId);
  };

  const deleteSelectedClip = () => {
    if (!project || !selectedClip) return;
    replaceProject(mapProject(project, (lane) => ({ ...lane, clips: lane.clips.filter((clip) => clip.id !== selectedClip.clip.id) })));
    setSelectedClipId(null);
  };

  const duplicateSelectedClip = () => {
    if (!project || !selectedClip) return;
    const source = selectedClip.clip;
    const copy: AudioClip = {
      ...source,
      id: createId('audio-clip'),
      timelineStartMs: snapMs(getClipTimelineEndMs(source) + 100),
    };
    const next = mapProject(project, (lane) => lane.id === selectedClip.laneId ? { ...lane, clips: [...lane.clips, copy] } : lane);
    replaceProject(next);
    setSelectedClipId(copy.id);
  };

  const splitSelectedClip = () => {
    if (!project || !selectedClip) return;
    const split = splitAudioClip(selectedClip.clip, playheadMs);
    if (!split) {
      notify({ kind: 'info', message: 'Поставьте курсор внутри выбранного фрагмента, не слишком близко к краю.' });
      return;
    }
    const next = mapProject(project, (lane) => lane.id === selectedClip.laneId ? {
      ...lane,
      clips: lane.clips.flatMap((clip) => clip.id === selectedClip.clip.id ? split : [clip]),
    } : lane);
    replaceProject(next);
    setSelectedClipId(split[1].id);
  };

  const togglePlayback = async () => {
    if (!project || durationMs <= 0) return;
    if (isPlaying) {
      stopPlayback();
      return;
    }
    const start = playheadMs >= durationMs - 20 ? 0 : playheadMs;
    try {
      const handle = await playAudioProject(project, mediaTracks, audioAssets, start);
      playbackRef.current = handle;
      playbackClockRef.current = { startedAt: performance.now(), fromMs: start };
      setIsPlaying(true);
      setPlayheadMs(start);
      animatePlayback(durationMs);
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось воспроизвести монтаж', message: getErrorMessage(error, 'Проверьте исходные треки.') });
    }
  };

  const animatePlayback = (projectDurationMs: number) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const tick = () => {
      const clock = playbackClockRef.current;
      if (!clock) return;
      const next = clock.fromMs + (performance.now() - clock.startedAt);
      if (next >= projectDurationMs) {
        setPlayheadMs(projectDurationMs);
        stopPlayback(false);
        return;
      }
      setPlayheadMs(next);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
  };

  const stopPlayback = (keepCurrentPosition = true) => {
    if (keepCurrentPosition && playbackClockRef.current) {
      const { fromMs, startedAt } = playbackClockRef.current;
      setPlayheadMs((current) => Math.min(durationMs || current, fromMs + performance.now() - startedAt));
    }
    playbackRef.current?.stop();
    playbackRef.current = null;
    playbackClockRef.current = null;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setIsPlaying(false);
  };

  const seek = (positionMs: number) => {
    if (isPlaying) stopPlayback();
    setPlayheadMs(Math.max(0, Math.min(Math.max(durationMs, 1_000), snapMs(positionMs))));
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
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (!busy) void togglePlayback();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClip) {
        event.preventDefault();
        deleteSelectedClip();
        return;
      }
      if (key === 's' && selectedClip) {
        event.preventDefault();
        splitSelectedClip();
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
                  onClick={() => { stopPlayback(); setSelectedProjectId(item.id); setSelectedClipId(null); setPlayheadMs(0); }}
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
                <input
                  value={project.name}
                  maxLength={200}
                  onChange={(event) => replaceProject({ ...project, name: event.target.value || 'Без названия' })}
                />
              </label>
              <div className="audio-editor-history-actions">
                <button className="secondary-button" title="Ctrl/Cmd+Z" disabled={!history?.past.length} onClick={undo}>↶ Отменить</button>
                <button className="secondary-button" title="Ctrl/Cmd+Shift+Z или Ctrl/Cmd+Y" disabled={!history?.future.length} onClick={redo}>↷ Вернуть</button>
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
              <button className="primary-button" disabled={!sourceTrackId || busy === 'source'} onClick={() => void addSourceClip()}>
                {busy === 'source' ? 'Читаем аудио…' : '+ Вставить в курсор'}
              </button>
              <button className="secondary-button" onClick={addLane}>+ Дорожка</button>
            </div>

            <div className="audio-editor-transport">
              <button className="audio-editor-play" title="Пробел" disabled={durationMs <= 0} onClick={() => void togglePlayback()}>{isPlaying ? 'Ⅱ' : '▶'}</button>
              <strong>{formatMs(playheadMs)}</strong>
              <input
                type="range"
                min={0}
                max={Math.max(durationMs, 1_000)}
                step={10}
                value={Math.min(playheadMs, Math.max(durationMs, 1_000))}
                onChange={(event) => seek(Number(event.target.value))}
              />
              <span>{formatMs(durationMs)}</span>
              <label className="audio-editor-zoom">Масштаб <input type="range" min={16} max={120} step={4} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
            </div>

            <div className="audio-editor-shortcuts" aria-label="Горячие клавиши аудиоредактора">
              <span><kbd>Space</kbd> play/pause</span>
              <span><kbd>S</kbd> разрезать</span>
              <span><kbd>Delete</kbd> удалить фрагмент</span>
              <span><kbd>Ctrl/Cmd+Z</kbd> отменить</span>
            </div>

            <Timeline
              project={project}
              trackById={trackById}
              assetById={assetById}
              sourceDurations={sourceDurations}
              pixelsPerSecond={zoom}
              playheadMs={playheadMs}
              selectedClipId={selectedClipId}
              onSeek={seek}
              onSelectClip={(clipId, laneId) => { setSelectedClipId(clipId); setSelectedLaneId(laneId); }}
              onSelectLane={setSelectedLaneId}
              onPatchClip={patchClip}
              onToggleLane={(laneId, key) => replaceProject(mapProject(project, (lane) => lane.id === laneId ? { ...lane, [key]: !lane[key] } : lane))}
              onRenameLane={(laneId, name) => replaceProject(mapProject(project, (lane) => lane.id === laneId ? { ...lane, name: name || 'Дорожка' } : lane))}
              onRemoveLane={removeLane}
            />

            {selectedClip && (
              <ClipInspector
                project={project}
                clip={selectedClip.clip}
                laneId={selectedClip.laneId}
                sourceName={trackById.get(selectedClip.clip.sourceTrackId)?.name ?? 'Исходник удалён'}
                sourceDurationMs={sourceDurations[selectedClip.clip.sourceTrackId]}
                playheadMs={playheadMs}
                onPatch={(patch) => patchClip(selectedClip.clip.id, patch)}
                onMoveLane={(laneId) => moveClipToLane(selectedClip.clip.id, laneId)}
                onSplit={splitSelectedClip}
                onDuplicate={duplicateSelectedClip}
                onDelete={deleteSelectedClip}
              />
            )}

            <section className="audio-editor-render-card">
              <div>
                <strong>Готовый микс</strong>
                <span>Результат рендерится локально в браузере в WAV и может быть добавлен в общую медиатеку.</span>
              </div>
              <div className="audio-editor-render-actions">
                <button className="primary-button" disabled={durationMs <= 0 || busy === 'render'} onClick={() => void prepareRender()}>{busy === 'render' ? 'Собираем WAV…' : 'Подготовить WAV'}</button>
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

function Timeline({
  project,
  trackById,
  assetById,
  sourceDurations,
  pixelsPerSecond,
  playheadMs,
  selectedClipId,
  onSeek,
  onSelectClip,
  onSelectLane,
  onPatchClip,
  onToggleLane,
  onRenameLane,
  onRemoveLane,
}: {
  project: AudioProject;
  trackById: Map<string, MediaTrack>;
  assetById: Map<string, AudioAsset>;
  sourceDurations: Record<string, number>;
  pixelsPerSecond: number;
  playheadMs: number;
  selectedClipId: string | null;
  onSeek: (positionMs: number) => void;
  onSelectClip: (clipId: string, laneId: string) => void;
  onSelectLane: (laneId: string) => void;
  onPatchClip: (clipId: string, patch: Partial<AudioClip>, recordHistory?: boolean, historySnapshot?: AudioProject) => void;
  onToggleLane: (laneId: string, key: 'muted' | 'solo') => void;
  onRenameLane: (laneId: string, name: string) => void;
  onRemoveLane: (laneId: string) => void;
}) {
  const durationMs = Math.max(getProjectDurationMs(project) + 3_000, 15_000);
  const width = Math.max(720, durationMs / 1000 * pixelsPerSecond);

  return (
    <div className="audio-editor-timeline-shell">
      <div className="audio-editor-lane-controls">
        <div className="audio-editor-ruler-spacer" />
        {project.lanes.map((lane) => (
          <div key={lane.id} className="audio-editor-lane-control" onClick={() => onSelectLane(lane.id)}>
            <input value={lane.name} maxLength={120} onChange={(event) => onRenameLane(lane.id, event.target.value)} />
            <div>
              <button className={lane.muted ? 'audio-editor-mini audio-editor-mini--active' : 'audio-editor-mini'} onClick={(event) => { event.stopPropagation(); onToggleLane(lane.id, 'muted'); }}>M</button>
              <button className={lane.solo ? 'audio-editor-mini audio-editor-mini--active' : 'audio-editor-mini'} onClick={(event) => { event.stopPropagation(); onToggleLane(lane.id, 'solo'); }}>S</button>
              <button className="audio-editor-mini" disabled={project.lanes.length <= 1 || lane.clips.length > 0} onClick={(event) => { event.stopPropagation(); onRemoveLane(lane.id); }}>×</button>
            </div>
          </div>
        ))}
      </div>

      <div className="audio-editor-scroll">
        <div className="audio-editor-timeline" style={{ width }} onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onSeek((event.clientX - rect.left) / pixelsPerSecond * 1000);
        }}>
          <TimelineRuler width={width} pixelsPerSecond={pixelsPerSecond} onSeek={onSeek} />
          {project.lanes.map((lane) => (
            <div key={lane.id} className="audio-editor-lane" style={{ width, backgroundSize: `${pixelsPerSecond}px 100%` }} onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const rect = event.currentTarget.getBoundingClientRect();
              onSelectLane(lane.id);
              onSeek((event.clientX - rect.left) / pixelsPerSecond * 1000);
            }}>
              {lane.clips.map((clip) => {
                const track = trackById.get(clip.sourceTrackId);
                const asset = track ? assetById.get(track.audioId) : undefined;
                return (
                  <TimelineClip
                    key={clip.id}
                    clip={clip}
                    project={project}
                    laneId={lane.id}
                    label={track?.name ?? 'Исходник отсутствует'}
                    asset={asset}
                    sourceDurationMs={sourceDurations[clip.sourceTrackId]}
                    pixelsPerSecond={pixelsPerSecond}
                    selected={selectedClipId === clip.id}
                    onSelect={onSelectClip}
                    onPatch={onPatchClip}
                  />
                );
              })}
            </div>
          ))}
          <div className="audio-editor-playhead" style={{ left: playheadMs / 1000 * pixelsPerSecond }} aria-hidden="true"><span /></div>
        </div>
      </div>
    </div>
  );
}

function TimelineRuler({ width, pixelsPerSecond, onSeek }: { width: number; pixelsPerSecond: number; onSeek: (positionMs: number) => void }) {
  const durationSeconds = Math.ceil(width / pixelsPerSecond);
  const step = pixelsPerSecond >= 72 ? 1 : pixelsPerSecond >= 32 ? 5 : 10;
  const ticks = [];
  for (let second = 0; second <= durationSeconds; second += step) ticks.push(second);
  return (
    <div className="audio-editor-ruler" onPointerDown={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      onSeek((event.clientX - rect.left) / pixelsPerSecond * 1000);
    }}>
      {ticks.map((second) => <span key={second} style={{ left: second * pixelsPerSecond }}>{formatMs(second * 1000)}</span>)}
    </div>
  );
}

function TimelineClip({ clip, project, laneId, label, asset, pixelsPerSecond, selected, onSelect, onPatch }: {
  clip: AudioClip;
  project: AudioProject;
  laneId: string;
  label: string;
  asset?: AudioAsset;
  sourceDurationMs?: number;
  pixelsPerSecond: number;
  selected: boolean;
  onSelect: (clipId: string, laneId: string) => void;
  onPatch: (clipId: string, patch: Partial<AudioClip>, recordHistory?: boolean, historySnapshot?: AudioProject) => void;
}) {
  const left = clip.timelineStartMs / 1000 * pixelsPerSecond;
  const width = Math.max(8, getClipTimelineDurationMs(clip) / 1000 * pixelsPerSecond);

  const gesture = (event: ReactPointerEvent, mode: 'move' | 'left' | 'right') => {
    event.stopPropagation();
    onSelect(clip.id, laneId);
    const startX = event.clientX;
    const initial = { ...clip };
    const snapshot = cloneProject(project);
    let changed = false;
    let lastPatch: Partial<AudioClip> | null = null;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const deltaMs = snapDeltaMs((moveEvent.clientX - startX) / pixelsPerSecond * 1000);
      if (Math.abs(deltaMs) < SNAP_MS) return;
      changed = true;
      if (mode === 'move') {
        lastPatch = { timelineStartMs: Math.max(0, initial.timelineStartMs + deltaMs) };
        onPatch(clip.id, lastPatch, false);
        return;
      }
      if (mode === 'left') {
        const maxDelta = (initial.sourceEndMs - initial.sourceStartMs) / initial.playbackRate - AUDIO_EDITOR_MIN_CLIP_MS;
        const maxNegativeDelta = -Math.min(initial.timelineStartMs, initial.sourceStartMs / initial.playbackRate);
        const clamped = Math.min(maxDelta, Math.max(maxNegativeDelta, deltaMs));
        lastPatch = {
          timelineStartMs: initial.timelineStartMs + clamped,
          sourceStartMs: initial.sourceStartMs + clamped * initial.playbackRate,
        };
        onPatch(clip.id, lastPatch, false);
        return;
      }
      const minDelta = -(initial.sourceEndMs - initial.sourceStartMs) / initial.playbackRate + AUDIO_EDITOR_MIN_CLIP_MS;
      const maxDelta = sourceDurationMs === undefined ? 0 : Math.max(0, (sourceDurationMs - initial.sourceEndMs) / initial.playbackRate);
      lastPatch = { sourceEndMs: initial.sourceEndMs + Math.min(maxDelta, Math.max(minDelta, deltaMs)) * initial.playbackRate };
      onPatch(clip.id, lastPatch, false);
    };

    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (changed && lastPatch) onPatch(clip.id, lastPatch, true, snapshot);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div
      className={selected ? 'audio-editor-clip audio-editor-clip--selected' : 'audio-editor-clip'}
      style={{ left, width }}
      title={label}
      onPointerDown={(event) => gesture(event, 'move')}
    >
      <WaveformCanvas asset={asset} sourceStartMs={clip.sourceStartMs} sourceEndMs={clip.sourceEndMs} />
      <strong>{label}</strong>
      <small>{formatMs(clip.sourceStartMs)}–{formatMs(clip.sourceEndMs)}</small>
      <button className="audio-editor-trim-handle audio-editor-trim-handle--left" aria-label="Обрезать начало" onPointerDown={(event) => gesture(event, 'left')} />
      <button className="audio-editor-trim-handle audio-editor-trim-handle--right" aria-label="Обрезать конец" onPointerDown={(event) => gesture(event, 'right')} />
    </div>
  );
}

function ClipInspector({ project, clip, laneId, sourceName, sourceDurationMs, playheadMs, onPatch, onMoveLane, onSplit, onDuplicate, onDelete }: {
  project: AudioProject;
  clip: AudioClip;
  laneId: string;
  sourceName: string;
  sourceDurationMs?: number;
  playheadMs: number;
  onPatch: (patch: Partial<AudioClip>) => void;
  onMoveLane: (laneId: string) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const duration = getClipTimelineDurationMs(clip);
  const maxSourceEnd = sourceDurationMs ?? clip.sourceEndMs;
  return (
    <section className="audio-editor-inspector">
      <div className="audio-editor-inspector__heading">
        <div><span className="eyebrow">Выбранный фрагмент</span><strong>{sourceName}</strong><small>Длина на таймлайне: {formatMs(duration)}</small></div>
        <div className="inline-actions">
          <button className="secondary-button" title="S" onClick={onSplit} disabled={playheadMs <= clip.timelineStartMs || playheadMs >= getClipTimelineEndMs(clip)}>Разрезать по курсору</button>
          <button className="secondary-button" onClick={onDuplicate}>Дублировать</button>
          <button className="danger-button" title="Delete" onClick={onDelete}>Удалить</button>
        </div>
      </div>
      <div className="audio-editor-inspector-grid">
        <NumberField label="Позиция, сек" value={clip.timelineStartMs / 1000} min={0} step={0.05} onChange={(value) => onPatch({ timelineStartMs: value * 1000 })} />
        <NumberField label="Начало исходника, сек" value={clip.sourceStartMs / 1000} min={0} max={(clip.sourceEndMs - AUDIO_EDITOR_MIN_CLIP_MS) / 1000} step={0.05} onChange={(value) => onPatch({ sourceStartMs: value * 1000 })} />
        <NumberField label="Конец исходника, сек" value={clip.sourceEndMs / 1000} min={(clip.sourceStartMs + AUDIO_EDITOR_MIN_CLIP_MS) / 1000} max={maxSourceEnd / 1000} step={0.05} onChange={(value) => onPatch({ sourceEndMs: value * 1000 })} />
        <NumberField label="Громкость, dB" value={clip.gainDb} min={-60} max={12} step={0.5} onChange={(value) => onPatch({ gainDb: value })} />
        <NumberField label="Fade in, сек" value={clip.fadeInMs / 1000} min={0} max={duration / 1000} step={0.05} onChange={(value) => onPatch({ fadeInMs: value * 1000 })} />
        <NumberField label="Fade out, сек" value={clip.fadeOutMs / 1000} min={0} max={duration / 1000} step={0.05} onChange={(value) => onPatch({ fadeOutMs: value * 1000 })} />
        <NumberField label="Скорость" value={clip.playbackRate} min={0.25} max={4} step={0.05} onChange={(value) => onPatch({ playbackRate: value })} />
        <label className="audio-editor-field"><span>Дорожка</span><select value={laneId} onChange={(event) => onMoveLane(event.target.value)}>{project.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}</select></label>
      </div>
    </section>
  );
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min?: number; max?: number; step: number; onChange: (value: number) => void }) {
  return <label className="audio-editor-field"><span>{label}</span><input type="number" value={round(value, 3)} min={min} max={max} step={step} onChange={(event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)));
  }} /></label>;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function mapProject(project: AudioProject, mapper: (lane: AudioProject['lanes'][number]) => AudioProject['lanes'][number]): AudioProject {
  return { ...project, lanes: project.lanes.map(mapper) };
}

function cloneProject(project: AudioProject): AudioProject {
  return {
    ...project,
    lanes: project.lanes.map((lane) => ({ ...lane, clips: lane.clips.map((clip) => ({ ...clip })) })),
  };
}

function snapMs(value: number) {
  return Math.max(0, Math.round(value / SNAP_MS) * SNAP_MS);
}

function snapDeltaMs(value: number) {
  return Math.round(value / SNAP_MS) * SNAP_MS;
}

function formatMs(ms: number) {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0')}`;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'audio-mix';
}
