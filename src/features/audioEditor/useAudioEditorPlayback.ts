import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioAsset, AudioProject, AudioTimeRange, MediaTrack } from '../../model/types';
import { AUDIO_EDITOR_MAX_PROJECT_MS, getProjectDurationMs } from './audioProject';
import { playAudioProject, playbackStructure, type AudioProjectPlayback, type MixLevels } from './audioEngine';
import { persistedStateImported, $stateReplacementPending } from '../../model/app/storage';
import { $editorSessions, editorSessionChanged } from './editorSession';

export function useAudioEditorPlayback({ project, mediaTracks, audioAssets, onError }: {
  project: AudioProject | null; mediaTracks: readonly MediaTrack[]; audioAssets: readonly AudioAsset[]; onError: (error: unknown) => void;
}) {
  const projectIdRef = useRef(project?.id);
  const [playheadMs, setPlayheadMs] = useState(() => project ? $editorSessions.getState()[project.id]?.playheadMs ?? 0 : 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [levels, setLevels] = useState<MixLevels>({ left: 0, right: 0 });
  const requestRef = useRef(0);
  const startingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const playbackRef = useRef<AudioProjectPlayback | null>(null);
  const animationRef = useRef<number | null>(null);
  const durationMs = project ? getProjectDurationMs(project) : 0;
  const position = useCallback((value: number) => {
    setPlayheadMs(value);
    if (projectIdRef.current) editorSessionChanged({ id: projectIdRef.current, patch: { playheadMs: value } });
  }, []);
  const stop = useCallback((keepCurrentPosition = true) => {
    requestRef.current += 1;
    startingRef.current = false;
    setIsStarting(false);
    const handle = playbackRef.current;
    if (keepCurrentPosition && handle?.position) position(handle.position());
    abortRef.current?.abort();
    abortRef.current = null;
    handle?.stop();
    playbackRef.current = null;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setIsPlaying(false);
    setLevels({ left: 0, right: 0 });
  }, [position]);
  const toggle = useCallback(async (range?: AudioTimeRange | null, loop = false) => {
    if (!project || (!range && durationMs <= 0)) return;
    if (startingRef.current || playbackRef.current) { stop(); return; }
    const start = range?.startMs ?? (playheadMs >= durationMs - 20 ? 0 : playheadMs);
    const request = ++requestRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    startingRef.current = true;
    setIsStarting(true);
    try {
      const handle = await playAudioProject(project, mediaTracks, audioAssets, start, { range, loop, signal: controller.signal });
      if (request !== requestRef.current) { handle.stop(); return; }
      playbackRef.current = handle;
      setIsPlaying(true);
      position(start);
      const tick = () => {
        if (request !== requestRef.current) return;
        if (handle.position) position(handle.position());
        if (handle.ended?.()) { stop(false); return; }
        if (handle.levels) setLevels(handle.levels());
        animationRef.current = requestAnimationFrame(tick);
      };
      animationRef.current = requestAnimationFrame(tick);
    } catch (error) {
      if (request === requestRef.current) onError(error);
    } finally {
      if (request === requestRef.current) { startingRef.current = false; setIsStarting(false); }
    }
  }, [audioAssets, durationMs, mediaTracks, onError, playheadMs, position, project, stop]);
  const seek = useCallback((positionMs: number) => {
    stop();
    position(Math.max(0, Math.min(AUDIO_EDITOR_MAX_PROJECT_MS, Math.round(positionMs))));
  }, [stop, position]);
  const reset = useCallback(() => { stop(false); position(0); }, [stop, position]);
  const previousRef = useRef({ project, mediaTracks, audioAssets });
  useEffect(() => {
    const previous = previousRef.current;
    const switched = projectIdRef.current !== project?.id;
    if (switched || previous.mediaTracks !== mediaTracks || previous.audioAssets !== audioAssets
      || playbackStructure(previous.project) !== playbackStructure(project) || (startingRef.current && previous.project !== project)) stop();
    else if (project) playbackRef.current?.updateMix?.(project);
    if (switched) {
      projectIdRef.current = project?.id;
      setPlayheadMs(project ? $editorSessions.getState()[project.id]?.playheadMs ?? 0 : 0);
    }
    previousRef.current = { project, mediaTracks, audioAssets };
  }, [project, mediaTracks, audioAssets, stop]);
  useEffect(() => {
    const imported = persistedStateImported.watch(() => { stop(false); setPlayheadMs(0); });
    const pending = $stateReplacementPending.watch(value => { if (value) stop(); });
    return () => { imported(); pending(); stop(); };
  }, [stop]);
  return { playheadMs, isPlaying, isStarting, durationMs, levels, toggle, stop, seek, reset };
}
