import { useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $games,
  $persistedState,
  $sessions,
  $songs,
  activeGameChanged,
  gameCreated,
  gameDeleted,
  gameDuplicated,
  gameLaunchRequested,
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
import { DATA_LIMITS } from '../model/limits';
import { getErrorMessage } from '../lib/errors';
import { ActionMenu } from './ActionMenu';
import { Dialog } from './Dialog';
import { ImportVerificationSummary } from './ImportVerificationSummary';

export function GameLibrary() {
  const [games, sessions, songs, persistedState] = useUnit([
    $games,
    $sessions,
    $songs,
    $persistedState,
  ]);
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

  const exportGame = async (game: GameConfig) => {
    try {
      setBusy(`export:${game.id}`);
      const result = await exportGamePackage(game, songs, persistedState.mediaTracks, persistedState.audioAssets);
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      window.alert(getErrorMessage(error, 'Не удалось экспортировать игру.'));
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
      window.alert(getErrorMessage(error, 'Не удалось прочитать архив игры.'));
    } finally {
      setBusy(null);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const applyImport = async (mode: GameConflictMode) => {
    if (!pendingImport) return;
    try {
      setBusy('import');
      const latestPrepared = await prepareGameImport(pendingImport.packageData, persistedState);
      const nextState = finalizeGameImport(latestPrepared, persistedState, mode);
      await persistedStateImportFx(nextState);
      setPendingImport(null);
      screenChanged('library');
    } catch (error) {
      window.alert(getErrorMessage(error, 'Не удалось сохранить импортированную игру.'));
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

      <input
        ref={importInputRef}
        className="hidden-file-input"
        type="file"
        accept=".melody,application/zip"
        onChange={(event) => void selectImportFile(event.target.files?.[0])}
      />

      {sortedGames.length > 0 && (
        <div className="backup-hint">
          <strong>Совет:</strong> экспорт игры создаёт переносимый архив с её настройками и всеми используемыми минусами/плюсами. Храните такой файл как резервную копию готового набора.
        </div>
      )}

      {creating && (
        <section className="create-game-panel">
          <label className="field">
            <span>Название новой игры</span>
            <input
              autoFocus
              maxLength={DATA_LIMITS.text.gameTitle}
              value={title}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && title.trim()) {
                  gameCreated(title);
                  setCreating(false);
                  setTitle('Новая игра');
                  screenChanged('admin');
                }
                if (event.key === 'Escape') setCreating(false);
              }}
            />
          </label>
          <div className="inline-actions">
            <button className="primary-button" disabled={!title.trim()} onClick={() => {
              gameCreated(title);
              setCreating(false);
              setTitle('Новая игра');
              screenChanged('admin');
            }}>Создать и настроить</button>
            <button className="secondary-button" onClick={() => setCreating(false)}>Отмена</button>
          </div>
        </section>
      )}

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
          const hasProgress = hasSessionProgress(session);
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
          const exporting = busy === `export:${game.id}`;

          return (
            <article className="game-library-card" key={game.id}>
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
                {finished ? (
                  <button className="primary-button" onClick={() => gameLaunchRequested({ gameId: game.id, mode: 'continue' })}>Результаты</button>
                ) : hasProgress ? (
                  <button className="primary-button" onClick={() => gameLaunchRequested({ gameId: game.id, mode: 'continue' })}>▶ Продолжить</button>
                ) : (
                  <button className="primary-button" onClick={() => gameLaunchRequested({ gameId: game.id, mode: 'continue' })}>▶ Играть</button>
                )}
                <button className="secondary-button" onClick={() => openEditor(game.id)}>Редактировать</button>
                <ActionMenu label={`Дополнительные действия для ${game.title || 'игры без названия'}`}>
                  {hasProgress && <button onClick={() => gameLaunchRequested({ gameId: game.id, mode: 'fresh' })}>Начать заново</button>}
                  <button disabled={busy !== null} onClick={() => void exportGame(game)}>{exporting ? 'Экспорт…' : 'Экспортировать игру'}</button>
                  <button onClick={() => gameDuplicated(game.id)}>Дублировать</button>
                  <button
                    className="action-menu__danger"
                    onClick={() => {
                      if (window.confirm(`Удалить игру «${game.title}»? Песни из медиатеки останутся.`)) gameDeleted(game.id);
                    }}
                  >Удалить игру</button>
                </ActionMenu>
              </div>
            </article>
          );
        })}
      </section>
      )}

      {pendingImport && (
        <GameImportDialog
          prepared={pendingImport.preview}
          onCancel={() => setPendingImport(null)}
          onImport={(mode) => void applyImport(mode)}
        />
      )}
    </main>
  );
}

function GameImportDialog({
  prepared,
  onCancel,
  onImport,
}: {
  prepared: PreparedGameImport;
  onCancel: () => void;
  onImport: (mode: GameConflictMode) => void;
}) {
  const game = prepared.package.game!;

  return (
    <Dialog
      eyebrow="Проверка завершена"
      title={`Импорт «${game.title}»`}
      onClose={onCancel}
      className="import-dialog"
    >
      <ImportVerificationSummary
        title={`Игра «${game.title}» готова к импорту`}
        stats={prepared.media.stats}
        checks={[
          'Архив не повреждён',
          'Структура данных проверена',
          'Все вложенные аудиофайлы доступны',
        ]}
      />

      <p className="import-note">
        Прогресс партии не переносится: после импорта игра начнётся с нулевыми баллами и всеми неразыгранными карточками.
      </p>
      {prepared.playabilityIssues.length > 0 && (
        <p className="import-note import-note--warning">
          Архив целостен, но игра требует настройки перед запуском: {prepared.playabilityIssues[0]}
          {prepared.playabilityIssues.length > 1 ? ` Ещё замечаний: ${prepared.playabilityIssues.length - 1}.` : ''}
        </p>
      )}

      {prepared.hasGameConflict ? (
        <div className="import-conflict">
          <strong>Эта же игра уже есть в библиотеке.</strong>
          <p>Её постоянный идентификатор совпадает с архивом. Выберите, что сделать.</p>
          <div className="import-dialog__actions">
            <button className="primary-button" onClick={() => onImport('replace')}>Заменить существующую</button>
            <button className="secondary-button" onClick={() => onImport('copy')}>Импортировать как копию</button>
            <button className="text-button" onClick={onCancel}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="import-dialog__actions">
          <button className="primary-button" onClick={() => onImport('copy')}>Импортировать игру</button>
          <button className="secondary-button" onClick={onCancel}>Отмена</button>
        </div>
      )}
    </Dialog>
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
