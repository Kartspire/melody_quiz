import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioAsset, AudioProject, MediaTrack } from '../../model/types';
import { AUDIO_EDITOR_MAX_PROJECT_MS, getProjectDurationMs } from './audioProject';
import { playAudioProject, type AudioProjectPlayback } from './audioEngine';

export function useAudioEditorPlayback({
  project,
  mediaTracks,
  audioAssets,
  onError,
}: {
  project: AudioProject | null;
  mediaTracks: readonly MediaTrack[];
  audioAssets: readonly AudioAsset[];
  onError: (error: unknown) => void;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackRef = useRef<AudioProjectPlayback | null>(null);
  const clockRef = useRef<{ startedAt: number; fromMs: number } | null>(null);
  const animationRef = useRef<number | null>(null);
  const durationMs = project ? getProjectDurationMs(project) : 0;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;

  const stop = useCallback((keepCurrentPosition = true) => {
    if (keepCurrentPosition && clockRef.current) {
      const { fromMs, startedAt } = clockRef.current;
      setPlayheadMs((current) => Math.min(durationRef.current || current, fromMs + performance.now() - startedAt));
    }
    playbackRef.current?.stop();
    playbackRef.current = null;
    clockRef.current = null;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setIsPlaying(false);
  }, []);

  const animate = useCallback((projectDurationMs: number) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const tick = () => {
      const clock = clockRef.current;
      if (!clock) return;
      const next = clock.fromMs + performance.now() - clock.startedAt;
      if (next >= projectDurationMs) {
        setPlayheadMs(projectDurationMs);
        stop(false);
        return;
      }
      setPlayheadMs(next);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [stop]);

  const toggle = useCallback(async () => {
    if (!project || durationMs <= 0) return;
    if (isPlaying) {
      stop();
      return;
    }
    const start = playheadMs >= durationMs - 20 ? 0 : playheadMs;
    try {
      const handle = await playAudioProject(project, mediaTracks, audioAssets, start);
      playbackRef.current = handle;
      clockRef.current = { startedAt: performance.now(), fromMs: start };
      setIsPlaying(true);
      setPlayheadMs(start);
      animate(durationMs);
    } catch (error) {
      onError(error);
    }
  }, [animate, audioAssets, durationMs, isPlaying, mediaTracks, onError, playheadMs, project, stop]);

  const seek = useCallback((positionMs: number) => {
    if (isPlaying) stop();
    setPlayheadMs(Math.max(0, Math.min(AUDIO_EDITOR_MAX_PROJECT_MS, Math.round(positionMs))));
  }, [isPlaying, stop]);

  const reset = useCallback(() => {
    stop(false);
    setPlayheadMs(0);
  }, [stop]);

  useEffect(() => {
    if (isPlaying) stop();
    // Editing while playing changes the schedule, so stop the stale Web Audio graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.updatedAt]);

  useEffect(() => () => stop(false), [stop]);

  return { playheadMs, isPlaying, durationMs, toggle, stop, seek, reset };
}
