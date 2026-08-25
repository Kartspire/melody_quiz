import {
  mediaTrackAudioChanged,
  mediaTrackChanged,
  mediaTrackDeleteRequested,
} from '../../model/game';
import { createAudioAsset } from '../../model/defaults';
import { DATA_LIMITS } from '../../model/limits';
import type { AudioAsset, MediaTrack } from '../../model/types';
import type { MediaTrackUsage } from '../../model/media';
import { AUDIO_FILE_ACCEPT } from '../../lib/audio';
import { getErrorMessage } from '../../lib/errors';
import { formatBytes } from '../../lib/format';
import { useFeedback } from '../feedback/FeedbackProvider';
import { AudioPreview } from './AudioPreview';
import { NoResults } from './shared';

export function TrackList({ tracks, allTracksCount, audioById, usageByTrackId, query, onClearQuery, hasMore, onLoadMore }: {
  tracks: MediaTrack[];
  allTracksCount: number;
  audioById: Map<string, AudioAsset>;
  usageByTrackId: Map<string, MediaTrackUsage[]>;
  query: string;
  onClearQuery: () => void;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const { confirm, notify } = useFeedback();

  if (allTracksCount === 0) return <div className="empty-state"><h2>Аудиотреков пока нет</h2><p>Здесь могут храниться любые звуки: песни, фрагменты, заставки, mashup или аудио для будущих межраундов.</p></div>;
  if (tracks.length === 0 && query) return <NoResults onClear={onClearQuery} />;

  const replaceTrackFile = async (track: MediaTrack, usages: MediaTrackUsage[], file: File) => {
    if (usages.length > 0) {
      const confirmed = await confirm({
        title: `Заменить файл у «${track.name}»?`,
        description: `Трек используется в ${usages.length} местах. Новый физический файл будет применён ко всем этим ссылкам.`,
        confirmLabel: 'Заменить файл',
      });
      if (!confirmed) return;
    }
    try {
      const audioAsset = await createAudioAsset(file);
      mediaTrackAudioChanged({ trackId: track.id, audioAsset });
      notify({ kind: 'success', message: `Файл для «${track.name}» заменён.` });
    } catch (error) {
      notify({ kind: 'error', title: 'Не удалось заменить аудиофайл', message: getErrorMessage(error, 'Проверьте файл и попробуйте ещё раз.') });
    }
  };

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
                    if (file) void replaceTrackFile(track, usages, file);
                  }} />
                </label>
                <button
                  className="danger-ghost"
                  disabled={usages.length > 0}
                  title={usages.length > 0 ? 'Сначала уберите этот трек из всех песен и межраундов' : 'Удалить медиатрек'}
                  onClick={() => {
                    void confirm({
                      title: `Удалить аудиотрек «${track.name}»?`,
                      description: 'Если физический файл больше нигде не используется, он также будет удалён из IndexedDB.',
                      confirmLabel: 'Удалить аудио',
                      tone: 'danger',
                    }).then((confirmed) => { if (confirmed) mediaTrackDeleteRequested(track.id); });
                  }}
                >Удалить аудио</button>
              </div>
            </div>
          </article>
        );
      })}
      {hasMore && <button className="secondary-button media-load-more" onClick={onLoadMore}>Показать ещё</button>}
    </section>
  );
}
