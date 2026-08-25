import { useState } from 'react';
import type { AudioAsset } from '../../model/types';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { AudioTimeline } from '../AudioTimeline';

export function AudioPreview({ asset }: { asset: AudioAsset }) {
  const [opened, setOpened] = useState(false);
  const source = useObjectUrl(opened ? asset.blob : undefined);
  const player = useAudioPlayer({
    source,
    playErrorMessage: 'Не удалось запустить предпрослушивание.',
    mediaErrorMessage: 'Браузер не смог прочитать этот аудиофайл.',
  });

  if (!opened) {
    return <button className="text-button media-audio-preview-toggle" onClick={() => setOpened(true)}>▶ Прослушать</button>;
  }

  return (
    <div className="media-audio-preview-wrap">
      {source && (
        <div className="media-audio-preview">
          <audio ref={player.audioRef} src={source} preload="metadata" />
          <button
            className="play-button media-audio-preview__button"
            onClick={() => void player.toggle()}
            aria-label={player.playing ? 'Пауза' : 'Воспроизвести'}
          >
            {player.playing ? 'Ⅱ' : '▶'}
          </button>
          <AudioTimeline progress={player.currentTime} duration={player.duration} onSeek={player.seek} />
        </div>
      )}
      {player.error && <small className="audio-playback-error" role="alert">{player.error}</small>}
      <button className="text-button" onClick={() => setOpened(false)}>Скрыть плеер</button>
    </div>
  );
}
