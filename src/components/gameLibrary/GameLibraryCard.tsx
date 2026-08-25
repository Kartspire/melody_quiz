import {
  gameDeleted,
  gameDuplicated,
  gameLaunchRequested,
} from '../../model/game';
import type { GameConfig, GameSession } from '../../model/types';
import { ActionMenu } from '../ActionMenu';
import { useFeedback } from '../feedback/FeedbackProvider';

export function GameLibraryCard({
  game,
  session,
  hasProgress,
  exporting,
  busy,
  onOpenEditor,
  onExport,
}: {
  game: GameConfig;
  session?: GameSession;
  hasProgress: boolean;
  exporting: boolean;
  busy: boolean;
  onOpenEditor: () => void;
  onExport: () => void;
}) {
  const { confirm } = useFeedback();
  const finished = Boolean(session && session.stageIndex >= game.stages.length);
  const questionCount = game.rounds.reduce(
    (total, round) => total + round.categories.reduce((sum, category) => sum + category.questions.length, 0),
    0,
  );
  const assignedSongs = game.rounds.reduce(
    (total, round) => total + round.categories.reduce(
      (roundTotal, category) => roundTotal + category.questions.filter((question) => Boolean(question.songId)).length,
      0,
    ),
    0,
  );
  const completed = session?.completedQuestionIds.length ?? 0;

  return (
    <article className="game-library-card">
      <div className="game-library-card__head">
        <div>
          <span className="eyebrow">{game.rounds.length} раундов{game.interRounds.length ? ` · ${game.interRounds.length} межраундов` : ''} · {assignedSongs}/{questionCount} песен</span>
          <h2>{game.title || 'Без названия'}</h2>
        </div>
        {hasProgress && <span className="session-badge">Сессия сохранена</span>}
      </div>

      <div className="game-library-card__meta">
        <span>Команд: {game.teams.length}</span>
        {hasProgress && <span>Разыграно: {completed}</span>}
        <span>Изменено: {formatDate(game.updatedAt)}</span>
      </div>

      <div className="game-library-card__actions game-library-card__actions--clean">
        <button className="primary-button" onClick={() => gameLaunchRequested({ gameId: game.id, mode: 'continue' })}>
          {finished ? 'Результаты' : hasProgress ? '▶ Продолжить' : '▶ Играть'}
        </button>
        <button className="secondary-button" onClick={onOpenEditor}>Редактировать</button>
        <ActionMenu label={`Дополнительные действия для ${game.title || 'игры без названия'}`}>
          {hasProgress && <button onClick={() => gameLaunchRequested({ gameId: game.id, mode: 'fresh' })}>Начать заново</button>}
          <button disabled={busy} onClick={onExport}>{exporting ? 'Экспорт…' : 'Экспортировать игру'}</button>
          <button onClick={() => gameDuplicated(game.id)}>Дублировать</button>
          <button
            className="action-menu__danger"
            onClick={() => {
              void confirm({
                title: `Удалить игру «${game.title || 'Без названия'}»?`,
                description: 'Конфигурация и сохранённая партия будут удалены. Песни из медиатеки останутся.',
                confirmLabel: 'Удалить игру',
                tone: 'danger',
              }).then((confirmed) => { if (confirmed) gameDeleted(game.id); });
            }}
          >Удалить игру</button>
        </ActionMenu>
      </div>
    </article>
  );
}

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return 'неизвестно';
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  } catch {
    return 'неизвестно';
  }
}
