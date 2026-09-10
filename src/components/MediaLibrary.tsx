import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $audioAssets,
  $audioProjects,
  $games,
  $mediaTracks,
  $persistedState,
  $songs,
  persistedStateImportFx,
} from '../model/game';
import {
  downloadBlob,
  exportLibraryPackage,
  finalizeLibraryImport,
  parseMelodyPackage,
  prepareMediaMerge,
  type ParsedMelodyPackage,
  type PreparedMediaMerge,
} from '../lib/melodyPackage';
import { getErrorMessage } from '../lib/errors';
import { normalizeSearchText } from '../lib/search';
import { buildMediaTrackUsageMap, buildSongUsageMap } from '../model/media';
import { ActionMenu } from './ActionMenu';
import { SongForm } from './SongForm';
import { useFeedback } from './feedback/FeedbackProvider';
import { AudioTrackForm } from './media/AudioTrackForm';
import { LibraryImportDialog } from './media/LibraryImportDialog';
import { SongList } from './media/SongList';
import { TrackList } from './media/TrackList';

type MediaTab = 'songs' | 'audio';
const MEDIA_PAGE_SIZE = 50;

export function MediaLibrary() {
  const [songs, mediaTracks, audioAssets, audioProjects, games, persistedState] = useUnit([$songs, $mediaTracks, $audioAssets, $audioProjects, $games, $persistedState]);
  const { notify } = useFeedback();
  const [tab, setTab] = useState<MediaTab>('songs');
  const [query, setQuery] = useState('');
  const [addingSong, setAddingSong] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [pendingImport, setPendingImport] = useState<{ packageData: ParsedMelodyPackage; preview: PreparedMediaMerge } | null>(null);
  const [visibleCount, setVisibleCount] = useState(MEDIA_PAGE_SIZE);
  const importInputRef = useRef<HTMLInputElement>(null);

  const audioById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const usageBySongId = useMemo(() => buildSongUsageMap(games), [games]);
  const trackUsage = useMemo(() => buildMediaTrackUsageMap(games, songs, audioProjects), [audioProjects, games, songs]);

  const filteredSongs = useMemo(() => {
    const normalized = normalizeSearchText(query);
    if (!normalized) return songs;
    return songs.filter((song) => normalizeSearchText(`${song.artist} ${song.title}`).includes(normalized));
  }, [query, songs]);

  const filteredTracks = useMemo(() => {
    const normalized = normalizeSearchText(query);
    if (!normalized) return mediaTracks;
    return mediaTracks.filter((track) => {
      const asset = audioById.get(track.audioId);
      return normalizeSearchText(`${track.name} ${asset?.name ?? ''}`).includes(normalized);
    });
  }, [audioById, mediaTracks, query]);

  useEffect(() => {
    setVisibleCount(MEDIA_PAGE_SIZE);
  }, [tab, query]);

  const visibleSongs = filteredSongs.slice(0, visibleCount);
  const visibleTracks = filteredTracks.slice(0, visibleCount);

  const exportLibrary = async () => {
    try {
      setBusy('export');
      const result = await exportLibraryPackage(songs, persistedState.mediaTracks, persistedState.audioAssets);
      downloadBlob(result.blob, result.filename);
      notify({ kind: 'success', message: 'Медиатека экспортирована.' });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось экспортировать медиатеку', message: getErrorMessage(error, 'Попробуйте ещё раз.') });
    } finally {
      setBusy(null);
    }
  };

  const selectImportFile = async (file?: File) => {
    if (!file) return;
    try {
      setBusy('import');
      const packageData = await parseMelodyPackage(file);
      if (packageData.manifest.type !== 'melody-library') throw new Error('Это архив отдельной игры. Импортируйте его на экране «Мои игры».');
      const preview = await prepareMediaMerge(packageData, songs, mediaTracks, persistedState.audioAssets);
      setPendingImport({ packageData, preview });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось импортировать медиатеку', message: getErrorMessage(error, 'Проверьте архив и попробуйте ещё раз.') });
    } finally {
      setBusy(null);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const applyLibraryImport = async () => {
    if (!pendingImport) return;
    try {
      setBusy('import');
      await persistedStateImportFx(async (current) => {
        const prepared = await prepareMediaMerge(pendingImport.packageData, current.songs, current.mediaTracks, current.audioAssets);
        return finalizeLibraryImport(prepared, current);
      });
      setPendingImport(null);
      notify({ kind: 'success', message: 'Медиатека импортирована.' });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось сохранить импортированную медиатеку', message: getErrorMessage(error, 'Попробуйте ещё раз.') });
    } finally {
      setBusy(null);
    }
  };

  const totalForTab = tab === 'songs' ? songs.length : mediaTracks.length;
  const filteredCount = tab === 'songs' ? filteredSongs.length : filteredTracks.length;

  return (
    <main className="media-page page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Общая библиотека</span>
          <h1>Медиатека</h1>
          <p>Песни для обычных раундов и независимые аудиотреки хранятся в одной общей библиотеке.</p>
        </div>
        <div className="page-heading__actions">
          {tab === 'songs' ? (
            <button className="primary-button" onClick={() => setAddingSong((value) => !value)}>{addingSong ? 'Закрыть' : '+ Добавить песню'}</button>
          ) : (
            <button className="primary-button" onClick={() => setAddingTrack((value) => !value)}>{addingTrack ? 'Закрыть' : '+ Добавить аудио'}</button>
          )}
          <ActionMenu className="action-menu--heading" label="Действия с медиатекой">
            <button disabled={busy !== null || (songs.length === 0 && mediaTracks.length === 0)} onClick={() => void exportLibrary()}>
              {busy === 'export' ? 'Экспорт…' : 'Экспортировать медиатеку'}
            </button>
            <button disabled={busy !== null} onClick={() => importInputRef.current?.click()}>
              {busy === 'import' ? 'Проверяем архив…' : 'Импортировать медиатеку'}
            </button>
          </ActionMenu>
          <input ref={importInputRef} className="hidden-file-input" type="file" accept=".melody-library,application/zip" onChange={(event) => void selectImportFile(event.target.files?.[0])} />
        </div>
      </div>

      <div className="backup-hint">
        <strong>Как устроено хранение:</strong> физический файл сохраняется один раз по SHA-256. «Аудио» — это переиспользуемые треки, а «Песня» связывает исполнитель/название с минусом и плюсом.
      </div>

      <nav className="media-tabs" aria-label="Разделы медиатеки">
        <button className={tab === 'songs' ? 'media-tab media-tab--active' : 'media-tab'} onClick={() => { setTab('songs'); setQuery(''); setAddingTrack(false); }}>
          <strong>Песни</strong><span>{songs.length}</span>
        </button>
        <button className={tab === 'audio' ? 'media-tab media-tab--active' : 'media-tab'} onClick={() => { setTab('audio'); setQuery(''); setAddingSong(false); }}>
          <strong>Аудио</strong><span>{mediaTracks.length}</span>
        </button>
      </nav>

      {tab === 'songs' && addingSong && <section className="media-create-panel"><SongForm onCreated={() => setAddingSong(false)} /></section>}
      {tab === 'audio' && addingTrack && <section className="media-create-panel"><AudioTrackForm onCreated={() => setAddingTrack(false)} /></section>}

      <div className="media-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'songs' ? 'Поиск по исполнителю или названию…' : 'Поиск по названию трека или имени файла…'} />
        <span>{filteredCount} из {totalForTab}</span>
      </div>

      {tab === 'songs' ? (
        <SongList
          songs={visibleSongs}
          allSongsCount={songs.length}
          trackById={trackById}
          audioById={audioById}
          usageBySongId={usageBySongId}
          query={query}
          onClearQuery={() => setQuery('')}
          hasMore={visibleSongs.length < filteredSongs.length}
          onLoadMore={() => setVisibleCount((count) => count + MEDIA_PAGE_SIZE)}
        />
      ) : (
        <TrackList
          tracks={visibleTracks}
          allTracksCount={mediaTracks.length}
          audioById={audioById}
          usageByTrackId={trackUsage}
          query={query}
          onClearQuery={() => setQuery('')}
          hasMore={visibleTracks.length < filteredTracks.length}
          onLoadMore={() => setVisibleCount((count) => count + MEDIA_PAGE_SIZE)}
        />
      )}

      {pendingImport && <LibraryImportDialog busy={busy === 'import'} prepared={pendingImport.preview} onCancel={() => { if (busy !== 'import') setPendingImport(null); }} onImport={() => void applyLibraryImport()} />}
    </main>
  );
}
