import { useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import { $mediaTracks, mediaTrackAdded } from '../model/game';
import { createAudioAsset, createMediaTrack } from '../model/defaults';
import { useEscapeClose } from './useEscapeClose';

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
  const inputRef = useRef<HTMLInputElement>(null);
  useEscapeClose(onClose);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    return normalized ? tracks.filter((track) => track.name.toLocaleLowerCase('ru-RU').includes(normalized)) : tracks;
  }, [query, tracks]);

  const upload = async (file?: File) => {
    if (!file) return;
    try {
      setBusy(true);
      const audioAsset = await createAudioAsset(file);
      const track = createMediaTrack(audioAsset, file.name.replace(/\.[^.]+$/, ''));
      mediaTrackAdded({ track, audioAsset });
      onSelect(track.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось добавить аудиотрек.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="song-picker-dialog media-track-picker" role="dialog" aria-modal="true" aria-label="Выбор аудиотрека">
        <div className="song-picker-dialog__header">
          <div><span className="eyebrow">Общая медиатека</span><h2>Выберите аудиотрек</h2></div>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>
        <div className="song-picker-toolbar">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск аудиотрека…" />
          <button className="secondary-button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Проверяем…' : '+ Загрузить новый'}</button>
          <input ref={inputRef} className="hidden-file-input" type="file" accept="audio/*,.mp3,.wav,.ogg,.opus,.flac,.m4a,.mp4" onChange={(event) => void upload(event.target.files?.[0])} />
        </div>
        <div className="song-picker-list">
          {filtered.length === 0 ? (
            <div className="empty-state compact-empty"><p>Аудиотреков пока нет. Можно загрузить новый прямо здесь.</p></div>
          ) : filtered.map((track) => (
            <button key={track.id} className={track.id === currentTrackId ? 'song-picker-row song-picker-row--selected' : 'song-picker-row'} onClick={() => onSelect(track.id)}>
              <div><strong>{track.name}</strong><span>Независимый аудиотрек</span></div>
              <small>{track.id === currentTrackId ? 'Выбран' : 'Выбрать'}</small>
            </button>
          ))}
        </div>
        {currentTrackId && <button className="text-button unlink-song" onClick={() => onSelect(undefined)}>Убрать аудиотрек</button>}
      </section>
    </div>
  );
}
