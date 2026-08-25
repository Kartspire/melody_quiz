import { useState } from 'react';
import { createAudioAsset, createMediaTrack } from '../../model/defaults';
import { mediaTrackAdded } from '../../model/game';
import { DATA_LIMITS } from '../../model/limits';
import { mediaTrackNameFromFileName } from '../../model/media/domain/libraryIdentity';
import { AUDIO_FILE_ACCEPT } from '../../lib/audio';
import { getErrorMessage } from '../../lib/errors';
import { useFeedback } from '../feedback/FeedbackProvider';

export function AudioTrackForm({ onCreated }: { onCreated: () => void }) {
  const { notify } = useFeedback();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const asset = await createAudioAsset(file);
      const track = createMediaTrack(asset, name.trim() || mediaTrackNameFromFileName(file.name));
      mediaTrackAdded({ track, audioAsset: asset });
      setName('');
      setFile(undefined);
      onCreated();
      notify({ kind: 'success', message: `Аудиотрек «${track.name}» добавлен.` });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось добавить аудиотрек', message: getErrorMessage(error, 'Проверьте файл и попробуйте ещё раз.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="song-form">
      <div className="song-form-grid media-track-create-grid">
        <label className="field"><span>Название в медиатеке</span><input maxLength={DATA_LIMITS.text.mediaTrackName} value={name} onChange={(event) => setName(event.target.value)} placeholder="Можно оставить пустым — возьмём имя файла без расширения" /></label>
        <div className="audio-upload"><span>Аудиофайл</span><label className={file ? 'file-picker file-picker--ready' : 'file-picker'}><input type="file" accept={AUDIO_FILE_ACCEPT} onChange={(event) => { setFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /><span className="file-picker__title">{file ? '✓ Выбран' : 'Загрузить'}</span><small title={file?.name}>{file?.name ?? 'MP3, WAV, OGG, FLAC, M4A…'}</small></label></div>
      </div>
      <div className="inline-actions"><button className="primary-button" disabled={!file || busy} onClick={() => void submit()}>{busy ? 'Проверяем аудио…' : 'Добавить аудио'}</button></div>
    </div>
  );
}
