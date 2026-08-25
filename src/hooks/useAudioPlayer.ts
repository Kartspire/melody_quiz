import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const RANGE_END_EPSILON_SECONDS = 0.015;
const MEDIA_END_EPSILON_SECONDS = 0.05;

export type AudioRangeEndBehavior = 'pause' | 'reset';

export interface UseAudioPlayerOptions {
  source?: string | null;
  autoPlay?: boolean;
  startAt?: number;
  stopAt?: number;
  disabled?: boolean;
  resetOnRangeChange?: boolean;
  rangeEndBehavior?: AudioRangeEndBehavior;
  onEnded?: () => void;
  onRangeEnd?: () => void;
  onDuration?: (duration: number) => void;
  playErrorMessage?: string;
  mediaErrorMessage?: string;
}

export interface AudioPlayerController {
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  play: () => Promise<boolean>;
  pause: () => void;
  toggle: () => Promise<boolean>;
  seek: (time: number) => number;
  clearError: () => void;
}

export function useAudioPlayer({
  source,
  autoPlay = false,
  startAt = 0,
  stopAt,
  disabled = false,
  resetOnRangeChange = false,
  rangeEndBehavior = 'pause',
  onEnded,
  onRangeEnd,
  onDuration,
  playErrorMessage = 'Не удалось запустить аудио.',
  mediaErrorMessage = 'Браузер не смог прочитать этот аудиофайл.',
}: UseAudioPlayerOptions): AudioPlayerController {
  const audioRef = useRef<HTMLAudioElement>(null);
  const frameRef = useRef<number | null>(null);
  const sourceRef = useRef(source);
  const startAtRef = useRef(normalizeTime(startAt));
  const stopAtRef = useRef(normalizeOptionalTime(stopAt));
  const disabledRef = useRef(disabled);
  const rangeEndBehaviorRef = useRef(rangeEndBehavior);
  const onEndedRef = useRef(onEnded);
  const onRangeEndRef = useRef(onRangeEnd);
  const onDurationRef = useRef(onDuration);
  const playErrorMessageRef = useRef(playErrorMessage);
  const mediaErrorMessageRef = useRef(mediaErrorMessage);
  const rangeReachedRef = useRef(false);
  const lastDurationRef = useRef(0);
  const pendingInitialSeekRef = useRef(true);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(normalizeTime(startAt));
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  sourceRef.current = source;
  startAtRef.current = normalizeTime(startAt);
  stopAtRef.current = normalizeOptionalTime(stopAt);
  disabledRef.current = disabled;
  rangeEndBehaviorRef.current = rangeEndBehavior;
  onEndedRef.current = onEnded;
  onRangeEndRef.current = onRangeEnd;
  onDurationRef.current = onDuration;
  playErrorMessageRef.current = playErrorMessage;
  mediaErrorMessageRef.current = mediaErrorMessage;

  const stopRangeMonitor = useCallback(() => {
    if (frameRef.current !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    stopRangeMonitor();
  }, [stopRangeMonitor]);

  const clearError = useCallback(() => setError(null), []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    const safeTime = clampPlaybackTime(time, audio?.duration, startAtRef.current, stopAtRef.current);
    if (audio) {
      try {
        audio.currentTime = safeTime;
      } catch {
        // Some browsers reject seeks until metadata is available. State still reflects
        // the requested position and loadedmetadata will make future seeks valid.
      }
    }
    if (stopAtRef.current === undefined || safeTime < stopAtRef.current - RANGE_END_EPSILON_SECONDS) {
      rangeReachedRef.current = false;
    }
    setCurrentTime(safeTime);
    return safeTime;
  }, []);

  const finishRange = useCallback((audio: HTMLAudioElement) => {
    const stopAtValue = stopAtRef.current;
    if (stopAtValue === undefined || rangeReachedRef.current) return false;
    if (audio.currentTime < stopAtValue - RANGE_END_EPSILON_SECONDS) return false;

    rangeReachedRef.current = true;
    audio.pause();
    setPlaying(false);
    stopRangeMonitor();

    const target = rangeEndBehaviorRef.current === 'reset'
      ? startAtRef.current
      : clampPlaybackTime(stopAtValue, audio.duration, startAtRef.current, stopAtValue);
    try {
      audio.currentTime = target;
    } catch {
      // Ignore seek errors while the media element is transitioning between states.
    }
    setCurrentTime(target);
    onRangeEndRef.current?.();
    return true;
  }, [stopRangeMonitor]);

  const startRangeMonitor = useCallback(() => {
    stopRangeMonitor();
    if (stopAtRef.current === undefined) return;

    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused || finishRange(audio)) {
        frameRef.current = null;
        return;
      }
      if (typeof requestAnimationFrame === 'function') frameRef.current = requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame === 'function') frameRef.current = requestAnimationFrame(tick);
  }, [finishRange, stopRangeMonitor]);

  const startPlayback = useCallback(async (reportError: boolean) => {
    const audio = audioRef.current;
    if (!audio || !sourceRef.current || disabledRef.current) return false;

    const effectiveEnd = stopAtRef.current ?? (Number.isFinite(audio.duration) ? audio.duration : undefined);
    if (effectiveEnd !== undefined && audio.currentTime >= effectiveEnd - MEDIA_END_EPSILON_SECONDS) {
      seek(startAtRef.current);
    }
    rangeReachedRef.current = false;

    try {
      await audio.play();
      setPlaying(true);
      setError(null);
      if (stopAtRef.current !== undefined) startRangeMonitor();
      return true;
    } catch (playbackError) {
      setPlaying(false);
      if (reportError) {
        console.error('Audio playback failed', playbackError);
        setError(playErrorMessageRef.current);
      }
      return false;
    }
  }, [seek, startRangeMonitor]);

  const play = useCallback(() => startPlayback(true), [startPlayback]);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || disabledRef.current) return false;
    if (audio.paused) return play();
    pause();
    return false;
  }, [pause, play]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const handlePlay = () => {
      setPlaying(true);
      setError(null);
      if (stopAtRef.current !== undefined) startRangeMonitor();
    };
    const handlePause = () => {
      setPlaying(false);
      stopRangeMonitor();
    };
    const handleDuration = () => {
      const nextDuration = normalizeDuration(audio.duration);
      if (pendingInitialSeekRef.current && nextDuration > 0) {
        const initialTime = clampPlaybackTime(
          startAtRef.current,
          nextDuration,
          startAtRef.current,
          stopAtRef.current,
        );
        try {
          audio.currentTime = initialTime;
        } catch {
          // A few engines may still reject an immediate metadata seek; timeupdate will
          // synchronize state once playback starts.
        }
        setCurrentTime(initialTime);
        pendingInitialSeekRef.current = false;
      }
      if (nextDuration === lastDurationRef.current) return;
      lastDurationRef.current = nextDuration;
      setDuration(nextDuration);
      if (nextDuration > 0) onDurationRef.current?.(nextDuration);
    };
    const handleTimeUpdate = () => {
      if (finishRange(audio)) return;
      setCurrentTime(normalizeTime(audio.currentTime));
    };
    const handleEnded = () => {
      setPlaying(false);
      stopRangeMonitor();
      if (stopAtRef.current !== undefined) {
        rangeReachedRef.current = false;
        const target = rangeEndBehaviorRef.current === 'reset'
          ? startAtRef.current
          : clampPlaybackTime(audio.duration, audio.duration, startAtRef.current, stopAtRef.current);
        try {
          audio.currentTime = target;
        } catch {
          // Ignore seek errors while the browser finalizes the ended state.
        }
        setCurrentTime(target);
        onRangeEndRef.current?.();
        return;
      }
      setCurrentTime(normalizeDuration(audio.duration));
      onEndedRef.current?.();
    };
    const handleError = () => {
      if (!sourceRef.current) return;
      setPlaying(false);
      stopRangeMonitor();
      setError(mediaErrorMessageRef.current);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('loadedmetadata', handleDuration);
    audio.addEventListener('durationchange', handleDuration);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('loadedmetadata', handleDuration);
      audio.removeEventListener('durationchange', handleDuration);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.pause();
      stopRangeMonitor();
    };
  }, [finishRange, source, startRangeMonitor, stopRangeMonitor]);

  useEffect(() => {
    const audio = audioRef.current;
    rangeReachedRef.current = false;
    lastDurationRef.current = 0;
    pendingInitialSeekRef.current = true;
    stopRangeMonitor();
    setPlaying(false);
    setDuration(0);
    setError(null);
    setCurrentTime(startAtRef.current);
    if (!audio) return;

    audio.pause();
    try {
      audio.currentTime = startAtRef.current;
    } catch {
      // Seeking before metadata is optional; loaded metadata will make the value usable.
    }
    audio.load();
  }, [source, stopRangeMonitor]);

  useEffect(() => {
    if (!resetOnRangeChange) return;
    const audio = audioRef.current;
    pause();
    rangeReachedRef.current = false;
    pendingInitialSeekRef.current = !audio || audio.readyState < 1;
    seek(startAtRef.current);
  }, [pause, resetOnRangeChange, seek, startAt, stopAt]);

  useEffect(() => {
    if (!disabled) return;
    pause();
  }, [disabled, pause]);

  useEffect(() => {
    if (!autoPlay || !source || disabled) return;
    seek(startAtRef.current);
    void startPlayback(false);
  }, [autoPlay, disabled, seek, source, startPlayback]);

  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    stopRangeMonitor();
  }, [stopRangeMonitor]);

  return {
    audioRef,
    playing,
    currentTime,
    duration,
    error,
    play,
    pause,
    toggle,
    seek,
    clearError,
  };
}

function normalizeTime(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeOptionalTime(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function normalizeDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clampPlaybackTime(
  value: number,
  duration: number | undefined,
  startAt: number,
  stopAt: number | undefined,
) {
  const safeValue = normalizeTime(value);
  const safeDuration = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : undefined;
  const lowerBound = safeDuration === undefined ? startAt : Math.min(startAt, safeDuration);
  const rawUpperBound = Math.min(
    stopAt ?? Number.POSITIVE_INFINITY,
    safeDuration ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(rawUpperBound)) return Math.max(lowerBound, safeValue);
  const upperBound = Math.max(lowerBound, rawUpperBound);
  return Math.min(Math.max(lowerBound, safeValue), upperBound);
}
