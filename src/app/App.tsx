import { useUnit } from 'effector-react';
import { $config, $hydrated, $screen, screenChanged } from '../model/game';
import { AdminPanel } from '../components/AdminPanel';
import { GameBoard } from '../components/GameBoard';
import { Scoreboard } from '../components/Scoreboard';

export function App() {
  const [screen, hydrated, config] = useUnit([$screen, $hydrated, $config]);

  if (!hydrated) {
    return <div className="app-loader"><div className="loader-disc" /><span>Загружаем игру…</span></div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => screenChanged('game')}>
          <span className="brand-mark">♪</span>
          <span>{config.title}</span>
        </button>
        <Scoreboard />
        <nav className="topnav">
          <button className={screen === 'game' ? 'active' : ''} onClick={() => screenChanged('game')}>Игра</button>
          <button className={screen === 'admin' ? 'active' : ''} onClick={() => screenChanged('admin')}>Настройки</button>
        </nav>
      </header>
      {screen === 'admin' ? <AdminPanel /> : <GameBoard />}
    </div>
  );
}
