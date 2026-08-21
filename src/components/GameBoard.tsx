import { useUnit } from 'effector-react';
import {
  $activeGame,
  $activeQuestion,
  $activeRound,
  $audioAssets,
  $isGameFinished,
  $session,
  $songs,
  gameRestarted,
  getGameStartIssues,
  isRoundComplete,
  nextRoundRequested,
  nobodyGuessed,
  questionClosed,
  questionOpened,
  resolveQuestion,
  screenChanged,
  teamAwarded,
  teamIncorrectToggled,
} from '../model/game';
import { AudioQuestion } from './AudioQuestion';

export function GameBoard() {
  const [config, session, round, activeQuestion, finished, songs, audioAssets] = useUnit([
    $activeGame,
    $session,
    $activeRound,
    $activeQuestion,
    $isGameFinished,
    $songs,
    $audioAssets,
  ]);

  if (!config || !session) return null;

  if (finished) {
    const ranking = [...config.teams].sort((a, b) => (session.scores[b.id] ?? 0) - (session.scores[a.id] ?? 0));
    return (
      <main className="game-page game-finished page-shell">
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
        <button className="primary-button" onClick={() => {
          const issues = getGameStartIssues(config, songs, audioAssets);
          if (issues.length > 0) {
            window.alert('Игра изменилась и сейчас не готова к повторному запуску. Проверьте структуру и аудиофайлы в редакторе.');
            screenChanged('admin');
            return;
          }
          gameRestarted();
        }}>Сыграть заново</button>
      </main>
    );
  }

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
        onNobodyGuessed={() => nobodyGuessed()}
        onClose={() => {
          const completed = session.answerRevealed;
          const shouldAdvance = completed && isRoundComplete(config, session);
          questionClosed({ completed });
          if (shouldAdvance) nextRoundRequested();
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
      <div className="game-round-heading">
        <div>
          <span className="eyebrow">Раунд {session.roundIndex + 1} из {config.rounds.length}</span>
          <h1>{round.name}</h1>
        </div>
        <div className="round-progress">
          <span>{completedCount} / {questionsCount}</span>
          <div className="progress-track"><span style={{ width: `${questionsCount ? (completedCount / questionsCount) * 100 : 0}%` }} /></div>
        </div>
      </div>

      {session.nextExcludedTeamIds.length > 0 && (
        <div className="next-skip-notice">
          <strong>Следующую песню пропускают:</strong>{' '}
          {config.teams.filter((team) => session.nextExcludedTeamIds.includes(team.id)).map((team) => team.name).join(', ')}
        </div>
      )}

      {questionsCount === 0 ? (
        <div className="empty-state">
          <h2>В этом раунде пока нет песен</h2>
          <p>Добавьте категории и песни в редакторе.</p>
        </div>
      ) : (
        <div className="quiz-board" style={{ '--category-count': round.categories.length } as React.CSSProperties}>
          {round.categories.map((category) => (
            <section className="board-category" key={category.id}>
              <header>{category.name}</header>
              <div className="board-category__questions">
                {category.questions.map((question) => {
                  const completed = session.completedQuestionIds.includes(question.id);
                  const playable = resolveQuestion(question, songs, audioAssets);
                  const hasMinus = Boolean(playable.minus);
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
