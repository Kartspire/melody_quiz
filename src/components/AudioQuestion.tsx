import { useEffect, useMemo, useRef, useState } from 'react';
import type { Question, Team } from '../model/types';

export function AudioQuestion({
  question,
  roundName,
  teams,
  awardedTeamId,
  onAward,
  onClose,
}: {
  question: Question;
  roundName: string;
  teams: Team[];
  awardedTeamId: string | null;
  onAward: (teamId: string) => void;
  onClose: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const plusMode = Boolean(awardedTeamId);
  const asset = plusMode ? question.plus : question.minus;
  const source = useMemo(() => (asset ? URL.createObjectURL(asset.blob) : null), [asset]);

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source);
  }, [source]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    audio.currentTime = 0;
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [source]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  };

  return (
    <main className="question-screen page-shell">
      <div className="question-meta">
        <span>{roundName}</span>
        <strong>{question.points} баллов</strong>
      </div>

      <div className={plusMode ? 'now-playing now-playing--answer' : 'now-playing'}>
        <div className="vinyl" aria-hidden="true"><div className="vinyl__label" /></div>
        <span className="eyebrow">{plusMode ? 'Правильный ответ' : 'Угадайте мелодию'}</span>
        <h1>{plusMode ? `${question.artist} — ${question.title}` : 'Что это за песня?'}</h1>
        {!asset && plusMode && <p className="missing-audio">Для этой песни не загружен «плюс».</p>}

        {source && (
          <>
            <audio
              ref={audioRef}
              src={source}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
            />
            <div className="player-controls">
              <button className="play-button" onClick={togglePlayback}>{playing ? 'Ⅱ' : '▶'}</button>
              <div className="timeline-wrap">
                <input
                  className="timeline"
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={Math.min(progress, duration || 0)}
                  onChange={(event) => {
                    const time = Number(event.target.value);
                    if (audioRef.current) audioRef.current.currentTime = time;
                    setProgress(time);
                  }}
                />
                <div className="time-row"><span>{formatTime(progress)}</span><span>{formatTime(duration)}</span></div>
              </div>
            </div>
          </>
        )}
      </div>

      {!plusMode ? (
        <section className="award-section">
          <span className="award-label">Правильный ответ дала:</span>
          <div className="award-teams">
            {teams.map((team) => (
              <button
                key={team.id}
                className="award-team"
                style={{ '--team-color': team.color } as React.CSSProperties}
                onClick={() => {
                  audioRef.current?.pause();
                  onAward(team.id);
                }}
              >
                <span className="team-dot" />
                {team.name}
                <b>+{question.points}</b>
              </button>
            ))}
          </div>
          <button className="text-button" onClick={onClose}>← Вернуться без завершения вопроса</button>
        </section>
      ) : (
        <div className="answer-actions">
          <button className="primary-button primary-button--large" onClick={onClose}>Вернуться к карточкам →</button>
        </div>
      )}
    </main>
  );
}
