import { gameDeleted, gameTitleChanged, screenChanged } from '../../model/game';
import { DATA_LIMITS } from '../../model/limits';
import type { GameConfig } from '../../model/types';
import { useFeedback } from '../feedback/FeedbackProvider';

export function AdminSettingsTab({ config, questionsCount, assignedCount }: {
  config: GameConfig;
  questionsCount: number;
  assignedCount: number;
}) {
  const { confirm } = useFeedback();

  return (
    <section className="editor-tab-content">
      <section className="admin-section">
        <div className="section-title"><div><h2>Основные настройки</h2><p>Параметры только этой игры.</p></div></div>
        <div className="game-settings-grid">
          <label className="field"><span>Название игры</span><input maxLength={DATA_LIMITS.text.gameTitle} value={config.title} onChange={(event) => gameTitleChanged(event.target.value)} /></label>
          <div className="readonly-setting"><span>Раундов</span><strong>{config.rounds.length}</strong><small>Добавляются во вкладке «Структура игры»</small></div>
          <div className="readonly-setting"><span>Межраундов</span><strong>{config.interRounds.length}</strong><small>Выбираются из библиотеки шаблонов</small></div>
          <div className="readonly-setting"><span>Вопросов</span><strong>{questionsCount}</strong><small>{assignedCount} с назначенными песнями</small></div>
          <div className="readonly-setting"><span>Команд</span><strong>{config.teams.length}</strong><small>Настраиваются во вкладке «Команды»</small></div>
        </div>
      </section>

      <section className="danger-zone">
        <div><span className="eyebrow">Опасная зона</span><h2>Удалить игру</h2><p>Будет удалена конфигурация и сохранённая сессия. Песни из общей медиатеки останутся.</p></div>
        <button
          className="danger-button"
          onClick={() => {
            void confirm({
              title: `Удалить игру «${config.title}»?`,
              description: 'Конфигурация и сохранённая партия будут удалены. Песни останутся в медиатеке.',
              confirmLabel: 'Удалить игру',
              tone: 'danger',
            }).then((confirmed) => {
              if (!confirmed) return;
              gameDeleted(config.id);
              screenChanged('library');
            });
          }}
        >Удалить игру</button>
      </section>
    </section>
  );
}
