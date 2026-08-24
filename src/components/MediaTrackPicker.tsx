import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import { $mediaTracks, mediaTrackAdded } from '../model/game';
import { createAudioAsset, createMediaTrack } from '../model/defaults';
import { AUDIO_FILE_ACCEPT } from '../lib/audio';
import { getErrorMessage } from '../lib/errors';
import { normalizeSearchText } from '../lib/search';
import {
  PickerDialog,
  PickerEmpty,
  PickerFooterAction,
  PickerList,
  PickerRow,
  PickerToolbar,
} from './PickerDialog';

const PICKER_PAGE_SIZE = 100;

export function MediaTrackPicker({
  currentTrackId,
  onSelect,
  onClose,
}: {
  currentTrackId?: string;
  onSelect: (trackId?: string) => void;
  onClose: () => void;
}) {
  const tracks = useUnit($mediaTracks);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PICKER_PAGE_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const normalized = normalizeSearchText(query);
    return normalized ? tracks.filter((track) => normalizeSearchText(track.name).includes(normalized)) : tracks;
  }, [query, tracks]);

  useEffect(() => {
    setVisibleCount(PICKER_PAGE_SIZE);
  }, [query]);

  const visibleTracks = filtered.slice(0, visibleCount);

  const upload = async (file?: File) => {
    if (!file) return;
    try {
      setBusy(true);
      const audioAsset = await createAudioAsset(file);
      const track = createMediaTrack(audioAsset, file.name.replace(/\.[^.]+$/, ''));
      mediaTrackAdded({ track, audioAsset });
      onSelect(track.id);
    } catch (error) {
      window.alert(getErrorMessage(error, 'Не удалось добавить аудиотрек.'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <PickerDialog eyebrow="Общая медиатека" title="Выберите аудиотрек" onClose={onClose} className="media-track-picker">
      <PickerToolbar>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск аудиотрека…" />
        <button className="secondary-button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Проверяем…' : '+ Загрузить новый'}</button>
        <input ref={inputRef} className="hidden-file-input" type="file" accept={AUDIO_FILE_ACCEPT} onChange={(event) => void upload(event.target.files?.[0])} />
      </PickerToolbar>

      <PickerList>
        {filtered.length === 0 ? (
          <PickerEmpty>Аудиотреков пока нет. Можно загрузить новый прямо здесь.</PickerEmpty>
        ) : visibleTracks.map((track) => (
          <PickerRow
            key={track.id}
            selected={track.id === currentTrackId}
            onClick={() => onSelect(track.id)}
            primary={track.name}
            secondary="Независимый аудиотрек"
            meta={track.id === currentTrackId ? 'Выбран' : 'Выбрать'}
          />
        ))}
        {visibleTracks.length < filtered.length && (
          <button className="secondary-button media-load-more" onClick={() => setVisibleCount((count) => count + PICKER_PAGE_SIZE)}>Показать ещё</button>
        )}
      </PickerList>

      {currentTrackId && (
        <PickerFooterAction>
          <button className="text-button" onClick={() => onSelect(undefined)}>Убрать аудиотрек</button>
        </PickerFooterAction>
      )}
    </PickerDialog>
  );
}
