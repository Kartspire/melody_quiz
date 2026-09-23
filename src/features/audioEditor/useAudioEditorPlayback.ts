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
  const [isStarting, setIsStarting] = useState(false);
  const requestRef = useRef(0);
  const startingRef = useRef(false);
  const playbackRef = useRef<AudioProjectPlayback | null>(null);
  const clockRef = useRef<{ startedAt: number; fromMs: number } | null>(null);
  const animationRef = useRef<number | null>(null);
  const durationMs = project ? getProjectDurationMs(project) : 0;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;

  const stop = useCallback((keepCurrentPosition = true) => {
    requestRef.current += 1;
    startingRef.current = false;
    setIsStarting(false);
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
    if (startingRef.current || playbackRef.current) {
      stop();
      return;
    }
    const start = playheadMs >= durationMs - 20 ? 0 : playheadMs;
    const request = ++requestRef.current;
    startingRef.current = true;
    setIsStarting(true);
    try {
      const handle = await playAudioProject(project, mediaTracks, audioAssets, start);
      if (request !== requestRef.current) {
        handle.stop();
        return;
      }
      playbackRef.current = handle;
      clockRef.current = { startedAt: performance.now(), fromMs: start };
      setIsPlaying(true);
      setPlayheadMs(start);
      animate(durationMs);
    } catch (error) {
      if (request === requestRef.current) onError(error);
    } finally {
      if (request === requestRef.current) {
        startingRef.current = false;
        setIsStarting(false);
      }
    }
  }, [animate, audioAssets, durationMs, mediaTracks, onError, playheadMs, project, stop]);

  const seek = useCallback((positionMs: number) => {
    stop();
    setPlayheadMs(Math.max(0, Math.min(AUDIO_EDITOR_MAX_PROJECT_MS, Math.round(positionMs))));
  }, [stop]);

  const reset = useCallback(() => {
    stop(false);
    setPlayheadMs(0);
  }, [stop]);

  useEffect(() => {
    stop();
    // Invalidate both pending decoding and the graph when its inputs change.
  }, [project, mediaTracks, audioAssets, stop]);

  useEffect(() => () => stop(false), [stop]);

  return { playheadMs, isPlaying, isStarting, durationMs, toggle, stop, seek, reset };
}
