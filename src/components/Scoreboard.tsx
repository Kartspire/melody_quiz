import { useState } from 'react';
import { useUnit } from 'effector-react';
import { $activeGame, $session, teamScoreChanged } from '../model/game';
import { DraftNumberInput } from './DraftNumberInput';

export function Scoreboard() {
  const [config, session] = useUnit([$activeGame, $session]);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

  if (!config || !session) return null;

  return (
    <section className="scoreboard" aria-label="Счёт команд">
      {config.teams.map((team) => {
        const score = session.scores[team.id] ?? 0;
        const editing = editingTeamId === team.id;

        return (
          <article className="team-score" key={team.id} style={{ '--team-color': team.color } as React.CSSProperties}>
            <div className="team-score__identity">
              <span className="team-dot" />
              <span className="team-score__name">{team.name || 'Без названия'}</span>
            </div>
            {editing ? (
              <div className="score-editor">
                <button onClick={() => teamScoreChanged({ teamId: team.id, score: score - 100 })}>−100</button>
                <DraftNumberInput
                  ariaLabel={`Баллы ${team.name}`}
                  value={score}
                  onCommit={(nextScore) => teamScoreChanged({ teamId: team.id, score: nextScore })}
                />
                <button onClick={() => teamScoreChanged({ teamId: team.id, score: score + 100 })}>+100</button>
                <button className="icon-button" onClick={() => setEditingTeamId(null)} title="Готово">✓</button>
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
