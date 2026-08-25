import { useEffect, useMemo, useState } from 'react';
import { useUnit } from 'effector-react';
import { $songs } from '../model/game';
import { normalizeSearchText } from '../lib/search';
import { SongForm } from './SongForm';
import {
  PickerDialog,
  PickerEmpty,
  PickerFooterAction,
  PickerList,
  PickerRow,
  PickerToolbar,
} from './PickerDialog';

const SONG_PICKER_PAGE_SIZE = 100;

export function SongPicker({ currentSongId, onSelect, onClose }: {
  currentSongId?: string;
  onSelect: (songId?: string) => void;
  onClose: () => void;
}) {
  const songs = useUnit($songs);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [visibleCount, setVisibleCount] = useState(SONG_PICKER_PAGE_SIZE);

  const filtered = useMemo(() => {
    const normalized = normalizeSearchText(query);
    return normalized
      ? songs.filter((song) => normalizeSearchText(`${song.artist} ${song.title}`).includes(normalized))
      : songs;
  }, [query, songs]);

  useEffect(() => {
    setVisibleCount(SONG_PICKER_PAGE_SIZE);
  }, [query]);

  const visibleSongs = filtered.slice(0, visibleCount);

  return (
    <PickerDialog eyebrow="Медиатека" title={adding ? 'Новая песня' : 'Выберите песню'} onClose={onClose}>
      {adding ? (
        <SongForm compact onCreated={(songId) => onSelect(songId)} onCancel={() => setAdding(false)} />
      ) : (
        <>
          <PickerToolbar>
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск песни…" />
            <button className="secondary-button" onClick={() => setAdding(true)}>+ Новая песня</button>
          </PickerToolbar>

          <PickerList>
            {filtered.length === 0 ? (
              <PickerEmpty>Ничего не найдено.</PickerEmpty>
            ) : visibleSongs.map((song) => (
              <PickerRow
                key={song.id}
                selected={song.id === currentSongId}
                onClick={() => onSelect(song.id)}
                primary={song.artist || 'Без исполнителя'}
                secondary={song.title || 'Без названия'}
                meta={`${song.minusTrackId ? 'Минус ✓' : 'Нет минуса'} · ${song.plusTrackId ? 'Плюс ✓' : 'Нет плюса'}`}
              />
            ))}
            {visibleSongs.length < filtered.length && (
              <button className="secondary-button media-load-more" onClick={() => setVisibleCount((count) => count + SONG_PICKER_PAGE_SIZE)}>
                Показать ещё ({filtered.length - visibleSongs.length})
              </button>
            )}
          </PickerList>

          {currentSongId && (
            <PickerFooterAction>
              <button className="text-button" onClick={() => onSelect(undefined)}>Убрать песню из вопроса</button>
            </PickerFooterAction>
          )}
        </>
      )}
    </PickerDialog>
  );
}
