import { useState } from 'react';
import { createAudioAsset, createSong } from '../model/defaults';
import { songAdded } from '../model/game';

export function SongForm({ onCreated, onCancel, compact = false }: { onCreated?: (songId: string) => void; onCancel?: () => void; compact?: boolean }) {
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [minusFile, setMinusFile] = useState<File>();
  const [plusFile, setPlusFile] = useState<File>();

  const submit = () => {
    if (!artist.trim() && !title.trim()) return;
    const minus = minusFile ? createAudioAsset(minusFile) : undefined;
    const plus = plusFile ? createAudioAsset(plusFile) : undefined;
    const song = createSong({ artist, title, minus, plus });
    songAdded({ song, audioAssets: [minus, plus].filter((asset) => asset !== undefined) });
    onCreated?.(song.id);
    setArtist('');
    setTitle('');
    setMinusFile(undefined);
    setPlusFile(undefined);
  };

  return (
    <div className={compact ? 'song-form song-form--compact' : 'song-form'}>
      <div className="song-form-grid">
        <label className="field">
          <span>Исполнитель</span>
          <input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Например: Кино" />
        </label>
        <label className="field">
          <span>Название песни</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Группа крови" />
        </label>
        <FileField label="Минус" file={minusFile} onChange={setMinusFile} />
        <FileField label="Плюс" file={plusFile} onChange={setPlusFile} />
      </div>
      <div className="inline-actions">
        <button className="primary-button" disabled={!artist.trim() && !title.trim()} onClick={submit}>Сохранить песню</button>
        {onCancel && <button className="secondary-button" onClick={onCancel}>Отмена</button>}
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
          accept="audio/*"
          onChange={(event) => {
            onChange(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <span className="file-picker__title">{file ? '✓ Выбран' : 'Загрузить'}</span>
        <small title={file?.name}>{file?.name ?? 'MP3, WAV, OGG…'}</small>
      </label>
      {file && <button className="remove-file" onClick={() => onChange(undefined)}>Убрать</button>}
    </div>
  );
}
