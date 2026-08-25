import type { PlayableQuestion, Team } from '../model/types';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { AudioTimeline } from './AudioTimeline';
import { useAudioPlayer } from '../hooks/useAudioPlayer';

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
  onUnlock,
  onNobodyGuessed,
  onBack,
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
  onUnlock: (teamId: string) => void;
  onNobodyGuessed: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const plusMode = answerRevealed;
  const asset = plusMode ? question.plus : question.minus;
  const awardedTeam = teams.find((team) => team.id === awardedTeamId);
  const invalidAsset = Boolean(asset && !(asset.blob instanceof Blob));
  const source = useObjectUrl(invalidAsset ? undefined : asset?.blob);
  const player = useAudioPlayer({
    source,
    autoPlay: Boolean(source),
    playErrorMessage: 'Не удалось запустить аудио. Проверьте формат файла или загрузите трек заново.',
    mediaErrorMessage: 'Браузер не смог прочитать этот аудиофайл. Попробуйте MP3, WAV или OGG.',
  });
  const playbackError = invalidAsset
    ? 'Аудиофайл повреждён. Загрузите его заново в настройках.'
    : player.error;


  return (
    <main className="question-screen page-shell">
      <div className="game-step-navigation">
        <button className="text-button game-back-button" onClick={onBack}>← Вернуться на предыдущий этап</button>
      </div>
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
            <audio ref={player.audioRef} src={source} preload="auto" />
            <div className="player-controls">
              <button
                className="play-button"
                onClick={() => void player.toggle()}
                aria-label={player.playing ? 'Пауза' : 'Запустить песню'}
              >
                {player.playing ? 'Ⅱ' : '▶'}
              </button>
              <AudioTimeline
                progress={player.currentTime}
                duration={player.duration}
                onSeek={player.seek}
              />
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
                    {(excluded || answeredIncorrectly || penalizedNext) && (
                      <button
                        type="button"
                        className="team-unlock-button"
                        onClick={() => onUnlock(team.id)}
                      >
                        Разблокировать
                      </button>
                    )}
                  </div>

                  <button
                    className="answer-button answer-button--correct"
                    disabled={cannotAnswer}
                    onClick={() => {
                      player.pause();
                      onAward(team.id);
                    }}
                  >
                    ✓ Верно <b>+{question.points}</b>
                  </button>

                  <button
                    className={answeredIncorrectly ? 'answer-button answer-button--wrong answer-button--active' : 'answer-button answer-button--wrong'}
                    disabled={cannotAnswer}
                    onClick={() => {
                      player.pause();
                      onIncorrect(team.id);
                    }}
                  >
                    {answeredIncorrectly ? '✕ Уже отвечала' : '✕ Неверно'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="question-resolution-actions">
            <button
              className="secondary-button nobody-button"
              onClick={() => {
                player.pause();
                onNobodyGuessed();
              }}
            >
              Никто не угадал — показать ответ
            </button>

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
