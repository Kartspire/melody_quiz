import type { CSSProperties } from 'react';
import {
  hasSessionProgress,
  teamAdded,
  teamChanged,
  teamRemoved,
} from '../../model/game';
import { DATA_LIMITS, GAME_LIMITS } from '../../model/limits';
import type { GameConfig, GameSession } from '../../model/types';
import { useFeedback } from '../feedback/FeedbackProvider';

export function AdminTeamsTab({ config, session }: { config: GameConfig; session: GameSession | null }) {
  const { confirm } = useFeedback();

  return (
    <section className="editor-tab-content">
      <div className="section-intro">
        <div><h2>Команды</h2><p>Цвет команды используется на табло и при выборе правильного ответа.</p></div>
        <button className="secondary-button" disabled={config.teams.length >= GAME_LIMITS.teams} onClick={() => teamAdded()}>+ Добавить команду</button>
      </div>
      <div className="team-settings-grid team-settings-grid--large">
        {config.teams.map((team, index) => (
          <article className="team-settings-card team-settings-card--large" key={team.id} style={{ '--team-color': team.color } as CSSProperties}>
            <div className="team-card-index">{index + 1}</div>
            <input
              className="color-input"
              type="color"
              value={team.color}
              onChange={(event) => teamChanged({ teamId: team.id, patch: { color: event.target.value } })}
              aria-label={`Цвет ${team.name}`}
            />
            <label className="field"><span>Название команды</span><input maxLength={DATA_LIMITS.text.teamName} value={team.name} onChange={(event) => teamChanged({ teamId: team.id, patch: { name: event.target.value } })} placeholder="Название команды" /></label>
            <button
              className="danger-ghost"
              disabled={config.teams.length <= 1}
              onClick={() => {
                if (!hasSessionProgress(session)) {
                  teamRemoved(team.id);
                  return;
                }
                void confirm({
                  title: `Удалить команду «${team.name}»?`,
                  description: 'Её текущие баллы в сохранённой партии будут потеряны.',
                  confirmLabel: 'Удалить команду',
                  tone: 'danger',
                }).then((confirmed) => { if (confirmed) teamRemoved(team.id); });
              }}
            >Удалить</button>
          </article>
        ))}
      </div>
    </section>
  );
}
