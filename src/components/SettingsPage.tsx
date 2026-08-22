import { useEffect, useState } from 'react';
import { useUnit } from 'effector-react';
import { getStorageEstimate, isPersistentStorage, requestPersistentStorage } from '../lib/storage';
import { $games, $persistedState, $songs, screenChanged } from '../model/game';

export function SettingsPage() {
  const [games, songs, persistedState] = useUnit([$games, $songs, $persistedState]);
  const audioSize = persistedState.audioAssets.reduce((sum, asset) => sum + asset.blob.size, 0);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [persistBusy, setPersistBusy] = useState(false);

  const refreshStorageInfo = async () => {
    try {
      const [estimate, persisted] = await Promise.all([getStorageEstimate(), isPersistentStorage()]);
      setStorageInfo(estimate);
      setPersistent(persisted);
    } catch (error) {
      console.warn('Storage information is unavailable.', error);
    }
  };

  useEffect(() => {
    void refreshStorageInfo();
  }, [audioSize]);

  const enablePersistentStorage = async () => {
    setPersistBusy(true);
    try {
      const granted = await requestPersistentStorage();
      setPersistent(granted);
      await refreshStorageInfo();
    } finally {
      setPersistBusy(false);
    }
  };

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
        <article className="settings-stat-card"><strong>{formatBytes(audioSize)}</strong><span>Аудио приложения</span></article>
        {storageInfo && <article className="settings-stat-card"><strong>{formatBytes(storageInfo.usage)}</strong><span>Всего занято сайтом</span></article>}
        {storageInfo?.quota ? <article className="settings-stat-card"><strong>{formatBytes(storageInfo.quota)}</strong><span>Доступная квота</span></article> : null}
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
          <div>
            <strong>Защита локального хранилища</strong>
            <span>{persistent === true ? 'Браузер подтвердил persistent storage: риск автоматического удаления данных снижен.' : persistent === false ? 'Persistent storage пока не предоставлен браузером.' : 'Проверяем статус persistent storage…'}</span>
          </div>
          {persistent !== true && (
            <button className="secondary-button" disabled={persistBusy} onClick={() => void enablePersistentStorage()}>
              {persistBusy ? 'Запрашиваем…' : 'Защитить локальные данные'}
            </button>
          )}
        </div>
      </section>

      <section className="storage-warning-card">
        <strong>Важно</strong>
        <p>Очистка данных сайта в браузере всё равно может удалить IndexedDB. Экспортируйте важные игры после завершения настройки и периодически сохраняйте медиатеку.</p>
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
