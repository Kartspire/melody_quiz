import { useEffect, useRef, useState } from 'react';
import { AudioTimeline } from '../../components/AudioTimeline';
import type { TrimRange } from './audioClip';
import { clampNumber } from './audioTime';

export function InlineAudioPlayer({
  source,
  label,
  range,
  onDuration,
}: {
  source: string;
  label: string;
  range?: TrimRange;
  onDuration?: (duration: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const frameRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(range?.start ?? 0);
  const [duration, setDuration] = useState(0);
  const rangeStart = range?.start ?? 0;
  const rangeEnd = range?.end ?? duration;
  const visibleDuration = range ? Math.max(0, rangeEnd - rangeStart) : duration;
  const visibleProgress = range ? Math.max(0, progress - rangeStart) : progress;

  useEffect(() => {
    setPlaying(false);
    setProgress(rangeStart);
    setDuration(0);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = rangeStart;
      audio.load();
    }
  }, [rangeStart, rangeEnd, source]);

  useEffect(() => {
    if (!playing || !range) return undefined;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.currentTime >= range.end - 0.015) {
        audio.pause();
        audio.currentTime = range.start;
        setProgress(range.start);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [playing, range]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (range && (audio.currentTime < range.start || audio.currentTime >= range.end - 0.015)) {
        audio.currentTime = range.start;
        setProgress(range.start);
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
          if (range && audioRef.current) {
            audioRef.current.currentTime = range.start;
            setProgress(range.start);
          }
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(nextDuration);
          onDuration?.(nextDuration);
          if (range) {
            event.currentTarget.currentTime = range.start;
            setProgress(range.start);
          }
        }}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
      />
      <button className="play-button vocal-inline-player__button" onClick={() => void toggle()} aria-label={playing ? `Пауза: ${label}` : `Воспроизвести: ${label}`}>
        {playing ? 'Ⅱ' : '▶'}
      </button>
      <AudioTimeline
        progress={visibleProgress}
        duration={visibleDuration}
        onSeek={(time) => {
          const absoluteTime = range ? clampNumber(range.start + time, range.start, range.end) : time;
          if (audioRef.current) audioRef.current.currentTime = absoluteTime;
          setProgress(absoluteTime);
        }}
      />
    </div>
  );
}
