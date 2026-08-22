import { useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $audioAssets,
  $games,
  $mediaTracks,
  $persistedState,
  $songs,
  mediaTrackAdded,
  mediaTrackAudioChanged,
  mediaTrackChanged,
  mediaTrackDeleteRequested,
  persistedStateImportFx,
  songChanged,
  songDeleteRequested,
  songDuplicated,
  songTrackChanged,
} from '../model/game';
import { createAudioAsset, createMediaTrack } from '../model/defaults';
import type { AudioAsset, MediaTrack, Song } from '../model/types';
import { DATA_LIMITS } from '../model/limits';
import {
  downloadBlob,
  exportLibraryPackage,
  finalizeLibraryImport,
  parseMelodyPackage,
  prepareMediaMerge,
  type ParsedMelodyPackage,
  type PreparedMediaMerge,
} from '../lib/melodyPackage';
import { AUDIO_FILE_ACCEPT } from '../lib/audio';
import { getErrorMessage } from '../lib/errors';
import { formatBytes } from '../lib/format';
import { normalizeSearchText } from '../lib/search';
import { buildMediaTrackUsageMap, buildSongUsageMap, type MediaTrackUsage, type SongUsage } from '../model/media/selectors';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { ActionMenu } from './ActionMenu';
import { SongForm } from './SongForm';
import { Dialog } from './Dialog';
import { ImportVerificationSummary } from './ImportVerificationSummary';

type MediaTab = 'songs' | 'audio';

