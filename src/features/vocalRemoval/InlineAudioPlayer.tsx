import { useEffect, useRef, useState } from 'react';
import { AudioTimeline } from '../../components/AudioTimeline';
import type { TrimRange } from './audioClip';
import { clampNumber } from './audioTime';

export function InlineAudioPlayer({
  source,
  label,
  range,
  onDuration,
  disabled = false,
}: {
  source: string;
  label: string;
  range?: TrimRange;
  onDuration?: (duration: number) => void;
  disabled?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const frameRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(range?.start ?? 0);
  const [duration, setDuration] = useState(0);
  const hasRange = range !== undefined;
  const rangeStart = range?.start ?? 0;
  const rangeEnd = range?.end ?? duration;
  const visibleDuration = hasRange ? Math.max(0, rangeEnd - rangeStart) : duration;
  const visibleProgress = hasRange ? Math.max(0, progress - rangeStart) : progress;

  // Reload the media element only when the actual source changes. Duration is state
  // derived from loadedmetadata and must never participate in this lifecycle: doing so
  // creates a duration -> load() -> loadedmetadata loop for full-track previews.
  useEffect(() => {
    const audio = audioRef.current;
    setPlaying(false);
    setProgress(rangeStart);
    setDuration(0);

    if (!audio) return;
    audio.pause();
    audio.currentTime = rangeStart;
    audio.load();
  }, [source]);

  // Moving trim markers only seeks the already loaded media. Re-running load() here is
  // expensive and used to make dragging a marker restart the media metadata pipeline.
  useEffect(() => {
    if (!hasRange) return;
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.currentTime = rangeStart;
    setPlaying(false);
    setProgress(rangeStart);
  }, [hasRange, rangeEnd, rangeStart]);

  useEffect(() => {
    if (!disabled) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
  }, [disabled]);

  useEffect(() => {
    if (!playing || !hasRange) return undefined;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.currentTime >= rangeEnd - 0.015) {
        audio.pause();
        audio.currentTime = rangeStart;
        setProgress(rangeStart);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [hasRange, playing, rangeEnd, rangeStart]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || disabled) return;
    if (audio.paused) {
      if (hasRange && (audio.currentTime < rangeStart || audio.currentTime >= rangeEnd - 0.015)) {
        audio.currentTime = rangeStart;
        setProgress(rangeStart);
      }
      try {
        await audio.play();
      } catch (error) {
        console.error('Audio preview failed', error);
        setPlaying(false);
      }
    } else {
      audio.pause();
    }
  };

  return (
    <div className="vocal-inline-player">
      <audio
        ref={audioRef}
        src={source}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          if (hasRange && audioRef.current) {
            audioRef.current.currentTime = rangeStart;
            setProgress(rangeStart);
          }
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;
          setDuration(nextDuration);
          onDuration?.(nextDuration);
          if (hasRange) {
            const nextPosition = clampNumber(rangeStart, 0, nextDuration);
            event.currentTarget.currentTime = nextPosition;
            setProgress(nextPosition);
          }
        }}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
      />
      <button
        className="play-button vocal-inline-player__button"
        onClick={() => void toggle()}
        disabled={disabled}
        aria-label={playing ? `Пауза: ${label}` : `Воспроизвести: ${label}`}
      >
        {playing ? 'Ⅱ' : '▶'}
      </button>
      <AudioTimeline
        progress={visibleProgress}
        duration={visibleDuration}
        disabled={disabled}
        onSeek={(time) => {
          if (disabled) return;
          const absoluteTime = hasRange
            ? clampNumber(rangeStart + time, rangeStart, rangeEnd)
            : time;
          if (audioRef.current) audioRef.current.currentTime = absoluteTime;
          setProgress(absoluteTime);
        }}
      />
    </div>
  );
}
