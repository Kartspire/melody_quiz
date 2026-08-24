import { useMemo } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeGame,
  $games,
  $hydrated,
  $screen,
  $storageError,
  $storageReadOnly,
  $storageSaveStatus,
  $sessions,
  gameLaunchRequested,
  hasSessionProgress,
  screenChanged,
  storageRetryRequested,
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

export function App() {
  const [screen, hydrated, activeGame, games, sessions, storageError, storageReadOnly, storageSaveStatus] = useUnit([
    $screen,
    $hydrated,
    $activeGame,
    $games,
    $sessions,
    $storageError,
    $storageReadOnly,
    $storageSaveStatus,
  ]);

  const savedSessionGames = useMemo(
    () => games.filter((game) => hasSessionProgress(sessions[game.id])).sort((a, b) => (sessions[b.id]?.updatedAt ?? b.updatedAt) - (sessions[a.id]?.updatedAt ?? a.updatedAt)),
    [games, sessions],
  );
  const sidebarGame = savedSessionGames[0] ?? null;
  const sidebarSession = sidebarGame ? sessions[sidebarGame.id] : null;
  const sidebarFinished = Boolean(sidebarGame && sidebarSession && sidebarSession.stageIndex >= sidebarGame.stages.length);

  if (!hydrated) {
    if (storageError) {
      return (
        <div className="app-loader storage-recovery">
          <strong>Не удалось безопасно открыть локальные данные</strong>
          <span>{storageError}</span>
          <button className="primary-button" onClick={() => storageRetryRequested()}>Повторить загрузку</button>
          <small>Редактирование заблокировано, чтобы пустое состояние не перезаписало существующую базу.</small>
        </div>
      );
    }
    return <div className="app-loader"><div className="loader-disc" /><span>Загружаем библиотеку игр…</span></div>;
  }

  if (storageReadOnly) {
    return (
      <div className="app-loader storage-recovery">
        <strong>Данные изменились в другой вкладке</strong>
        <span>{storageError || 'Эта вкладка остановлена, чтобы не перезаписать более новую версию локальной базы.'}</span>
        <button className="primary-button" onClick={() => window.location.reload()}>Загрузить актуальные данные</button>
        <small>Несохранённые изменения этой вкладки намеренно не записываются поверх более новой версии.</small>
      </div>
    );
  }

  if (screen === 'game' && activeGame) {
    return (
      <div className="game-mode">
        {storageError && <StorageErrorBanner message={storageError} />}
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
      {storageError && <StorageErrorBanner message={storageError} />}
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
        <small className="storage-save-status">{storageSaveStatus === 'saving' ? 'Сохраняем…' : storageSaveStatus === 'error' ? 'Ошибка сохранения' : storageSaveStatus === 'saved' ? 'Изменения сохранены' : ''}</small>

        {screen !== 'library' && sidebarGame && sidebarSession && (
          <section className="active-session-card">
            <div className="active-session-card__status"><span /> {sidebarFinished ? 'Игра завершена' : 'Сохранённая партия'}</div>
            <strong>{sidebarGame.title || 'Без названия'}</strong>
            <small>
              {sidebarFinished
                ? `Сыграно ${sidebarSession.completedQuestionIds.length} вопросов`
                : `Этап ${Math.min(sidebarSession.stageIndex + 1, sidebarGame.stages.length)} из ${sidebarGame.stages.length} · сыграно ${sidebarSession.completedQuestionIds.length}`}
              {savedSessionGames.length > 1 ? ` · ещё партий: ${savedSessionGames.length - 1}` : ''}
            </small>
            <button onClick={() => gameLaunchRequested({ gameId: sidebarGame.id, mode: 'continue' })}>
              {sidebarFinished ? 'Открыть результаты →' : 'Продолжить →'}
            </button>
          </section>
        )}
      </aside>

      <GameLaunchDialog />
      <div className="app-content">
        {screen === 'library' && <GameLibrary />}
        {screen === 'media' && <MediaLibrary />}
        {screen === 'vocal-removal' && <VocalRemovalPage />}
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

function StorageErrorBanner({ message }: { message: string }) {
  return (
    <div className="storage-error-banner" role="alert">
      <div className="storage-error-banner__text">
        <strong>Данные сейчас не защищены</strong>
        <span>{message}</span>
      </div>
      <button className="secondary-button" onClick={() => window.location.reload()}>Перезагрузить</button>
    </div>
  );
}
