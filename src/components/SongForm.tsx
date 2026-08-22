import { useState } from 'react';
import { createAudioAsset, createSong } from '../model/defaults';
import { DATA_LIMITS } from '../model/limits';
import { songAdded } from '../model/game';

export function SongForm({ onCreated, onCancel, compact = false }: { onCreated?: (songId: string) => void; onCancel?: () => void; compact?: boolean }) {
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [minusFile, setMinusFile] = useState<File>();
  const [plusFile, setPlusFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if ((!artist.trim() && !title.trim()) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [minus, plus] = await Promise.all([
        minusFile ? createAudioAsset(minusFile) : Promise.resolve(undefined),
        plusFile ? createAudioAsset(plusFile) : Promise.resolve(undefined),
      ]);
      const song = createSong({ artist, title, minus, plus });
      songAdded({ song, audioAssets: [minus, plus].filter((asset) => asset !== undefined) });
      onCreated?.(song.id);
      setArtist('');
      setTitle('');
      setMinusFile(undefined);
      setPlusFile(undefined);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось добавить песню.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? 'song-form song-form--compact' : 'song-form'}>
      <div className="song-form-grid">
        <label className="field">
          <span>Исполнитель</span>
          <input maxLength={DATA_LIMITS.text.artist} value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Например: Кино" />
        </label>
        <label className="field">
          <span>Название песни</span>
          <input maxLength={DATA_LIMITS.text.songTitle} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Группа крови" />
        </label>
        <FileField label="Минус" file={minusFile} onChange={setMinusFile} />
        <FileField label="Плюс" file={plusFile} onChange={setPlusFile} />
      </div>
      {error && <p className="missing-audio" role="alert">{error}</p>}
      <div className="inline-actions">
        <button className="primary-button" disabled={busy || (!artist.trim() && !title.trim())} onClick={() => void submit()}>{busy ? 'Проверяем аудио…' : 'Сохранить песню'}</button>
        {onCancel && <button className="secondary-button" disabled={busy} onClick={onCancel}>Отмена</button>}
      </div>
    </div>
  );
}

function FileField({ label, file, onChange }: { label: string; file?: File; onChange: (file?: File) => void }) {
  return (
    <div className="audio-upload">
      <span>{label}</span>
      <label className={file ? 'file-picker file-picker--ready' : 'file-picker'}>
        <input
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.opus,.flac,.m4a,.mp4"
          onChange={(event) => {
            onChange(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <span className="file-picker__title">{file ? '✓ Выбран' : 'Загрузить'}</span>
        <small title={file?.name}>{file?.name ?? 'MP3, WAV, OGG, FLAC, M4A…'}</small>
      </label>
      {file && <button className="remove-file" onClick={() => onChange(undefined)}>Убрать</button>}
    </div>
  );
}