export function MediaLibrary() {
  const [songs, mediaTracks, audioAssets, games, persistedState] = useUnit([$songs, $mediaTracks, $audioAssets, $games, $persistedState]);
  const [tab, setTab] = useState<MediaTab>('songs');
  const [query, setQuery] = useState('');
  const [addingSong, setAddingSong] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [pendingImport, setPendingImport] = useState<{ packageData: ParsedMelodyPackage; preview: PreparedMediaMerge } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const audioById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const usageBySongId = useMemo(() => buildSongUsageMap(games), [games]);
  const trackUsage = useMemo(() => buildMediaTrackUsageMap(games, songs), [games, songs]);

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

  const exportLibrary = async () => {
    try {
      setBusy('export');
      const result = await exportLibraryPackage(songs, persistedState.mediaTracks, persistedState.audioAssets);
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      window.alert(getErrorMessage(error, 'Не удалось экспортировать медиатеку.'));
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
      window.alert(getErrorMessage(error, 'Не удалось импортировать медиатеку.'));
    } finally {
      setBusy(null);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const applyLibraryImport = async () => {
    if (!pendingImport) return;
    try {
      setBusy('import');
      const latestPrepared = await prepareMediaMerge(
        pendingImport.packageData,
        persistedState.songs,
        persistedState.mediaTracks,
        persistedState.audioAssets,
      );
      await persistedStateImportFx(finalizeLibraryImport(latestPrepared, persistedState));
      setPendingImport(null);
    } catch (error) {
      window.alert(getErrorMessage(error, 'Не удалось сохранить импортированную медиатеку.'));
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
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tab === 'songs' ? 'Поиск по исполнителю или названию…' : 'Поиск по названию трека или имени файла…'}
        />
        <span>{filteredCount} из {totalForTab}</span>
      </div>

      {tab === 'songs' ? (
        <SongList
          songs={filteredSongs}
          allSongsCount={songs.length}
          mediaTracks={mediaTracks}
          trackById={trackById}
          audioById={audioById}
          usageBySongId={usageBySongId}
          query={query}
          onClearQuery={() => setQuery('')}
        />
      ) : (
        <TrackList
          tracks={filteredTracks}
          allTracksCount={mediaTracks.length}
          audioById={audioById}
          usageByTrackId={trackUsage}
          query={query}
          onClearQuery={() => setQuery('')}
        />
      )}

      {pendingImport && <LibraryImportDialog prepared={pendingImport.preview} onCancel={() => setPendingImport(null)} onImport={() => void applyLibraryImport()} />}
    </main>
  );
}

function SongList({
  songs,
  allSongsCount,
  mediaTracks,
  trackById,
  audioById,
  usageBySongId,
  query,
  onClearQuery,
}: {
  songs: Song[];
  allSongsCount: number;
  mediaTracks: MediaTrack[];
  trackById: Map<string, MediaTrack>;
  audioById: Map<string, AudioAsset>;
  usageBySongId: Map<string, SongUsage[]>;
  query: string;
  onClearQuery: () => void;
}) {
  if (allSongsCount === 0) return <div className="empty-state"><h2>Песен пока нет</h2><p>Добавьте первую песню для обычных раундов или перейдите во вкладку «Аудио» для самостоятельных треков.</p></div>;
  if (songs.length === 0 && query) return <NoResults onClear={onClearQuery} />;

  return (
    <section className="media-list">
      {songs.map((song) => {
        const minusTrack = song.minusTrackId ? trackById.get(song.minusTrackId) : undefined;
        const plusTrack = song.plusTrackId ? trackById.get(song.plusTrackId) : undefined;
        const usages = usageBySongId.get(song.id) ?? [];
        return (
          <article className="media-song-card" key={song.id}>
            <div className="media-song-card__main">
              <label className="field"><span>Исполнитель</span><input maxLength={DATA_LIMITS.text.artist} value={song.artist} onChange={(event) => songChanged({ songId: song.id, patch: { artist: event.target.value } })} /></label>
              <label className="field"><span>Название</span><input maxLength={DATA_LIMITS.text.songTitle} value={song.title} onChange={(event) => songChanged({ songId: song.id, patch: { title: event.target.value } })} /></label>
            </div>

            {usages.length > 0 && <div className="backup-hint">Изменение исполнителя, названия или назначенных треков затронет {usages.length} {usages.length === 1 ? 'игру' : 'игры'}, где эта песня используется.</div>}

            <div className="media-audio-grid">
              <StoredTrackField songId={song.id} kind="minus" label="Минус" suggestedName={songTrackLabel(song, 'минус')} track={minusTrack} asset={minusTrack ? audioById.get(minusTrack.audioId) : undefined} tracks={mediaTracks} usedInGames={usages.length > 0} />
              <StoredTrackField songId={song.id} kind="plus" label="Плюс" suggestedName={songTrackLabel(song, 'плюс')} track={plusTrack} asset={plusTrack ? audioById.get(plusTrack.audioId) : undefined} tracks={mediaTracks} usedInGames={usages.length > 0} />
            </div>

            <div className="media-song-card__footer">
              <div className="song-usage">
                {usages.length === 0 ? <span>Не используется в играх</span> : <span title={usages.map((usage) => `${usage.title}: ${usage.count}`).join('\n')}>Используется: {usages.map((usage) => usage.title).join(', ')}</span>}
              </div>
              <div className="media-song-card__footer-actions">
                <ActionMenu label={`Дополнительные действия для ${song.artist || 'исполнителя не указано'} — ${song.title || 'песни без названия'}`}>
                  <button onClick={() => songDuplicated(song.id)}>Создать отдельную копию</button>
                  <button className="action-menu__danger" onClick={() => {
                    const usageCount = usages.reduce((total, usage) => total + usage.count, 0);
                    const usageWarning = usageCount > 0 ? `\n\nПесня назначена ${usageCount} вопросам. Она будет автоматически снята с этих вопросов.` : '';
                    if (window.confirm(`Удалить «${song.artist} — ${song.title}» из медиатеки?${usageWarning}\n\nСвязанные аудиотреки останутся в разделе «Аудио».`)) songDeleteRequested(song.id);
                  }}>Удалить песню</button>
                </ActionMenu>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function TrackList({ tracks, allTracksCount, audioById, usageByTrackId, query, onClearQuery }: {
  tracks: MediaTrack[];
  allTracksCount: number;
  audioById: Map<string, AudioAsset>;
  usageByTrackId: Map<string, MediaTrackUsage[]>;
  query: string;
  onClearQuery: () => void;
}) {
  if (allTracksCount === 0) return <div className="empty-state"><h2>Аудиотреков пока нет</h2><p>Здесь могут храниться любые звуки: песни, фрагменты, заставки, mashup или аудио для будущих межраундов.</p></div>;
  if (tracks.length === 0 && query) return <NoResults onClear={onClearQuery} />;

  return (
    <section className="media-list media-track-list">
      {tracks.map((track) => {
        const asset = audioById.get(track.audioId);
        const usages = usageByTrackId.get(track.id) ?? [];
        return (
          <article className="media-song-card media-track-card" key={track.id}>
            <div className="media-track-card__header">
              <label className="field">
                <span>Название в медиатеке</span>
                <input maxLength={DATA_LIMITS.text.mediaTrackName} value={track.name} onChange={(event) => mediaTrackChanged({ trackId: track.id, patch: { name: event.target.value } })} />
              </label>
              <div className="media-track-file"><span>Файл</span><strong title={asset?.name}>{asset?.name ?? 'Файл отсутствует'}</strong><small>{asset ? formatBytes(asset.blob.size) : '—'}</small></div>
            </div>
            {asset && <AudioPreview asset={asset} />}
            <div className="media-song-card__footer">
              <div className="song-usage">
                {usages.length === 0 ? <span>Свободный трек — пока нигде не используется</span> : <span title={usages.map((usage) => `${usage.label}: ${usage.role}`).join('\n')}>Используется: {usages.map((usage) => usage.label).join(', ')}</span>}
              </div>
              <div className="media-song-card__footer-actions">
                <label className="secondary-button file-button" title="Заменить физический файл, сохранив этот медиатрек и все ссылки на него">
                  Заменить файл
                  <input type="file" accept={AUDIO_FILE_ACCEPT} onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = '';
                    if (!file) return;
                    if (usages.length > 0 && !window.confirm(`Аудиотрек «${track.name}» используется в ${usages.length} местах. Заменить файл во всех этих местах?`)) return;
                    void createAudioAsset(file)
                      .then((audioAsset) => mediaTrackAudioChanged({ trackId: track.id, audioAsset }))
                      .catch((replaceError) => window.alert(getErrorMessage(replaceError, 'Не удалось заменить аудиофайл.')));
                  }} />
                </label>
                <button
                  className="danger-ghost"
                  disabled={usages.length > 0}
                  title={usages.length > 0 ? 'Сначала уберите этот трек из всех песен и межраундов' : 'Удалить медиатрек'}
                  onClick={() => { if (window.confirm(`Удалить аудиотрек «${track.name}»? Если физический файл больше нигде не используется, он также будет удалён из IndexedDB.`)) mediaTrackDeleteRequested(track.id); }}
                >Удалить аудио</button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function StoredTrackField({ songId, kind, label, suggestedName, track, asset, tracks, usedInGames }: {
  songId: string;
  kind: 'minus' | 'plus';
  label: string;
  suggestedName: string;
  track?: MediaTrack;
  asset?: AudioAsset;
  tracks: MediaTrack[];
  usedInGames: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replaceFile = async (file: File) => {
    if (usedInGames && track && !window.confirm(`Эта песня используется в играх. Назначить ей новый ${label.toLowerCase()}? Старый аудиотрек останется в общей медиатеке.`)) return;
    setBusy(true);
    setError(null);
    try {
      const nextAsset = await createAudioAsset(file);
      const nextTrack = createMediaTrack(nextAsset, suggestedName || file.name);
      songTrackChanged({ songId, kind, track: nextTrack, audioAsset: nextAsset });
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : 'Не удалось загрузить аудиофайл.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stored-audio-field">
      <div className="stored-audio-field__head"><strong>{label}</strong><span>{track?.name ?? 'не выбран'}</span></div>
      <select value={track?.id ?? ''} onChange={(event) => {
        const trackId = event.target.value || undefined;
        if (usedInGames && trackId !== track?.id && !window.confirm(`Изменить ${label.toLowerCase()} у песни, которая уже используется в игре?`)) return;
        songTrackChanged({ songId, kind, trackId });
      }}>
        <option value="">Не выбран</option>
        {tracks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {asset && <AudioPreview asset={asset} />}
      {error && <small className="missing-audio" role="alert">{error}</small>}
      <div className="inline-actions">
        <label className="secondary-button file-button">
          {busy ? 'Проверяем…' : track ? 'Загрузить другой файл' : 'Загрузить новый'}
          <input type="file" disabled={busy} accept={AUDIO_FILE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void replaceFile(file); event.currentTarget.value = ''; }} />
        </label>
        {track && <button className="text-button" disabled={busy} onClick={() => {
          if (usedInGames && !window.confirm(`Убрать ${label.toLowerCase()} из этой песни? Игра не запустится, пока трек не будет назначен снова. Сам аудиотрек останется в медиатеке.`)) return;
          songTrackChanged({ songId, kind });
        }}>Убрать из песни</button>}
      </div>
      {asset && <small className="media-track-origin" title={asset.name}>Файл: {asset.name}</small>}
    </div>
  );
}

function AudioTrackForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await createAudioAsset(file);
      const track = createMediaTrack(asset, name.trim() || file.name);
      mediaTrackAdded({ track, audioAsset: asset });
      setName('');
      setFile(undefined);
      onCreated();
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось добавить аудиотрек.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="song-form">
      <div className="song-form-grid media-track-create-grid">
        <label className="field"><span>Название в медиатеке</span><input maxLength={DATA_LIMITS.text.mediaTrackName} value={name} onChange={(event) => setName(event.target.value)} placeholder="Можно оставить пустым — возьмём имя файла" /></label>
        <div className="audio-upload"><span>Аудиофайл</span><label className={file ? 'file-picker file-picker--ready' : 'file-picker'}><input type="file" accept={AUDIO_FILE_ACCEPT} onChange={(event) => { setFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /><span className="file-picker__title">{file ? '✓ Выбран' : 'Загрузить'}</span><small title={file?.name}>{file?.name ?? 'MP3, WAV, OGG, FLAC, M4A…'}</small></label></div>
      </div>
      {error && <p className="missing-audio" role="alert">{error}</p>}
      <div className="inline-actions"><button className="primary-button" disabled={!file || busy} onClick={() => void submit()}>{busy ? 'Проверяем аудио…' : 'Добавить аудио'}</button></div>
    </div>
  );
}

function LibraryImportDialog({ prepared, onCancel, onImport }: { prepared: PreparedMediaMerge; onCancel: () => void; onImport: () => void }) {
  return (
    <Dialog
      eyebrow="Проверка завершена"
      title="Импорт медиатеки"
      onClose={onCancel}
      className="import-dialog"
    >
      <ImportVerificationSummary
        title="Медиатека готова к импорту"
        stats={prepared.stats}
        checks={[
          'Архив не повреждён',
          'Связи песен и аудиотреков проверены',
          'Все вложенные аудиофайлы доступны',
        ]}
        sectionTitle="Что будет добавлено"
      />
      <div className="import-dialog__actions">
        <button className="primary-button" onClick={onImport}>Добавить в медиатеку</button>
        <button className="secondary-button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  );
}

function AudioPreview({ asset }: { asset: AudioAsset }) {
  const source = useObjectUrl(asset.blob);
  return source ? <audio className="media-audio-preview" src={source} controls preload="metadata" /> : null;
}

function NoResults({ onClear }: { onClear: () => void }) {
  return <div className="empty-state"><h2>Ничего не найдено</h2><p>Попробуйте изменить запрос или очистить строку поиска.</p><button className="secondary-button" onClick={onClear}>Очистить поиск</button></div>;
}


function songTrackLabel(song: Song, role: 'минус' | 'плюс') {
  const songLabel = [song.artist.trim(), song.title.trim()].filter(Boolean).join(' — ');
  return songLabel ? `${songLabel} (${role})` : '';
}
