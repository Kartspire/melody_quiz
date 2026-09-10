import { useEffect, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeGame,
  $hydrated,
  $persistedState,
  $screen,
  $storageError,
  $storageReadOnly,
  $storageSaveStatus,
  screenChanged,
  $stateReplacementPending,
  storageSaveRetryRequested,
} from '../model/game';
import type { Screen } from '../model/types';
import { AdminPanel } from '../components/AdminPanel';
import { GameBoard } from '../components/GameBoard';
import { GameLibrary } from '../components/GameLibrary';
import { MediaLibrary } from '../components/MediaLibrary';
import { VocalRemovalPage } from '../features/vocalRemoval/VocalRemovalPage';
import { Scoreboard } from '../components/Scoreboard';
import { SettingsPage } from '../components/SettingsPage';
import { GameLaunchDialog } from '../components/GameLaunchDialog';
import { exportAppBackup } from '../lib/appBackup';
import { downloadBlob } from '../lib/download';
import { StorageRecovery } from '../components/StorageRecovery';

export function App() {
  const replacing = useUnit($stateReplacementPending);
  return <>
    <div inert={replacing}><AppContent /></div>
    {replacing && <div className="state-replacement-overlay" role="status">Применяем данные… Дождитесь завершения.</div>}
  </>;
}

function AppContent() {
  const [screen, hydrated, activeGame, storageError, storageReadOnly, storageSaveStatus, persistedState] = useUnit([
    $screen,
    $hydrated,
    $activeGame,
    $storageError,
    $storageReadOnly,
    $storageSaveStatus,
    $persistedState,
  ]);
  const [emergencyBackupBusy, setEmergencyBackupBusy] = useState(false);
  const [emergencyBackupError, setEmergencyBackupError] = useState<string | null>(null);

  useEffect(() => {
    if (!storageError) setEmergencyBackupError(null);
  }, [storageError]);

  const saveEmergencyBackup = async () => {
    setEmergencyBackupBusy(true);
    setEmergencyBackupError(null);
    try {
      const result = await exportAppBackup(persistedState);
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      setEmergencyBackupError(error instanceof Error ? error.message : 'Не удалось создать резервную копию.');
    } finally {
      setEmergencyBackupBusy(false);
    }
  };

  if (!hydrated) {
    if (storageError) {
      return <StorageRecovery message={storageError} />;
    }
    return <div className="app-loader"><div className="loader-disc" /><span>Загружаем библиотеку игр…</span></div>;
  }

  if (storageReadOnly) {
    return (
      <div className="app-loader storage-recovery">
        <strong>Данные изменились в другой вкладке</strong>
        <span>{storageError || 'Эта вкладка остановлена, чтобы не перезаписать более новую версию локальной базы.'}</span>
        <div className="storage-recovery__actions">
          <button className="secondary-button" disabled={emergencyBackupBusy} onClick={() => void saveEmergencyBackup()}>
            {emergencyBackupBusy ? 'Создаём копию…' : 'Сохранить аварийную копию'}
          </button>
          <button className="primary-button" onClick={() => window.location.reload()}>Загрузить актуальные данные</button>
        </div>
        {emergencyBackupError && <small className="storage-recovery__error">{emergencyBackupError}</small>}
        <small>Несохранённые изменения этой вкладки намеренно не записываются поверх более новой версии.</small>
      </div>
    );
  }

  const storageBanner = storageError ? (
    <StorageErrorBanner
      message={storageError}
      saveStatus={storageSaveStatus}
      backupBusy={emergencyBackupBusy}
      backupError={emergencyBackupError}
      onBackup={saveEmergencyBackup}
    />
  ) : null;

  if (screen === 'game' && activeGame) {
    return (
      <div className="game-mode">
        {storageBanner}
        <header className="game-mode__header">
          <button className="game-mode__exit" onClick={() => screenChanged('library')}>← Выйти к играм</button>
          <Scoreboard />
          <div className="game-mode__identity">
            <span>Сейчас идёт</span>
            <strong>{activeGame.title || 'Без названия'}</strong>
          </div>
        </header>
        <GameBoard />
        <GameLaunchDialog />
      </div>
    );
  }

  return (
    <div className="app app-layout">
      {storageBanner}
      <aside className="app-sidebar">
        <button className="sidebar-brand" onClick={() => screenChanged('library')}>
          <span className="brand-mark">♪</span>
          <span><strong>Угадай мелодию</strong><small>Панель ведущего</small></span>
        </button>

        <nav className="sidebar-nav" aria-label="Основная навигация">
          <SidebarButton screen={screen} target="library" icon="▣" label="Мои игры" />
          <SidebarButton screen={screen} target="media" icon="♫" label="Медиатека" />
          <SidebarButton screen={screen} target="vocal-removal" icon="◉" label="Обработка трека" />
          <SidebarButton screen={screen} target="settings" icon="⚙" label="Настройки" />
        </nav>

        <div className="sidebar-spacer" />
        <small className="storage-save-status">
          {storageSaveStatus === 'saving'
            ? 'Сохраняем…'
            : storageSaveStatus === 'error'
              ? 'Ошибка сохранения'
              : storageSaveStatus === 'dirty'
                ? 'Есть несохранённые изменения'
                : storageSaveStatus === 'saved'
                  ? 'Изменения сохранены'
                  : ''}
        </small>
      </aside>

      <GameLaunchDialog />
      <div className="app-content">
        <div hidden={screen !== 'vocal-removal'}>
          <VocalRemovalPage active={screen === 'vocal-removal'} />
        </div>
        {screen === 'library' && <GameLibrary />}
        {screen === 'media' && <MediaLibrary />}
        {screen === 'settings' && <SettingsPage />}
        {screen === 'admin' && (activeGame ? <AdminPanel /> : <GameLibrary />)}
        {screen === 'game' && !activeGame && <GameLibrary />}
      </div>
    </div>
  );
}

function SidebarButton({ screen, target, icon, label }: { screen: Screen; target: Screen; icon: string; label: string }) {
  const active = screen === target || (target === 'library' && screen === 'admin');
  return (
    <button className={active ? 'sidebar-nav__item sidebar-nav__item--active' : 'sidebar-nav__item'} onClick={() => screenChanged(target)}>
      <span>{icon}</span>
      <strong>{label}</strong>
    </button>
  );
}

function StorageErrorBanner({
  message,
  saveStatus,
  backupBusy,
  backupError,
  onBackup,
}: {
  message: string;
  saveStatus: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  backupBusy: boolean;
  backupError: string | null;
  onBackup: () => Promise<void>;
}) {
  return (
    <div className="storage-error-banner" role="alert">
      <div className="storage-error-banner__text">
        <strong>Данные сейчас не защищены</strong>
        <span>{message}</span>
        {backupError && <span>{backupError}</span>}
      </div>
      <div className="storage-error-banner__actions">
        <button className="secondary-button" disabled={saveStatus === 'saving'} onClick={() => storageSaveRetryRequested()}>
          {saveStatus === 'saving' ? 'Сохраняем…' : 'Повторить сохранение'}
        </button>
        <button className="secondary-button" disabled={backupBusy} onClick={() => void onBackup()}>
          {backupBusy ? 'Создаём копию…' : 'Резервная копия'}
        </button>
      </div>
    </div>
  );
}
