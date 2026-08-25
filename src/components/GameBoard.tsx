import { useMemo } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeGame,
  $activeQuestion,
  $activeInterRound,
  $activeRound,
  $activeRoundOrdinal,
  $audioAssets,
  $canGoToPreviousStage,
  $isGameFinished,
  $mediaTracks,
  $session,
  $songs,
  gameLaunchRequested,
  isRoundComplete,
  nextStageRequested,
  previousStageRequested,
  nobodyGuessed,
  questionClosed,
  questionOpened,
  teamAwarded,
  teamIncorrectToggled,
  teamUnlocked,
} from '../model/game';
import { AudioQuestion } from './AudioQuestion';
import { InterRoundPlayer } from '../interRounds/InterRoundPlayer';

export function GameBoard() {
  const [config, session, round, roundOrdinal, interRound, activeQuestion, canGoBack, finished, songs, mediaTracks, audioAssets] = useUnit([
    $activeGame,
    $session,
    $activeRound,
    $activeRoundOrdinal,
    $activeInterRound,
    $activeQuestion,
    $canGoToPreviousStage,
    $isGameFinished,
    $songs,
    $mediaTracks,
    $audioAssets,
  ]);

  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const audioById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);

  if (!config || !session) return null;

  if (finished) {
    const ranking = [...config.teams].sort((a, b) => (session.scores[b.id] ?? 0) - (session.scores[a.id] ?? 0));
    return (
      <main className="game-page game-finished page-shell">
        {canGoBack && (
          <div className="game-step-navigation">
            <button className="text-button game-back-button" onClick={() => previousStageRequested()}>← Вернуться на предыдущий этап</button>
          </div>
        )}
        <span className="eyebrow">Игра окончена</span>
        <h1>Финальный счёт</h1>
        <div className="podium-list">
          {ranking.map((team, index) => (
            <div className="podium-row" key={team.id} style={{ '--team-color': team.color } as React.CSSProperties}>
              <span className="podium-place">{index + 1}</span>
              <span className="team-dot" />
              <strong>{team.name}</strong>
              <b>{session.scores[team.id] ?? 0}</b>
            </div>
          ))}
        </div>
        <button className="primary-button" onClick={() => gameLaunchRequested({ gameId: config.id, mode: 'restart' })}>Сыграть заново</button>
      </main>
    );
  }

  if (interRound) return <InterRoundPlayer />;

  if (activeQuestion && round) {
    return (
      <AudioQuestion
        question={activeQuestion}
        roundName={round.name}
        teams={config.teams}
        awardedTeamId={session.awardedTeamId}
        answerRevealed={session.answerRevealed}
        excludedTeamIds={session.activeExcludedTeamIds}
        currentIncorrectTeamIds={session.currentIncorrectTeamIds}
        nextExcludedTeamIds={session.nextExcludedTeamIds}
        onAward={(teamId) => teamAwarded(teamId)}
        onIncorrect={(teamId) => teamIncorrectToggled(teamId)}
        onUnlock={(teamId) => teamUnlocked(teamId)}
        onNobodyGuessed={() => nobodyGuessed()}
        onBack={() => {
          if (session.answerRevealed) previousStageRequested();
          else questionClosed({ completed: false });
        }}
        onClose={() => {
          const completed = session.answerRevealed;
          const shouldAdvance = completed && isRoundComplete(config, session);
          questionClosed({ completed, advanceStage: shouldAdvance });
        }}
      />
    );
  }

  if (!round) return null;

  const questionsCount = round.categories.reduce((sum, category) => sum + category.questions.length, 0);
  const completedCount = round.categories.reduce(
    (sum, category) => sum + category.questions.filter((question) => session.completedQuestionIds.includes(question.id)).length,
    0,
  );

  return (
    <main className="game-page page-shell">
      {canGoBack && (
        <div className="game-step-navigation">
          <button className="text-button game-back-button" onClick={() => previousStageRequested()}>← Вернуться на предыдущий этап</button>
        </div>
      )}
      <div className="game-round-heading">
        <div>
          <span className="eyebrow">Раунд {roundOrdinal} из {config.rounds.length}</span>
          <h1>{round.name}</h1>
        </div>
        <div className="round-progress">
          <span>{completedCount} / {questionsCount}</span>
          <div className="progress-track"><span style={{ width: `${questionsCount ? (completedCount / questionsCount) * 100 : 0}%` }} /></div>
        </div>
      </div>

      {session.nextExcludedTeamIds.length > 0 && (
        <div className="next-skip-notice">
          <strong>Следующую песню пропускают:</strong>
          <div className="next-skip-team-list">
            {config.teams
              .filter((team) => session.nextExcludedTeamIds.includes(team.id))
              .map((team) => (
                <span className="next-skip-team" key={team.id}>
                  <span className="team-dot" style={{ '--team-color': team.color } as React.CSSProperties} />
                  <span>{team.name}</span>
                  <button type="button" className="team-unlock-button" onClick={() => teamUnlocked(team.id)}>
                    Разблокировать
                  </button>
                </span>
              ))}
          </div>
        </div>
      )}

      {questionsCount === 0 ? (
        <div className="empty-state">
          <h2>В этом раунде пока нет песен</h2>
          <p>Добавьте категории и песни в редакторе.</p>
        </div>
      ) : completedCount === questionsCount ? (
        <div className="empty-state">
          <h2>Раунд завершён</h2>
          <p>Все вопросы этого раунда уже разыграны.</p>
          <button className="primary-button" onClick={() => nextStageRequested()}>Перейти к следующему этапу →</button>
        </div>
      ) : (
        <div className="quiz-board" style={{ '--category-count': round.categories.length } as React.CSSProperties}>
          {round.categories.map((category) => (
            <section className="board-category" key={category.id}>
              <header>{category.name}</header>
              <div className="board-category__questions">
                {category.questions.map((question) => {
                  const completed = session.completedQuestionIds.includes(question.id);
                  const song = question.songId ? songById.get(question.songId) : undefined;
                  const minusTrack = song?.minusTrackId ? trackById.get(song.minusTrackId) : undefined;
                  const hasMinus = Boolean(minusTrack && audioById.has(minusTrack.audioId));
                  return completed ? (
                    <div className="question-slot question-slot--empty" key={question.id} aria-label="Вопрос разыгран" />
                  ) : (
                    <button
                      className="question-card"
                      key={question.id}
                      onClick={() => questionOpened(question.id)}
                      disabled={!hasMinus}
                      title={hasMinus ? `Вопрос на ${question.points}` : 'Выберите песню с загруженным минусом в редакторе'}
                    >
                      {question.points}
                      {!hasMinus && <small>нет аудио</small>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
