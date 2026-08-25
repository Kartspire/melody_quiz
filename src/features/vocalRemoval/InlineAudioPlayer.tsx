import { AudioTimeline } from '../../components/AudioTimeline';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
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
  const hasRange = range !== undefined;
  const rangeStart = range?.start ?? 0;
  const rangeEnd = range?.end;
  const player = useAudioPlayer({
    source,
    startAt: rangeStart,
    stopAt: rangeEnd,
    disabled,
    resetOnRangeChange: hasRange,
    rangeEndBehavior: 'reset',
    onDuration,
    playErrorMessage: 'Не удалось воспроизвести аудиофрагмент.',
    mediaErrorMessage: 'Браузер не смог прочитать аудиофайл.',
  });
  const visibleDuration = hasRange
    ? Math.max(0, (rangeEnd ?? rangeStart) - rangeStart)
    : player.duration;
  const visibleProgress = hasRange
    ? Math.max(0, player.currentTime - rangeStart)
    : player.currentTime;

  return (
    <div className="vocal-inline-player">
      <audio ref={player.audioRef} src={source} preload="metadata" />
      <button
        className="play-button vocal-inline-player__button"
        onClick={() => void player.toggle()}
        disabled={disabled}
        aria-label={player.playing ? `Пауза: ${label}` : `Воспроизвести: ${label}`}
      >
        {player.playing ? 'Ⅱ' : '▶'}
      </button>
      <AudioTimeline
        progress={visibleProgress}
        duration={visibleDuration}
        disabled={disabled}
        onSeek={(time) => {
          if (disabled) return;
          const absoluteTime = hasRange
            ? clampNumber(rangeStart + time, rangeStart, rangeEnd ?? rangeStart)
            : time;
          player.seek(absoluteTime);
        }}
      />
    </div>
  );
}
