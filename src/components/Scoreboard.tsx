import { useState } from 'react';
import { useUnit } from 'effector-react';
import { $config, $session, teamScoreChanged } from '../model/game';

export function Scoreboard() {
  const [config, session] = useUnit([$config, $session]);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

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
                <input
                  aria-label={`Баллы ${team.name}`}
                  type="number"
                  value={score}
                  onChange={(event) => teamScoreChanged({ teamId: team.id, score: Number(event.target.value) || 0 })}
                />
                <button onClick={() => teamScoreChanged({ teamId: team.id, score: score + 100 })}>+100</button>
                <button className="icon-button" onClick={() => setEditingTeamId(null)} title="Готово">✓</button>
              </div>
            ) : (
              <button className="score-value" onClick={() => setEditingTeamId(team.id)} title="Изменить баллы вручную">
                {score}
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
