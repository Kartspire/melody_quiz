import { useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeGame,
  $activeStage,
  $session,
  teamNextAnswerBlockToggled,
  teamScoreChanged,
} from '../model/game';
import { GAME_POINTS_STEP } from '../model/limits';
import { DraftNumberInput } from './DraftNumberInput';

export function Scoreboard() {
  const [config, session, activeStage] = useUnit([$activeGame, $session, $activeStage]);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

  if (!config || !session) return null;

  return (
    <section className="scoreboard" aria-label="Счёт команд">
      {config.teams.map((team) => {
        const score = session.scores[team.id] ?? 0;
        const editing = editingTeamId === team.id;
        const selecting = activeStage?.kind === 'round' && session.selectingTeamId === team.id;
        const nextAnswerBlocked = session.nextExcludedTeamIds.includes(team.id);
        const currentlyBlocked = session.activeExcludedTeamIds.includes(team.id)
          || session.currentIncorrectTeamIds.includes(team.id);
        const className = [
          'team-score',
          editing ? 'team-score--editing' : '',
          selecting ? 'team-score--selecting' : '',
        ].filter(Boolean).join(' ');

        return (
          <article className={className} key={team.id} style={{ '--team-color': team.color } as React.CSSProperties}>
            <div className="team-score__identity">
              <span className="team-dot" />
              <span className="team-score__name">{team.name || 'Без названия'}</span>
            </div>
            {selecting && <div className="team-score__selector-label">Выбирает следующую песню</div>}
            {editing ? (
              <div className="score-editor">
                <div className="score-editor__points">
                  <button onClick={() => teamScoreChanged({ teamId: team.id, score: score - GAME_POINTS_STEP })}>{`−${GAME_POINTS_STEP}`}</button>
                  <DraftNumberInput
                    ariaLabel={`Баллы ${team.name}`}
                    value={score}
                    onCommit={(nextScore) => teamScoreChanged({ teamId: team.id, score: nextScore })}
                  />
                  <button onClick={() => teamScoreChanged({ teamId: team.id, score: score + GAME_POINTS_STEP })}>{`+${GAME_POINTS_STEP}`}</button>
                  <button className="icon-button" onClick={() => setEditingTeamId(null)} title="Готово">✓</button>
                </div>
                {activeStage?.kind === 'round' && (
                  <button
                    type="button"
                    className={nextAnswerBlocked ? 'score-next-block score-next-block--active' : 'score-next-block'}
                    onClick={() => teamNextAnswerBlockToggled(team.id)}
                  >
                    {nextAnswerBlocked ? 'Снять блок со следующего ответа' : 'Блокировать следующий ответ'}
                  </button>
                )}
                {currentlyBlocked && <small className="score-editor__status">Сейчас команда не может отвечать</small>}
              </div>
            ) : (
              <button className="score-value" onClick={() => setEditingTeamId(team.id)} title="Изменить баллы вручную">{score}</button>
            )}
          </article>
        );
      })}
    </section>
  );
}
