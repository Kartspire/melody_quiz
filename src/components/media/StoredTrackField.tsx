import { useState } from 'react';
import { createAudioAsset, createMediaTrack } from '../../model/defaults';
import { songTrackChanged } from '../../model/game';
import type { AudioAsset, MediaTrack } from '../../model/types';
import { mediaTrackNameFromFileName } from '../../model/media/domain/libraryIdentity';
import { AUDIO_FILE_ACCEPT } from '../../lib/audio';
import { getErrorMessage } from '../../lib/errors';
import { MediaTrackPicker } from '../MediaTrackPicker';
import { useFeedback } from '../feedback/FeedbackProvider';
import { AudioPreview } from './AudioPreview';

export function StoredTrackField({ songId, kind, label, suggestedName, track, asset, usedInGames }: {
  songId: string;
  kind: 'minus' | 'plus';
  label: string;
  suggestedName: string;
  track?: MediaTrack;
  asset?: AudioAsset;
  usedInGames: boolean;
}) {
  const { confirm, notify } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [pickingTrack, setPickingTrack] = useState(false);

  const replaceFile = async (file: File) => {
    if (usedInGames && track) {
      const confirmed = await confirm({
        title: `Назначить новый ${label.toLowerCase()}?`,
        description: 'Эта песня уже используется в играх. Старый аудиотрек останется в общей медиатеке.',
        confirmLabel: 'Назначить новый трек',
      });
      if (!confirmed) return;
    }

    setBusy(true);
    try {
      const nextAsset = await createAudioAsset(file);
      const nextTrack = createMediaTrack(nextAsset, suggestedName || mediaTrackNameFromFileName(file.name));
      songTrackChanged({ songId, kind, track: nextTrack, audioAsset: nextAsset });
      notify({ kind: 'success', message: `${label} обновлён.` });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось загрузить аудиофайл', message: getErrorMessage(error, 'Проверьте файл и попробуйте ещё раз.') });
    } finally {
      setBusy(false);
    }
  };

  const selectTrack = async (trackId?: string) => {
    if (usedInGames && trackId !== track?.id) {
      const confirmed = await confirm({
        title: `Изменить ${label.toLowerCase()} у используемой песни?`,
        description: trackId
          ? 'Изменение сразу затронет все вопросы, где используется эта песня.'
          : 'Игра не запустится, пока трек не будет назначен снова. Сам аудиотрек останется в медиатеке.',
        confirmLabel: trackId ? 'Изменить' : 'Убрать из песни',
        tone: trackId ? 'default' : 'danger',
      });
      if (!confirmed) return;
    }
    songTrackChanged({ songId, kind, trackId });
    setPickingTrack(false);
  };

  return (
    <div className="stored-audio-field">
      <div className="stored-audio-field__head"><strong>{label}</strong><span>{track?.name ?? 'не выбран'}</span></div>
      <button className="secondary-button stored-audio-field__picker" onClick={() => setPickingTrack(true)}>
        {track ? `Выбран: ${track.name}` : 'Выбрать из медиатеки'}
      </button>
      {pickingTrack && <MediaTrackPicker currentTrackId={track?.id} onClose={() => setPickingTrack(false)} onSelect={(trackId) => void selectTrack(trackId)} />}
      {asset && <AudioPreview asset={asset} />}
      <div className="inline-actions">
        <label className="secondary-button file-button">
          {busy ? 'Проверяем…' : track ? 'Загрузить другой файл' : 'Загрузить новый'}
          <input type="file" disabled={busy} accept={AUDIO_FILE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void replaceFile(file); event.currentTarget.value = ''; }} />
        </label>
        {track && <button className="text-button" disabled={busy} onClick={() => void selectTrack(undefined)}>Убрать из песни</button>}
      </div>
      {asset && <small className="media-track-origin" title={asset.name}>Файл: {asset.name}</small>}
    </div>
  );
}
