import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useUnit } from 'effector-react';
import { $audioAssets, $audioProjects, $mediaTracks } from '../../model/game';
import type { AudioClip, AudioProject } from '../../model/types';
import { captureStateWrite } from '../../model/core/writeAccess';
import { getErrorMessage } from '../../lib/errors';
import { useFeedback } from '../../components/feedback/FeedbackProvider';
import { clearDecodedAudioBufferCache, decodeAudioAsset } from './audioBuffers';
import {
  createAudioClip,
  createAudioEditorLane,
  createAudioProject,
  duplicateAudioProject,
  getClipTimelineEndMs,
  getProjectDurationMs,
  normalizeAudioClip,
  splitAudioClip,
} from './audioProject';
import { audioProjectAdded, audioProjectDeleted, audioProjectReplaced } from './model';
import {
  addProjectMarker,
  copyClips,
  deleteClips,
  findClip,
  insertClip,
  shiftClipLanes,
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
import { AudioEditorHelpTip } from './AudioEditorGuide';
import { getAudioEditorKeyboardCommand } from './audioEditorKeyboard';

import { $editorProjectId, $editorSessions, emptyEditorSession, editorProjectSelected, editorSessionChanged, type EditorSession } from './editorSession';
import { createId } from '../../lib/ids';
import { TextField } from './editorFields';
import { NumberField } from './AudioEditorClipInspector';
import { EditorRangeControls } from './EditorRangeControls';
import { EditorMixPanel } from './EditorMixPanel';
import { EditorExportPanel } from './EditorExportPanel';
import { EditorSources } from './EditorSources';
import { useEditorImport } from './useEditorImport';

type ProjectChangeOptions = {
  recordHistory?: boolean;
  historySnapshot?: AudioProject;
};

export function AudioEditorPage() {
  const [projects, mediaTracks, audioAssets] = useUnit([$audioProjects, $mediaTracks, $audioAssets]);
  const { notify, confirm } = useFeedback();
  const [selectedProjectId, sessions] = useUnit([$editorProjectId, $editorSessions]);
  const project = projects.find((item) => item.id === selectedProjectId) ?? projects[0] ?? null;
  const session = (project && sessions[project.id]) || emptyEditorSession;
  const { selectedClipIds, activeClipId, selectedLaneId, zoom, range, loop } = session;
  const setSession = (patch: Partial<EditorSession>) => { if (project) editorSessionChanged({ id: project.id, patch }); };
  const setSelectedProjectId = editorProjectSelected;
  const setSelectedClipIds = (selectedClipIds: string[]) => setSession({ selectedClipIds });
  const setActiveClipId = (activeClipId: string | null) => setSession({ activeClipId });
  const setSelectedLaneId = (selectedLaneId: string | null) => setSession({ selectedLaneId });
  const setZoom = (zoom: number) => setSession({ zoom });
  const [sourceTrackId, setSourceTrackId] = useState(mediaTracks[0]?.id ?? '');
  const importer = useEditorImport(project?.id);
  const [clipboard, setClipboard] = useState<AudioClipboard | null>(null);
  const [busy, setBusy] = useState<'source' | null>(null);
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});
  const sourceDurations = useMemo(() => Object.fromEntries(mediaTracks.filter(track => assetDurations[track.audioId] !== undefined).map(track => [track.id, assetDurations[track.audioId]])), [assetDurations, mediaTracks]);
  const history = useAudioEditorHistory();

  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const assetById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);
  const activeClip = useMemo(() => project && activeClipId ? findClip(project, activeClipId) : null, [activeClipId, project]);

  const handlePlaybackError = useCallback((error: unknown) => {
    notify({ kind: 'error', title: 'Не удалось воспроизвести монтаж', message: getErrorMessage(error, 'Проверьте исходные треки.') });
  }, [notify]);
  const playback = useAudioEditorPlayback({ project, mediaTracks, audioAssets, onError: handlePlaybackError });
  const activeProjectRef = useRef(project?.id);
  activeProjectRef.current = project?.id;
  const sourceRequestRef = useRef(0);
  useEffect(() => () => { sourceRequestRef.current += 1; }, [project?.id]);

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
    if (clipboard?.clips.some(item => !mediaTracks.some(track => track.id === item.clip.sourceTrackId))) setClipboard(null);
    if (!mediaTracks.some((track) => track.id === sourceTrackId)) setSourceTrackId(mediaTracks[0]?.id ?? '');
  }, [mediaTracks, sourceTrackId, clipboard]);

  useEffect(() => {
    if (!project) return;
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
        setAssetDurations((current) => current[asset.id] !== undefined ? current : { ...current, [asset.id]: buffer.duration * 1000 });
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

  const gainSnapshot = useRef<AudioProject | null>(null);
  const beginGain = () => { gainSnapshot.current = project; };
  const commitGain = () => {
    const snapshot = gainSnapshot.current; gainSnapshot.current = null;
    const current = snapshot && $audioProjects.getState().find(p => p.id === snapshot.id);
    if (snapshot && current && JSON.stringify({ ...snapshot, updatedAt: 0 }) !== JSON.stringify({ ...current, updatedAt: 0 })) history.push(snapshot);
  };

  const createProject = () => {
    const next = createAudioProject();
    audioProjectAdded(next);
    setSelectedProjectId(next.id);
    playback.stop();
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
    const targetLaneId = selectedLaneId ?? project.lanes[0].id;
    const position = snapTimelinePosition(project, playback.playheadMs, { pixelsPerSecond: zoom }).valueMs;
    try {
      const assertCurrentWrite = captureStateWrite();
      const request = ++sourceRequestRef.current;
      setBusy('source');
      const buffer = await decodeAudioAsset(asset);
      if (request !== sourceRequestRef.current || activeProjectRef.current !== project.id) return;
      assertCurrentWrite();
      const current = $audioProjects.getState().find((item) => item.id === project.id);
      if (!current || !$mediaTracks.getState().some((item) => item.id === track.id && item.audioId === asset.id)) return;
      if (!current.lanes.some(lane => lane.id === targetLaneId)) throw new Error('Целевая дорожка удалена. Выберите дорожку и повторите добавление.');
      if (current.lanes.reduce((n, lane) => n + lane.clips.length, 0) >= 5000) throw new Error('Достигнут предел 5000 фрагментов.');
      const duration = buffer.duration * 1000;
      setAssetDurations((current) => ({ ...current, [asset.id]: duration }));
      const clip = createAudioClip(track.id, duration, position);
      if (getClipTimelineEndMs(clip) > 21_600_000) throw new Error('Фрагмент выходит за пределы 6 часов.');
      replaceProject(insertClip(current, targetLaneId, clip, position), { historySnapshot: current });
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

  const patchActiveClip = (patch: Partial<AudioClip>, preview = false) => {
    if (!project || !activeClip) return;
    const lanes = project.lanes.map((lane) => lane.id === activeClip.lane.id ? {
      ...lane,
      clips: lane.clips.map((clip) => clip.id === activeClip.clip.id ? normalizeAudioClip({ ...clip, ...patch }) : clip),
    } : lane);
    replaceProject({ ...project, lanes }, { recordHistory: !preview });
  };

  const moveSelectionToLane = (targetLaneId: string) => {
    if (!project || !activeClipId) return;
    const ids = selectedClipIds.includes(activeClipId) ? selectedClipIds : [activeClipId];
    replaceProject(shiftClipLanes(project, ids, project.lanes.findIndex(l => l.id === targetLaneId) - project.lanes.findIndex(l => l.id === activeClip?.lane.id)));
    setSelectedLaneId(targetLaneId);
  };

  const deleteSelection = () => {
    if (!project || selectedClipIds.length === 0) return;
    replaceProject(deleteClips(project, selectedClipIds));
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
    const result = pasteClips(project, clipboard, playback.playheadMs, laneId);
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
    const result = pasteClips(project, copied, position, laneId);
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
    setSelectedClipIds([split[1].id]);
    setActiveClipId(split[1].id);
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

  const seek = (positionMs: number, precise = false) => {
    if (!project || precise) return playback.seek(positionMs);
    const snapped = snapTimelinePosition(project, positionMs, { pixelsPerSecond: zoom });
    playback.seek(snapped.valueMs);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isEditableTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
      const command = getAudioEditorKeyboardCommand(event, {
        hasSelection: selectedClipIds.length > 0,
        hasClipboard: Boolean(clipboard),
        hasActiveClip: Boolean(activeClip),
      });
      if (!command) return;
      event.preventDefault();

      switch (command) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'copy': copySelection(); break;
        case 'paste': pasteClipboard(); break;
        case 'toggle-playback': if (!busy) void playback.toggle(); break;
        case 'delete-selection': deleteSelection(); break;
        case 'split': splitActiveClip(); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });


  return (
    <main className="audio-editor-page page-shell" onPointerDownCapture={(event) => {
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && focused !== event.target && focused.closest('.audio-editor-page')) {
        if (event.target instanceof Node && focused.closest('.audio-editor-source-picker')?.contains(event.target)) return;
        // Commit before the timeline changes selection or captures a drag snapshot.
        flushSync(() => focused.blur());
      }
    }}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Недеструктивный монтаж</span>
          <h1>Аудиоредактор</h1>
          <p>Нарезайте треки, переставляйте фрагменты и собирайте миксы. Исходные файлы в медиатеке не изменяются.</p>
        </div>
        <div className="page-heading__actions">
          <button className="primary-button" onClick={createProject}>+ Новый монтаж</button>
          <button className="secondary-button" disabled={!project} onClick={() => { if (project) { const next = duplicateAudioProject(project); playback.stop(); audioProjectAdded(next); setSelectedProjectId(next.id); } }}>Копия монтажа</button>
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
                    playback.stop();
                    setSelectedProjectId(item.id);
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
              <label><span>Название монтажа</span><TextField key={project.id} label="Название монтажа" value={project.name} maxLength={200} onCommit={name => replaceProject({ ...project, name })} /></label>
              <div className="inline-actions"><button className="secondary-button" disabled={!history.status(project.id).canUndo} onClick={undo}>Отменить</button><button className="secondary-button" disabled={!history.status(project.id).canRedo} onClick={redo}>Вернуть</button></div>
            </div>

            <div className="audio-editor-sourcebar">
              <EditorSources key={project.id} tracks={mediaTracks} assets={audioAssets} selectedId={sourceTrackId} onSelect={setSourceTrackId}
                onImport={files => void importer.importFiles(files, selectedLaneId ?? project.lanes[0].id, playback.playheadMs)}
                onPreview={() => playback.stop()} isPlaying={playback.isPlaying || playback.isStarting} disabled={importer.busy} />
              <label>
                <span>На дорожку <AudioEditorHelpTip text="Выберите дорожку, на которую будет добавлен новый фрагмент." /></span>
                <select value={selectedLaneId ?? ''} onChange={(event) => setSelectedLaneId(event.target.value)}>
                  {project.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}
                </select>
              </label>
              <button
                className="primary-button"
                title="Добавить выбранный трек в позицию вертикального курсора"
                disabled={!sourceTrackId || busy === 'source'}
                onClick={() => void addSourceClip()}
              >{busy === 'source' ? 'Читаем аудио…' : 'Добавить'}</button>
              <button className="secondary-button" title="Добавить дополнительную дорожку для наложений" disabled={project.lanes.length >= 32} onClick={addLane}>+ Дорожка</button>
              {mediaTracks.length === 0 && <span className="audio-editor-sourcebar__empty">Импортируйте файл кнопкой или перетащите его на дорожку.</span>}
            </div>

            {importer.progress && <p role="status">{importer.progress} {importer.busy && <button className="secondary-button" onClick={importer.cancel}>Остановить импорт</button>}</p>}
            {importer.errors.map((error, i) => <p role="alert" key={i}>{error}</p>)}
            <div className="audio-editor-cursor-field"><NumberField label="Курсор, сек" value={playback.playheadMs / 1000} min={0} max={21600} step={0.001} onChange={v => playback.seek(v * 1000)} /></div>
            <AudioEditorTransport
              playheadMs={playback.playheadMs}
              durationMs={playback.durationMs}
              isPlaying={playback.isPlaying}
              isStarting={playback.isStarting}
              selectedCount={selectedClipIds.length}
              onTogglePlayback={() => void playback.toggle()}
              onSeek={seek}
              onAddMarker={addMarker}
            />

            <EditorRangeControls range={range} loop={loop}
              onRange={range => { playback.stop(); setSession({ range }); }} onLoop={loop => { playback.stop(); setSession({ loop }); }}
              onPlay={() => void playback.toggle(range, loop)} onSave={() => {
                if (!range || (project.ranges?.length ?? 0) >= 100) return;
                replaceProject({ ...project, ranges: [...(project.ranges ?? []), { ...range, id: createId('audio-range'), name: `Диапазон ${(project.ranges?.length ?? 0) + 1}` }] });
              }} />
            <AudioEditorTimeline
              key={project.id}
              project={project}
              range={range} onRangeChange={range => { playback.stop(); setSession({ range }); }}
              onDropFiles={(files, laneId, positionMs) => void importer.importFiles(files, laneId, positionMs)}
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
              onToggleMute={(laneId) => replaceProject({ ...project, lanes: project.lanes.map((lane) => lane.id === laneId ? { ...lane, muted: !lane.muted, solo: false } : lane) })}
              onRenameLane={(laneId, name) => replaceProject({ ...project, lanes: project.lanes.map((lane) => lane.id === laneId ? { ...lane, name: name || 'Дорожка' } : lane) })}
              onRemoveLane={removeLane}
              onZoomChange={setZoom}
              onRemoveMarker={removeMarker}
            />

            {activeClip && (
              <AudioEditorClipInspector
                key={activeClip.clip.id}
                project={project}
                clip={activeClip.clip}
                laneId={activeClip.lane.id}
                sourceName={trackById.get(activeClip.clip.sourceTrackId)?.name ?? 'Исходник удалён'}
                sourceDurationMs={sourceDurations[activeClip.clip.sourceTrackId]}
                playheadMs={playback.playheadMs}
                selectedCount={selectedClipIds.length}
                onPatch={patchActiveClip}
                onBeginGain={beginGain} onCommitGain={commitGain}
                onMoveLane={moveSelectionToLane}
                onSplit={splitActiveClip}
                onDuplicate={duplicateSelection}
                onDelete={deleteSelection}
              />
            )}

            <EditorMixPanel key={`mix-${project.id}`} project={project} tracks={mediaTracks} assets={audioAssets} levels={playback.levels}
              onChange={(next, preview) => replaceProject(next, { recordHistory: !preview })} onBegin={beginGain} onCommit={commitGain} />
            <EditorExportPanel key={`export-${project.id}`} project={project} tracks={mediaTracks} assets={audioAssets} range={range}
              onSelectRange={range => { playback.stop(); setSession({ range }); }} onChange={replaceProject} />
          </section>
        </div>
      )}
    </main>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function formatMs(ms: number) {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0')}`;
}
