import { useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $games,
  $persistedState,
  $sessions,
  $songs,
  activeGameChanged,
  gameCreated,
  hasSessionProgress,
  persistedStateImportFx,
  screenChanged,
} from '../model/game';
import {
  downloadBlob,
  exportGamePackage,
  finalizeGameImport,
  parseMelodyPackage,
  prepareGameImport,
  type GameConflictMode,
  type ParsedMelodyPackage,
  type PreparedGameImport,
} from '../lib/melodyPackage';
import type { GameConfig } from '../model/types';
import { getErrorMessage } from '../lib/errors';
import { useFeedback } from './feedback/FeedbackProvider';
import { CreateGamePanel } from './gameLibrary/CreateGamePanel';
import { GameImportDialog } from './gameLibrary/GameImportDialog';
import { GameLibraryCard } from './gameLibrary/GameLibraryCard';

export function GameLibrary() {
  const [games, sessions, songs, persistedState] = useUnit([$games, $sessions, $songs, $persistedState]);
  const { notify } = useFeedback();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('Новая игра');
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ packageData: ParsedMelodyPackage; preview: PreparedGameImport } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const sortedGames = useMemo(() => [...games].sort((a, b) => b.updatedAt - a.updatedAt), [games]);

  const openEditor = (gameId: string) => {
    activeGameChanged(gameId);
    screenChanged('admin');
  };

  const createGame = () => {
    if (!title.trim()) return;
    gameCreated(title);
    setCreating(false);
    setTitle('Новая игра');
    screenChanged('admin');
  };

  const exportGame = async (game: GameConfig) => {
    try {
      setBusy(`export:${game.id}`);
      const result = await exportGamePackage(game, songs, persistedState.mediaTracks, persistedState.audioAssets);
      downloadBlob(result.blob, result.filename);
      notify({ kind: 'success', message: `Игра «${game.title || 'Без названия'}» экспортирована.` });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось экспортировать игру', message: getErrorMessage(error, 'Попробуйте ещё раз.') });
    } finally {
      setBusy(null);
    }
  };

  const selectImportFile = async (file?: File) => {
    if (!file) return;
    try {
      setBusy('import');
      const packageData = await parseMelodyPackage(file);
      if (packageData.manifest.type !== 'melody-game') throw new Error('Это архив медиатеки. Для него используйте импорт на экране «Медиатека».');
      const preview = await prepareGameImport(packageData, persistedState);
      setPendingImport({ packageData, preview });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось прочитать архив игры', message: getErrorMessage(error, 'Проверьте файл и попробуйте ещё раз.') });
    } finally {
      setBusy(null);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const applyImport = async (mode: GameConflictMode) => {
    if (!pendingImport) return;
    try {
      setBusy('import');
      await persistedStateImportFx(async (current) => {
        const prepared = await prepareGameImport(pendingImport.packageData, current);
        return finalizeGameImport(prepared, current, mode);
      });
      const title = pendingImport.packageData.game?.title || 'Игра';
      setPendingImport(null);
      screenChanged('library');
      notify({ kind: 'success', message: `«${title}» импортирована.` });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось сохранить импортированную игру', message: getErrorMessage(error, 'Попробуйте ещё раз.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="library-page page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Библиотека</span>
          <h1>Мои игры</h1>
          <p>Создавайте несколько наборов и возвращайтесь к ним в любое время. Песни хранятся отдельно в общей медиатеке.</p>
        </div>
        {sortedGames.length > 0 && (
          <div className="page-heading__actions">
            <button className="secondary-button" disabled={busy !== null} onClick={() => importInputRef.current?.click()}>
              {busy === 'import' ? 'Проверяем архив…' : 'Импортировать игру'}
            </button>
            <button className="primary-button" onClick={() => setCreating(true)}>+ Новая игра</button>
          </div>
        )}
      </div>

      <input ref={importInputRef} className="hidden-file-input" type="file" accept=".melody,application/zip" onChange={(event) => void selectImportFile(event.target.files?.[0])} />

      {sortedGames.length > 0 && (
        <div className="backup-hint">
          <strong>Совет:</strong> экспорт игры создаёт переносимый архив с её настройками и всеми используемыми минусами/плюсами. Храните такой файл как резервную копию готового набора.
        </div>
      )}

      {creating && <CreateGamePanel title={title} onTitleChange={setTitle} onCreate={createGame} onCancel={() => setCreating(false)} />}

      {sortedGames.length === 0 ? (
        creating ? null : (
          <div className="empty-state empty-state--actions">
            <h2>Сохранённых игр пока нет</h2>
            <p>Создайте новую игру или импортируйте готовый архив. Медиатека при этом может оставаться отдельной.</p>
            <div className="inline-actions">
              <button className="primary-button" onClick={() => setCreating(true)}>+ Создать игру</button>
              <button className="secondary-button" disabled={busy !== null} onClick={() => importInputRef.current?.click()}>
                {busy === 'import' ? 'Проверяем архив…' : 'Импортировать игру'}
              </button>
            </div>
          </div>
        )
      ) : (
        <section className="game-library-grid">
          {sortedGames.map((game) => {
            const session = sessions[game.id];
            const progress = hasSessionProgress(session);
            return (
              <GameLibraryCard
                key={game.id}
                game={game}
                session={session}
                hasProgress={progress}
                exporting={busy === `export:${game.id}`}
                busy={busy !== null}
                onOpenEditor={() => openEditor(game.id)}
                onExport={() => void exportGame(game)}
              />
            );
          })}
        </section>
      )}

      {pendingImport && <GameImportDialog busy={busy === 'import'} prepared={pendingImport.preview} onCancel={() => { if (busy !== 'import') setPendingImport(null); }} onImport={(mode) => void applyImport(mode)} />}
    </main>
  );
}
