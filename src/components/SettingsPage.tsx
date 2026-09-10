import { useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import { exportAppBackup, parseAppBackup, type ParsedAppBackup } from '../lib/appBackup';
import { downloadBlob } from '../lib/download';
import { formatBytes } from '../lib/format';
import { getStorageEstimate, isPersistentStorage, requestPersistentStorage } from '../lib/storage';
import { $games, $mediaTracks, $persistedState, $songs, persistedStateImportFx } from '../model/game';
import { Dialog } from './Dialog';

export function SettingsPage() {
  const [games, songs, mediaTracks, persistedState] = useUnit([$games, $songs, $mediaTracks, $persistedState]);
  const audioSize = persistedState.audioAssets.reduce((sum, asset) => sum + asset.blob.size, 0);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [persistBusy, setPersistBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState<'export' | 'parse' | 'restore' | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] = useState<ParsedAppBackup | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

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

  const exportFullBackup = async () => {
    setBackupBusy('export');
    setBackupError(null);
    setBackupNotice(null);
    try {
      const result = await exportAppBackup(persistedState);
      downloadBlob(result.blob, result.filename);
      setBackupNotice('Полная резервная копия создана. В неё включены игры, медиатека и прогресс партий.');
    } catch (error) {
      setBackupError(errorMessage(error, 'Не удалось создать полную резервную копию.'));
    } finally {
      setBackupBusy(null);
    }
  };

  const selectBackupFile = async (file?: File) => {
    if (!file) return;
    setBackupBusy('parse');
    setBackupError(null);
    setBackupNotice(null);
    try {
      const parsed = await parseAppBackup(file);
      setRestorePreview(parsed);
    } catch (error) {
      setBackupError(errorMessage(error, 'Не удалось проверить резервную копию.'));
    } finally {
      setBackupBusy(null);
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  const restoreFullBackup = async () => {
    if (!restorePreview) return;
    setBackupBusy('restore');
    setBackupError(null);
    try {
      await persistedStateImportFx(restorePreview.state);
      setRestorePreview(null);
      setBackupNotice('Резервная копия восстановлена. Игры, медиатека и сохранённые партии заменены данными из архива.');
      await refreshStorageInfo();
    } catch (error) {
      setBackupError(errorMessage(error, 'Не удалось восстановить резервную копию.'));
    } finally {
      setBackupBusy(null);
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
        <article className="settings-stat-card"><strong>{mediaTracks.length}</strong><span>Аудиотреков в медиатеке</span></article>
        <article className="settings-stat-card"><strong>{formatBytes(audioSize)}</strong><span>Аудио приложения</span></article>
        {storageInfo && <article className="settings-stat-card"><strong>{formatBytes(storageInfo.usage)}</strong><span>Всего занято сайтом</span></article>}
        {storageInfo?.quota ? <article className="settings-stat-card"><strong>{formatBytes(storageInfo.quota)}</strong><span>Доступная квота</span></article> : null}
      </section>

      <section className="admin-section">
        <div className="section-title">
          <div>
            <h2>Хранилище и резервные копии</h2>
            <p>Рабочие данные находятся локально в IndexedDB. Полная копия сохраняет приложение целиком, включая незавершённые партии и счёт.</p>
          </div>
        </div>
        <div className="settings-action-list">
          <div className="settings-storage-action">
            <div>
              <strong>Полная резервная копия</strong>
              <span>Игры, песни, медиатреки, аудиофайлы, текущий прогресс партий, счёт и выбранная игра сохраняются в один файл.</span>
            </div>
            <div className="settings-backup-buttons">
              <button className="secondary-button" disabled={backupBusy !== null} onClick={() => void exportFullBackup()}>
                {backupBusy === 'export' ? 'Создаём…' : 'Создать полную копию'}
              </button>
              <button className="secondary-button" disabled={backupBusy !== null} onClick={() => backupInputRef.current?.click()}>
                {backupBusy === 'parse' ? 'Проверяем…' : 'Восстановить из копии'}
              </button>
              <input
                ref={backupInputRef}
                className="hidden-file-input"
                type="file"
                accept=".melody-backup,application/zip"
                onChange={(event) => void selectBackupFile(event.target.files?.[0])}
              />
            </div>
          </div>
          <div><strong>Экспорт отдельной игры</strong><span>Копию только одной игры без прогресса партии можно создать через меню «⋯» на странице «Мои игры».</span></div>
          <div><strong>Экспорт медиатеки</strong><span>Отдельный перенос песен и треков доступен через меню «⋯» на странице «Медиатека».</span></div>
          <div className="settings-storage-action">
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
        </div>
        {backupNotice && <div className="settings-backup-message settings-backup-message--success">{backupNotice}</div>}
        {backupError && <div className="settings-backup-message settings-backup-message--error" role="alert">{backupError}</div>}
      </section>

      <section className="storage-warning-card">
        <strong>Важно</strong>
        <p>Очистка данных сайта в браузере всё равно может удалить IndexedDB. Для важных игр периодически создавайте полную резервную копию — она, в отличие от обычного экспорта игры, сохраняет и текущую партию.</p>
      </section>

      {restorePreview && (
        <Dialog
          busy={backupBusy === 'restore'}
          eyebrow="Полное восстановление"
          title="Заменить локальные данные?"
          description="Архив успешно проверен. Восстановление полностью заменит текущие игры, медиатеку и сохранённые партии данными из резервной копии."
          onClose={() => { if (backupBusy !== 'restore') setRestorePreview(null); }}
        >
          <div className="backup-restore-summary">
            <div><strong>{restorePreview.state.games.length}</strong><span>игр</span></div>
            <div><strong>{restorePreview.state.songs.length}</strong><span>песен</span></div>
            <div><strong>{restorePreview.state.mediaTracks.length}</strong><span>треков</span></div>
            <div><strong>{restorePreview.state.sessions.length}</strong><span>партий</span></div>
          </div>
          <p className="backup-restore-date">Копия создана: {new Date(restorePreview.manifest.createdAt).toLocaleString('ru-RU')}</p>
          <div className="import-dialog__actions">
            <button className="secondary-button" disabled={backupBusy === 'restore'} onClick={() => setRestorePreview(null)}>Отмена</button>
            <button className="primary-button" disabled={backupBusy === 'restore'} onClick={() => void restoreFullBackup()}>
              {backupBusy === 'restore' ? 'Восстанавливаем…' : 'Заменить данные и восстановить'}
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
