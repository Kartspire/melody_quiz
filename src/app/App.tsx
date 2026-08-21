import { useMemo } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeGame,
  $audioAssets,
  $games,
  $hydrated,
  $screen,
  $storageError,
  $sessions,
  $songs,
  activeGameChanged,
  getGameStartIssues,
  hasSessionProgress,
  screenChanged,
} from '../model/game';
import type { Screen } from '../model/types';
import { AdminPanel } from '../components/AdminPanel';
import { GameBoard } from '../components/GameBoard';
import { GameLibrary } from '../components/GameLibrary';
import { MediaLibrary } from '../components/MediaLibrary';
import { Scoreboard } from '../components/Scoreboard';
import { SettingsPage } from '../components/SettingsPage';

export function App() {
  const [screen, hydrated, activeGame, games, sessions, songs, audioAssets, storageError] = useUnit([
    $screen,
    $hydrated,
    $activeGame,
    $games,
    $sessions,
    $songs,
    $audioAssets,
    $storageError,
  ]);

  const savedSessionGames = useMemo(
    () => games.filter((game) => hasSessionProgress(sessions[game.id])).sort((a, b) => b.updatedAt - a.updatedAt),
    [games, sessions],
  );
  const sidebarGame = activeGame && hasSessionProgress(sessions[activeGame.id]) ? activeGame : savedSessionGames[0] ?? null;
  const sidebarSession = sidebarGame ? sessions[sidebarGame.id] : null;
  const sidebarFinished = Boolean(sidebarGame && sidebarSession && sidebarSession.roundIndex >= sidebarGame.rounds.length);

  if (!hydrated) {
    return <div className="app-loader"><div className="loader-disc" /><span>Загружаем библиотеку игр…</span></div>;
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
          <SidebarButton screen={screen} target="settings" icon="⚙" label="Настройки" />
        </nav>

        <div className="sidebar-spacer" />

        {sidebarGame && sidebarSession && (
          <section className="active-session-card">
            <div className="active-session-card__status"><span /> {sidebarFinished ? 'Игра завершена' : 'Сохранённая партия'}</div>
            <strong>{sidebarGame.title || 'Без названия'}</strong>
            <small>
              {sidebarFinished
                ? `Сыграно ${sidebarSession.completedQuestionIds.length} вопросов`
                : `Раунд ${sidebarSession.roundIndex + 1} · сыграно ${sidebarSession.completedQuestionIds.length}`}
              {savedSessionGames.length > 1 ? ` · ещё партий: ${savedSessionGames.length - 1}` : ''}
            </small>
            <button onClick={() => {
              const issues = sidebarFinished ? [] : getGameStartIssues(sidebarGame, songs, audioAssets);
              activeGameChanged(sidebarGame.id);
              if (issues.length > 0) {
                window.alert('Игра была изменена и сейчас не готова к продолжению. Откройте редактор и исправьте недостающие песни/аудио.');
                screenChanged('admin');
                return;
              }
              screenChanged('game');
            }}>{sidebarFinished ? 'Открыть результаты →' : 'Продолжить →'}</button>
          </section>
        )}
      </aside>

      <div className="app-content">
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

function StorageErrorBanner({ message }: { message: string }) {
  return (
    <div className="storage-error-banner" role="alert">
      <strong>Данные сейчас не защищены</strong>
      <span>{message}</span>
    </div>
  );
}
