import { useEffect, useRef, useState } from 'react';
import { $audioAssets, $audioProjects, $mediaTracks } from '../../model/core/state';
import { captureStateWrite } from '../../model/core/writeAccess';
import { addMediaTrackFileFx } from '../../model/media';
import { getErrorMessage } from '../../lib/errors';
import { decodeAudioAsset } from './audioBuffers';
import { createAudioClip, getClipTimelineEndMs } from './audioProject';
import { insertClip } from './timelineEditing';
import { editorHistory } from './editorSession';
import { audioProjectReplaced } from './model';

export function useEditorImport(projectId?: string) {
  const generation = useRef(0);
  const running = useRef(false);
  const [progress, setProgress] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { generation.current += 1; setProgress(''); setErrors([]); return () => { generation.current += 1; }; }, [projectId]);
  const importFiles = async (files: File[], laneId: string, positionMs: number) => {
    if (!projectId || running.current || !files.length) return;
    running.current = true; setBusy(true); setErrors([]);
    const request = generation.current;
    let assertWrite: () => void;
    try { assertWrite = captureStateWrite(); }
    catch (error) { running.current = false; setBusy(false); setErrors([getErrorMessage(error, 'Импорт недоступен.')]); return; }
    const assertCurrent = () => {
      assertWrite();
      if (request !== generation.current || !$audioProjects.getState().some(p => p.id === projectId && p.lanes.some(l => l.id === laneId))) throw new Error('Импорт остановлен: проект или дорожка изменились.');
    };
    let position = positionMs;
    let added = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        assertCurrent();
        setProgress(`${i + 1} / ${files.length} · ${files[i].name}`);
        try {
          const { track } = await addMediaTrackFileFx({ blob: files[i], fileName: files[i].name, assertCurrent });
          assertCurrent();
          const asset = $audioAssets.getState().find(a => a.id === track.audioId);
          if (!asset) throw new Error('Аудиофайл не найден.');
          const buffer = await decodeAudioAsset(asset);
          assertCurrent();
          if (!$mediaTracks.getState().some(t => t.id === track.id && t.audioId === asset.id)) throw new Error('Исходник изменился во время импорта.');
          const current = $audioProjects.getState().find(p => p.id === projectId)!;
          if (current.lanes.reduce((n, l) => n + l.clips.length, 0) >= 5000) throw new Error('Достигнут предел 5000 фрагментов.');
          const clip = createAudioClip(track.id, buffer.duration * 1000, position);
          if (getClipTimelineEndMs(clip) > 6 * 60 * 60 * 1000) throw new Error('Фрагмент выходит за пределы 6 часов.');
          editorHistory.push(current);
          audioProjectReplaced({ ...insertClip(current, laneId, clip, position), updatedAt: Date.now() });
          position = getClipTimelineEndMs(clip); added += 1;
        } catch (error) {
          assertCurrent();
          setErrors(current => [...current, `${files[i].name}: ${getErrorMessage(error, 'Не удалось импортировать.')}`]);
        }
      }
      setProgress(`Добавлено фрагментов: ${added} из ${files.length}`);
    } catch (error) {
      if (request === generation.current) setErrors(current => [...current, getErrorMessage(error, 'Импорт остановлен.')]);
    } finally { running.current = false; setBusy(false); }
  };
  return { importFiles, progress, errors, busy, cancel: () => { generation.current += 1; setProgress('Импорт остановлен. Уже добавленные исходники сохранены.'); } };
}
