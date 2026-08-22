import { useMemo, useState } from 'react';
import { useUnit } from 'effector-react';
import { createAudioAsset, createMediaTrack, createSong } from '../model/defaults';
import { DATA_LIMITS } from '../model/limits';
import { $mediaTracks, songAdded } from '../model/game';
import type { AudioAsset, MediaTrack } from '../model/types';
import { AUDIO_FILE_ACCEPT } from '../lib/audio';
import { getErrorMessage } from '../lib/errors';

export function SongForm({ onCreated, onCancel, compact = false }: { onCreated?: (songId: string) => void; onCancel?: () => void; compact?: boolean }) {
  const mediaTracks = useUnit($mediaTracks);
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [minusFile, setMinusFile] = useState<File>();
  const [plusFile, setPlusFile] = useState<File>();
  const [minusTrackId, setMinusTrackId] = useState('');
  const [plusTrackId, setPlusTrackId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);

  const submit = async () => {
    if ((!artist.trim() && !title.trim()) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const newTracks: MediaTrack[] = [];
      const newAssets: AudioAsset[] = [];

      const resolveRole = async (kind: 'minus' | 'plus', existingTrackId: string, file?: File) => {
        if (file) {
          const asset = await createAudioAsset(file);
          const role = kind === 'minus' ? 'минус' : 'плюс';
          const label = [artist.trim(), title.trim()].filter(Boolean).join(' — ');
          const track = createMediaTrack(asset, label ? `${label} (${role})` : file.name);
          newAssets.push(asset);
          newTracks.push(track);
          return track;
        }
        return existingTrackId ? trackById.get(existingTrackId) : undefined;
      };

      const [minusTrack, plusTrack] = await Promise.all([
        resolveRole('minus', minusTrackId, minusFile),
        resolveRole('plus', plusTrackId, plusFile),
      ]);
      const song = createSong({ artist, title, minusTrack, plusTrack });
      songAdded({ song, mediaTracks: newTracks, audioAssets: newAssets });
      onCreated?.(song.id);
      setArtist('');
      setTitle('');
      setMinusFile(undefined);
      setPlusFile(undefined);
      setMinusTrackId('');
      setPlusTrackId('');
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось добавить песню.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? 'song-form song-form--compact' : 'song-form'}>
      <div className="song-form-grid">
        <label className="field">
          <span>Исполнитель</span>
          <input autoFocus={compact} maxLength={DATA_LIMITS.text.artist} value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Например: Кино" />
        </label>
        <label className="field">
          <span>Название песни</span>
          <input maxLength={DATA_LIMITS.text.songTitle} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Группа крови" />
        </label>
        <TrackField
          label="Минус"
          tracks={mediaTracks}
          selectedTrackId={minusTrackId}
          file={minusFile}
          onTrackChange={(trackId) => { setMinusTrackId(trackId); if (trackId) setMinusFile(undefined); }}
          onFileChange={(file) => { setMinusFile(file); if (file) setMinusTrackId(''); }}
        />
        <TrackField
          label="Плюс"
          tracks={mediaTracks}
          selectedTrackId={plusTrackId}
          file={plusFile}
          onTrackChange={(trackId) => { setPlusTrackId(trackId); if (trackId) setPlusFile(undefined); }}
          onFileChange={(file) => { setPlusFile(file); if (file) setPlusTrackId(''); }}
        />
      </div>
      {error && <p className="missing-audio" role="alert">{error}</p>}
      <div className="inline-actions">
        <button className="primary-button" disabled={busy || (!artist.trim() && !title.trim())} onClick={() => void submit()}>{busy ? 'Проверяем аудио…' : 'Сохранить песню'}</button>
        {onCancel && <button className="secondary-button" disabled={busy} onClick={onCancel}>Отмена</button>}
      </div>
    </div>
  );
}

function TrackField({
  label,
  tracks,
  selectedTrackId,
  file,
  onTrackChange,
  onFileChange,
}: {
  label: string;
  tracks: MediaTrack[];
  selectedTrackId: string;
  file?: File;
  onTrackChange: (trackId: string) => void;
  onFileChange: (file?: File) => void;
}) {
  return (
    <div className="audio-upload song-track-picker">
      <span>{label}</span>
      <select value={selectedTrackId} disabled={Boolean(file)} onChange={(event) => onTrackChange(event.target.value)}>
        <option value="">Не выбран из аудио</option>
        {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
      </select>
      <label className={file ? 'file-picker file-picker--ready' : 'file-picker'}>
        <input
          type="file"
          accept={AUDIO_FILE_ACCEPT}
          onChange={(event) => {
            onFileChange(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <span className="file-picker__title">{file ? '✓ Новый файл выбран' : 'Или загрузить новый файл'}</span>
        <small title={file?.name}>{file?.name ?? 'MP3, WAV, OGG, FLAC, M4A…'}</small>
      </label>
      {file && <button className="remove-file" onClick={() => onFileChange(undefined)}>Убрать файл</button>}
    </div>
  );
}
