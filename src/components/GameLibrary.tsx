import { useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $audioAssets,
  $games,
  $persistedState,
  $sessions,
  $songs,
  activeGameChanged,
  gameCreated,
  gameDeleted,
  gameDuplicated,
  gameRestarted,
  getGameStartIssues,
  getSessionContinuationIssues,
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
import { ActionMenu } from './ActionMenu';
import { useEscapeClose } from './useEscapeClose';

export function GameLibrary() {
  const [games, sessions, songs, audioAssets, persistedState] = useUnit([
    $games,
    $sessions,
    $songs,
    $audioAssets,
    $persistedState,
  ]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('Новая игра');
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ packageData: ParsedMelodyPackage; preview: PreparedGameImport } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const sortedGames = useMemo(() => [...games].sort((a, b) => b.updatedAt - a.updatedAt), [games]);

  const openGame = (gameId: string, screen: 'game' | 'admin') => {
    const game = games.find((item) => item.id === gameId);
    if (screen === 'game' && game) {
      const session = sessions[gameId];
      const finished = Boolean(session && session.roundIndex >= game.rounds.length);
      const issues = finished ? [] : hasSessionProgress(session)
        ? getSessionContinuationIssues(game, session, songs, audioAssets)
        : getGameStartIssues(game, songs, audioAssets);
      if (issues.length > 0) {
        window.alert(formatGameIssues(issues));
        activeGameChanged(gameId);
        screenChanged('admin');
        return;
      }
    }
    activeGameChanged(gameId);
    screenChanged(screen);
  };

  const startFresh = (gameId: string) => {
    const game = games.find((item) => item.id === gameId);
    if (!game) return;
    const issues = getGameStartIssues(game, songs, audioAssets);
    if (issues.length > 0) {
      window.alert(formatGameIssues(issues));
      activeGameChanged(gameId);
      screenChanged('admin');
      return;
    }
    if (hasSessionProgress(sessions[gameId]) && !window.confirm(`Начать «${game.title}» заново? Текущие баллы и прогресс партии будут сброшены.`)) return;
    activeGameChanged(gameId);
    gameRestarted();
    screenChanged('game');
  };

  const exportGame = async (game: GameConfig) => {
    try {
      setBusy(`export:${game.id}`);
      const result = await exportGamePackage(game, songs, persistedState.audioAssets);
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      window.alert(errorMessage(error, 'Не удалось экспортировать игру.'));
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
      window.alert(errorMessage(error, 'Не удалось прочитать архив игры.'));
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
      window.alert(errorMessage(error, 'Не удалось сохранить импортированную игру.'));
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
        <div className="page-heading__actions">
          <button className="secondary-button" disabled={busy !== null} onClick={() => importInputRef.current?.click()}>
            {busy === 'import' ? 'Проверяем архив…' : 'Импортировать игру'}
          </button>
          <input
            ref={importInputRef}
            className="hidden-file-input"
            type="file"
            accept=".melody,application/zip"
            onChange={(event) => void selectImportFile(event.target.files?.[0])}
          />
          <button className="primary-button" onClick={() => setCreating(true)}>+ Новая игра</button>
        </div>
      </div>

      <div className="backup-hint">
        <strong>Совет:</strong> экспорт игры создаёт переносимый архив с её настройками и всеми используемыми минусами/плюсами. Храните такой файл как резервную копию готового набора.
      </div>

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
        <div className="empty-state empty-state--actions">
          <h2>Сохранённых игр пока нет</h2>
          <p>Создайте новую игру или импортируйте готовый архив. Медиатека при этом может оставаться отдельной.</p>
          <div className="inline-actions">
            <button className="primary-button" onClick={() => setCreating(true)}>+ Создать игру</button>
            <button className="secondary-button" disabled={busy !== null} onClick={() => importInputRef.current?.click()}>Импортировать игру</button>
          </div>
        </div>
      ) : (
      <section className="game-library-grid">
        {sortedGames.map((game) => {
          const session = sessions[game.id];
          const hasProgress = hasSessionProgress(session);
          const finished = Boolean(session && session.roundIndex >= game.rounds.length);
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
                  <span className="eyebrow">{game.rounds.length} раундов · {assignedSongs}/{questionCount} песен</span>
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
                  <button className="primary-button" onClick={() => openGame(game.id, 'game')}>Результаты</button>
                ) : hasProgress ? (
                  <button className="primary-button" onClick={() => openGame(game.id, 'game')}>▶ Продолжить</button>
                ) : (
                  <button className="primary-button" onClick={() => openGame(game.id, 'game')}>▶ Играть</button>
                )}
                <button className="secondary-button" onClick={() => openGame(game.id, 'admin')}>Редактировать</button>
                <ActionMenu label={`Дополнительные действия для ${game.title || 'игры без названия'}`}>
                  {hasProgress && <button onClick={() => startFresh(game.id)}>Начать заново</button>}
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
  const stats = prepared.media.stats;
  useEscapeClose(onCancel);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-label="Импорт игры">
        <div className="import-dialog__header">
          <div><span className="eyebrow">Проверка завершена</span><h2>Импорт «{game.title}»</h2></div>
          <button className="icon-button" onClick={onCancel}>×</button>
        </div>

        <ImportVerificationSummary
          title={`Игра «${game.title}» готова к импорту`}
          stats={stats}
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
      </section>
    </div>
  );
}

function ImportVerificationSummary({
  title,
  stats,
}: {
  title: string;
  stats: PreparedGameImport['media']['stats'];
}) {
  const songsTotal = stats.newSongs + stats.reusedSongs + stats.deduplicatedSongs;
  const audioTotal = stats.newAudio + stats.reusedAudio;
  const nothingNew = stats.newSongs === 0 && stats.newAudio === 0;
  const songDetails = [
    `${stats.reusedSongs} уже в медиатеке`,
    `будет добавлено: ${stats.newSongs}`,
    stats.deduplicatedSongs > 0 ? `${stats.deduplicatedSongs} совпали внутри архива` : '',
  ].filter(Boolean).join(' · ');
  const audioDetails = [
    `${stats.reusedAudio} уже в медиатеке`,
    `будет добавлено: ${stats.newAudio}`,
    stats.internalAudioReuses > 0 ? `${stats.internalAudioReuses} повторных ссылок внутри архива` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="import-verification">
      <div className="import-verification__status">
        <span className="import-verification__icon" aria-hidden="true">✓</span>
        <div>
          <strong>{title}</strong>
          <ul className="import-check-list">
            <li>Архив не повреждён</li>
            <li>Структура данных проверена</li>
            <li>Все вложенные аудиофайлы доступны</li>
          </ul>
        </div>
      </div>

      <div className="import-verification__content">
        <strong className="import-section-title">Что будет импортировано</strong>
        <div className="import-summary-grid">
          <ImportSummaryCard label="Песни" total={songsTotal} details={songDetails} />
          <ImportSummaryCard label="Аудиофайлы" total={audioTotal} details={audioDetails} />
        </div>
        <p className="import-dedup-note">
          {nothingNew
            ? 'Все необходимые песни и аудиофайлы уже есть в медиатеке. Дубликаты созданы не будут.'
            : 'Существующие песни и аудиофайлы будут переиспользованы. В медиатеку добавится только новое содержимое.'}
        </p>
      </div>
    </div>
  );
}

function ImportSummaryCard({ label, total, details }: { label: string; total: number; details: string }) {
  return (
    <div className="import-summary-card">
      <span>{label}</span>
      <strong>{total} всего</strong>
      <small>{details}</small>
    </div>
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

function formatGameIssues(issues: string[]) {
  const visible = issues.slice(0, 8);
  const rest = issues.length - visible.length;
  return `Игра пока не готова к запуску:\n\n${visible.map((issue) => `• ${issue}`).join('\n')}${rest > 0 ? `\n• …и ещё ${rest}` : ''}\n\nИсправьте эти пункты в редакторе.`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
