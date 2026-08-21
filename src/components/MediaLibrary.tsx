import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $audioAssets,
  $games,
  $persistedState,
  $songs,
  persistedStateImportFx,
  songAudioChanged,
  songChanged,
  songDeleteRequested,
} from '../model/game';
import { createAudioAsset } from '../model/defaults';
import type { AudioAsset } from '../model/types';
import {
  downloadBlob,
  exportLibraryPackage,
  finalizeLibraryImport,
  parseMelodyPackage,
  prepareMediaMerge,
  type PreparedMediaMerge,
} from '../lib/melodyPackage';
import { ActionMenu } from './ActionMenu';
import { SongForm } from './SongForm';
import { useEscapeClose } from './useEscapeClose';

export function MediaLibrary() {
  const [songs, audioAssets, games, persistedState] = useUnit([$songs, $audioAssets, $games, $persistedState]);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [pendingImport, setPendingImport] = useState<PreparedMediaMerge | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return songs;
    return songs.filter((song) => `${song.artist} ${song.title}`.toLowerCase().includes(normalized));
  }, [query, songs]);

  const audioById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);
  const usageBySongId = useMemo(() => {
    const result = new Map<string, Array<{ gameId: string; title: string; count: number }>>();
    for (const game of games) {
      const counts = new Map<string, number>();
      for (const round of game.rounds) {
        for (const category of round.categories) {
          for (const question of category.questions) {
            if (question.songId) counts.set(question.songId, (counts.get(question.songId) ?? 0) + 1);
          }
        }
      }
      for (const [songId, count] of counts) {
        const entries = result.get(songId) ?? [];
        entries.push({ gameId: game.id, title: game.title, count });
        result.set(songId, entries);
      }
    }
    return result;
  }, [games]);

  const exportLibrary = async () => {
    try {
      setBusy('export');
      const result = await exportLibraryPackage(songs, persistedState.audioAssets);
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      window.alert(errorMessage(error, 'Не удалось экспортировать медиатеку.'));
    } finally {
      setBusy(null);
    }
  };

  const selectImportFile = async (file?: File) => {
    if (!file) return;
    try {
      setBusy('import');
      const packageData = await parseMelodyPackage(file);
      if (packageData.manifest.type !== 'melody-library') {
        throw new Error('Это архив отдельной игры. Импортируйте его на экране «Мои игры».');
      }
      const prepared = await prepareMediaMerge(packageData, songs, persistedState.audioAssets);
      setPendingImport(prepared);
    } catch (error) {
      window.alert(errorMessage(error, 'Не удалось импортировать медиатеку.'));
    } finally {
      setBusy(null);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const applyLibraryImport = async () => {
    if (!pendingImport) return;
    try {
      setBusy('import');
      await persistedStateImportFx(finalizeLibraryImport(pendingImport, persistedState));
      setPendingImport(null);
    } catch (error) {
      window.alert(errorMessage(error, 'Не удалось сохранить импортированную медиатеку.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="media-page page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Общая библиотека</span>
          <h1>Медиатека</h1>
          <p>Песня загружается один раз и затем может использоваться в любом количестве игр.</p>
        </div>
        <div className="page-heading__actions">
          <button className="primary-button" onClick={() => setAdding((value) => !value)}>{adding ? 'Закрыть' : '+ Добавить песню'}</button>
          <ActionMenu className="action-menu--heading" label="Действия с медиатекой">
            <button disabled={busy !== null || songs.length === 0} onClick={() => void exportLibrary()}>
              {busy === 'export' ? 'Экспорт…' : 'Экспортировать медиатеку'}
            </button>
            <button disabled={busy !== null} onClick={() => importInputRef.current?.click()}>
              {busy === 'import' ? 'Проверяем архив…' : 'Импортировать медиатеку'}
            </button>
          </ActionMenu>
          <input
            ref={importInputRef}
            className="hidden-file-input"
            type="file"
            accept=".melody-library,application/zip"
            onChange={(event) => void selectImportFile(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="backup-hint">
        Экспорт медиатеки сохраняет все песни, минусы и плюсы в один переносимый архив. При импорте уже существующие аудиофайлы распознаются автоматически и не дублируются.
      </div>

      {adding && <section className="media-create-panel"><SongForm onCreated={() => setAdding(false)} /></section>}

      <div className="media-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по исполнителю или названию…" />
        <span>{filtered.length} из {songs.length}</span>
      </div>

      {songs.length === 0 ? (
        <div className="empty-state">
          <h2>Медиатека пока пустая</h2>
          <p>Добавьте первую песню. Её можно будет назначать вопросам во всех играх.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <h2>Ничего не найдено</h2>
          <p>Попробуйте изменить запрос или очистить строку поиска.</p>
          <button className="secondary-button" onClick={() => setQuery('')}>Очистить поиск</button>
        </div>
      ) : (
        <section className="media-list">
          {filtered.map((song) => {
            const minus = song.minusAudioId ? audioById.get(song.minusAudioId) : undefined;
            const plus = song.plusAudioId ? audioById.get(song.plusAudioId) : undefined;
            const usages = usageBySongId.get(song.id) ?? [];
            return (
              <article className="media-song-card" key={song.id}>
                <div className="media-song-card__main">
                  <label className="field">
                    <span>Исполнитель</span>
                    <input value={song.artist} onChange={(event) => songChanged({ songId: song.id, patch: { artist: event.target.value } })} />
                  </label>
                  <label className="field">
                    <span>Название</span>
                    <input value={song.title} onChange={(event) => songChanged({ songId: song.id, patch: { title: event.target.value } })} />
                  </label>
                </div>

                <div className="media-audio-grid">
                  <StoredAudioField songId={song.id} kind="minus" label="Минус" asset={minus} usedInGames={usages.length > 0} />
                  <StoredAudioField songId={song.id} kind="plus" label="Плюс" asset={plus} usedInGames={usages.length > 0} />
                </div>

                <div className="media-song-card__footer">
                  <div className="song-usage">
                    {usages.length === 0 ? (
                      <span>Не используется в играх</span>
                    ) : (
                      <span title={usages.map((usage) => `${usage.title}: ${usage.count}`).join('\n')}>
                        Используется: {usages.map((usage) => usage.title).join(', ')}
                      </span>
                    )}
                  </div>
                  <button
                    className="danger-ghost"
                    title="Удалить песню"
                    onClick={() => {
                      const usageCount = usages.reduce((total, usage) => total + usage.count, 0);
                      const usageWarning = usageCount > 0
                        ? `\n\nПесня назначена ${usageCount} ${usageCount === 1 ? 'вопросу' : 'вопросам'} в ${usages.length} ${usages.length === 1 ? 'игре' : 'играх'}. Она будет автоматически снята с этих вопросов.`
                        : '';
                      if (window.confirm(`Удалить «${song.artist} — ${song.title}» из медиатеки?${usageWarning}`)) songDeleteRequested(song.id);
                    }}
                  >
                    Удалить песню
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {pendingImport && (
        <LibraryImportDialog
          prepared={pendingImport}
          onCancel={() => setPendingImport(null)}
          onImport={() => void applyLibraryImport()}
        />
      )}
    </main>
  );
}

function LibraryImportDialog({ prepared, onCancel, onImport }: { prepared: PreparedMediaMerge; onCancel: () => void; onImport: () => void }) {
  const stats = prepared.stats;
  useEscapeClose(onCancel);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-label="Импорт медиатеки">
        <div className="import-dialog__header">
          <div><span className="eyebrow">Проверка завершена</span><h2>Импорт медиатеки</h2></div>
          <button className="icon-button" onClick={onCancel}>×</button>
        </div>
        <LibraryImportSummary stats={stats} />
        <p className="import-note">Существующие песни и аудиофайлы переиспользуются автоматически, поэтому дубликаты в медиатеке не создаются.</p>
        <div className="import-dialog__actions">
          <button className="primary-button" onClick={onImport}>Добавить в медиатеку</button>
          <button className="secondary-button" onClick={onCancel}>Отмена</button>
        </div>
      </section>
    </div>
  );
}

function LibraryImportSummary({ stats }: { stats: PreparedMediaMerge['stats'] }) {
  const songsTotal = stats.newSongs + stats.reusedSongs;
  const audioTotal = stats.newAudio + stats.reusedAudio;

  return (
    <div className="import-verification">
      <div className="import-verification__status">
        <span className="import-verification__icon" aria-hidden="true">✓</span>
        <div>
          <strong>Медиатека готова к импорту</strong>
          <ul className="import-check-list">
            <li>Архив не повреждён</li>
            <li>Структура данных проверена</li>
            <li>Все вложенные аудиофайлы доступны</li>
          </ul>
        </div>
      </div>
      <div className="import-verification__content">
        <strong className="import-section-title">Что будет добавлено</strong>
        <div className="import-summary-grid">
          <div className="import-summary-card">
            <span>Песни</span>
            <strong>{songsTotal} всего</strong>
            <small>{stats.reusedSongs} уже есть · {stats.newSongs} новых</small>
          </div>
          <div className="import-summary-card">
            <span>Аудиофайлы</span>
            <strong>{audioTotal} всего</strong>
            <small>{stats.reusedAudio} уже есть · {stats.newAudio} новых</small>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoredAudioField({ songId, kind, label, asset, usedInGames }: { songId: string; kind: 'minus' | 'plus'; label: string; asset?: AudioAsset; usedInGames: boolean }) {
  return (
    <div className="stored-audio-field">
      <div className="stored-audio-field__head"><strong>{label}</strong><span>{asset?.name ?? 'не загружен'}</span></div>
      {asset && <AudioPreview asset={asset} />}
      <div className="inline-actions">
        <label className="secondary-button file-button">
          {asset ? 'Заменить' : 'Загрузить'}
          <input
            type="file"
            accept="audio/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) songAudioChanged({ songId, kind, asset: createAudioAsset(file) });
              event.currentTarget.value = '';
            }}
          />
        </label>
        {asset && <button className="text-button" onClick={() => {
          if (usedInGames && !window.confirm(`Эта песня используется в играх. После удаления ${label.toLowerCase()} эти игры не запустятся, пока вы не загрузите файл заново. Продолжить?`)) return;
          songAudioChanged({ songId, kind, asset: undefined });
        }}>Удалить файл</button>}
      </div>
    </div>
  );
}

function AudioPreview({ asset }: { asset: AudioAsset }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState<string>();

  useEffect(() => {
    const url = URL.createObjectURL(asset.blob);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [asset]);

  return source ? <audio ref={audioRef} className="media-audio-preview" src={source} controls preload="metadata" /> : null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
