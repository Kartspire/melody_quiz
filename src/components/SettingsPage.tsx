import { useUnit } from 'effector-react';
import { $games, $persistedState, $songs, screenChanged } from '../model/game';

export function SettingsPage() {
  const [games, songs, persistedState] = useUnit([$games, $songs, $persistedState]);
  const audioSize = persistedState.audioAssets.reduce((sum, asset) => sum + asset.size, 0);

  return (
    <main className="settings-page page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Приложение</span>
          <h1>Настройки</h1>
          <p>Общие параметры и информация о локальном хранилище. Настройки конкретной игры находятся внутри её редактора.</p>
        </div>
      </div>

      <section className="settings-overview-grid">
        <article className="settings-stat-card"><strong>{games.length}</strong><span>Сохранённых игр</span></article>
        <article className="settings-stat-card"><strong>{songs.length}</strong><span>Песен в медиатеке</span></article>
        <article className="settings-stat-card"><strong>{formatBytes(audioSize)}</strong><span>Аудио в IndexedDB</span></article>
      </section>

      <section className="admin-section">
        <div className="section-title">
          <div>
            <h2>Хранилище и резервные копии</h2>
            <p>Рабочие данные находятся локально в IndexedDB. Для защиты готовых наборов используйте экспорт игр и медиатеки.</p>
          </div>
        </div>
        <div className="settings-action-list">
          <div><strong>Игры</strong><span>Каждую игру можно экспортировать вместе со всеми используемыми песнями.</span></div>
          <button className="secondary-button" onClick={() => screenChanged('library')}>Перейти к играм</button>
          <div><strong>Медиатека</strong><span>Можно сохранить всю библиотеку песен одним архивом и восстановить её позже.</span></div>
          <button className="secondary-button" onClick={() => screenChanged('media')}>Перейти в медиатеку</button>
        </div>
      </section>

      <section className="storage-warning-card">
        <strong>Важно</strong>
        <p>Очистка данных сайта в браузере может удалить IndexedDB. Экспортируйте важные игры после завершения настройки и периодически сохраняйте медиатеку.</p>
      </section>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}
