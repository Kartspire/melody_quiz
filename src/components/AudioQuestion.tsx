import { useEffect, useRef, useState } from 'react';
import type { PlayableQuestion, Team } from '../model/types';
import { useObjectUrl } from '../hooks/useObjectUrl';

export function AudioQuestion({
  question,
  roundName,
  teams,
  awardedTeamId,
  answerRevealed,
  excludedTeamIds,
  currentIncorrectTeamIds,
  nextExcludedTeamIds,
  onAward,
  onIncorrect,
  onNobodyGuessed,
  onClose,
}: {
  question: PlayableQuestion;
  roundName: string;
  teams: Team[];
  awardedTeamId: string | null;
  answerRevealed: boolean;
  excludedTeamIds: string[];
  currentIncorrectTeamIds: string[];
  nextExcludedTeamIds: string[];
  onAward: (teamId: string) => void;
  onIncorrect: (teamId: string) => void;
  onNobodyGuessed: () => void;
  onClose: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const plusMode = answerRevealed;
  const asset = plusMode ? question.plus : question.minus;
  const awardedTeam = teams.find((team) => team.id === awardedTeamId);
  const invalidAsset = Boolean(asset && !(asset.blob instanceof Blob));
  const source = useObjectUrl(invalidAsset ? undefined : asset?.blob);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setDuration(0);
    setPlaybackError(invalidAsset ? 'Аудиофайл повреждён. Загрузите его заново в настройках.' : null);
  }, [asset, invalidAsset]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;

    audio.currentTime = 0;
    audio.load();

    void audio
      .play()
      .then(() => {
        setPlaying(true);
        setPlaybackError(null);
      })
      .catch(() => {
        setPlaying(false);
      });
  }, [source]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !source) return;

    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
        setPlaybackError(null);
      } catch (error) {
        console.error('Audio playback failed', error);
        setPlaying(false);
        setPlaybackError('Не удалось запустить аудио. Проверьте формат файла или загрузите трек заново.');
      }
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
        <h1>{plusMode ? `${question.song?.artist || 'Без исполнителя'} — ${question.song?.title || 'Без названия'}` : 'Что это за песня?'}</h1>
        {plusMode && (
          <p className="question-result">
            {awardedTeam ? `Угадала команда «${awardedTeam.name}»` : 'Ни одна команда не угадала'}
          </p>
        )}
        {!asset && plusMode && <p className="missing-audio">Для этой песни не загружен «плюс».</p>}
        {!asset && !plusMode && <p className="missing-audio">Для этой песни не загружен «минус».</p>}
        {playbackError && <p className="missing-audio" role="alert">{playbackError}</p>}

        {source && (
          <>
            <audio
              ref={audioRef}
              src={source}
              preload="auto"
              onPlay={() => {
                setPlaying(true);
                setPlaybackError(null);
              }}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
              onError={() => {
                setPlaying(false);
                setPlaybackError('Браузер не смог прочитать этот аудиофайл. Попробуйте MP3, WAV или OGG.');
              }}
            />
            <div className="player-controls">
              <button
                className="play-button"
                onClick={() => void togglePlayback()}
                aria-label={playing ? 'Пауза' : 'Запустить песню'}
              >
                {playing ? 'Ⅱ' : '▶'}
              </button>
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
          <span className="award-label">Результат ответа команды</span>
          <div className="answer-team-list">
            {teams.map((team) => {
              const excluded = excludedTeamIds.includes(team.id);
              const answeredIncorrectly = currentIncorrectTeamIds.includes(team.id);
              const penalizedNext = nextExcludedTeamIds.includes(team.id);
              const cannotAnswer = excluded || answeredIncorrectly;

              return (
                <div
                  key={team.id}
                  className={cannotAnswer ? 'answer-team-row answer-team-row--excluded' : 'answer-team-row'}
                  style={{ '--team-color': team.color } as React.CSSProperties}
                >
                  <div className="answer-team-row__identity">
                    <span className="team-dot" />
                    <strong>{team.name}</strong>
                    {excluded && <small>Пропускает эту песню</small>}
                    {!excluded && answeredIncorrectly && <small>Ответ неверный · больше не отвечает в этой песне · пропустит следующую</small>}
                    {!excluded && !answeredIncorrectly && penalizedNext && <small>Пропустит следующую песню</small>}
                  </div>

                  <button
                    className="answer-button answer-button--correct"
                    disabled={cannotAnswer}
                    onClick={() => {
                      audioRef.current?.pause();
                      onAward(team.id);
                    }}
                  >
                    ✓ Верно <b>+{question.points}</b>
                  </button>

                  <button
                    className={penalizedNext ? 'answer-button answer-button--wrong answer-button--active' : 'answer-button answer-button--wrong'}
                    disabled={excluded}
                    onClick={() => {
                      audioRef.current?.pause();
                      onIncorrect(team.id);
                    }}
                  >
                    {penalizedNext ? '↶ Отменить ошибку' : '✕ Неверно'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="question-resolution-actions">
            <button
              className="secondary-button nobody-button"
              onClick={() => {
                audioRef.current?.pause();
                onNobodyGuessed();
              }}
            >
              Никто не угадал — показать ответ
            </button>
            <button className="text-button" onClick={onClose}>← Вернуться без завершения вопроса</button>
          </div>
        </section>
      ) : (
        <div className="answer-actions">
          <button className="primary-button primary-button--large" onClick={onClose}>Закрыть песню →</button>
        </div>
      )}
    </main>
  );
}
