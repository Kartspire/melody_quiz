export function AudioTimeline({
  progress,
  duration,
  onSeek,
  className = '',
}: {
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
  className?: string;
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeProgress = Number.isFinite(progress) && progress > 0
    ? Math.min(progress, safeDuration || progress)
    : 0;

  return (
    <div className={['timeline-wrap', className].filter(Boolean).join(' ')}>
      <input
        className="timeline"
        type="range"
        aria-label="Позиция воспроизведения"
        min={0}
        max={safeDuration}
        step={0.1}
        value={safeDuration ? Math.min(safeProgress, safeDuration) : 0}
        disabled={!safeDuration}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <div className="time-row">
        <span>{formatTime(safeProgress)}</span>
        <span>{formatTime(safeDuration)}</span>
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
