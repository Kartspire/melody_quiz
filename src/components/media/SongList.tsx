import {
  songChanged,
  songDeleteRequested,
  songDuplicated,
} from '../../model/game';
import { DATA_LIMITS } from '../../model/limits';
import type { AudioAsset, MediaTrack, Song } from '../../model/types';
import type { SongUsage } from '../../model/media';
import { ActionMenu } from '../ActionMenu';
import { useFeedback } from '../feedback/FeedbackProvider';
import { StoredTrackField } from './StoredTrackField';
import { NoResults } from './shared';

export function SongList({
  songs,
  allSongsCount,
  trackById,
  audioById,
  usageBySongId,
  query,
  onClearQuery,
  hasMore,
  onLoadMore,
}: {
  songs: Song[];
  allSongsCount: number;
  trackById: Map<string, MediaTrack>;
  audioById: Map<string, AudioAsset>;
  usageBySongId: Map<string, SongUsage[]>;
  query: string;
  onClearQuery: () => void;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const { confirm } = useFeedback();

  if (allSongsCount === 0) return <div className="empty-state"><h2>Песен пока нет</h2><p>Добавьте первую песню для обычных раундов или перейдите во вкладку «Аудио» для самостоятельных треков.</p></div>;
  if (songs.length === 0 && query) return <NoResults onClear={onClearQuery} />;

  return (
    <section className="media-list">
      {songs.map((song) => {
        const minusTrack = song.minusTrackId ? trackById.get(song.minusTrackId) : undefined;
        const plusTrack = song.plusTrackId ? trackById.get(song.plusTrackId) : undefined;
        const usages = usageBySongId.get(song.id) ?? [];
        return (
          <article className="media-song-card" key={song.id}>
            <div className="media-song-card__main">
              <label className="field"><span>Исполнитель</span><input maxLength={DATA_LIMITS.text.artist} value={song.artist} onChange={(event) => songChanged({ songId: song.id, patch: { artist: event.target.value } })} /></label>
              <label className="field"><span>Название</span><input maxLength={DATA_LIMITS.text.songTitle} value={song.title} onChange={(event) => songChanged({ songId: song.id, patch: { title: event.target.value } })} /></label>
            </div>

            {usages.length > 0 && <div className="backup-hint">Изменение исполнителя, названия или назначенных треков затронет {usages.length} {usages.length === 1 ? 'игру' : 'игры'}, где эта песня используется.</div>}

            <div className="media-audio-grid">
              <StoredTrackField songId={song.id} kind="minus" label="Минус" suggestedName={songTrackLabel(song, 'минус')} track={minusTrack} asset={minusTrack ? audioById.get(minusTrack.audioId) : undefined} usedInGames={usages.length > 0} />
              <StoredTrackField songId={song.id} kind="plus" label="Плюс" suggestedName={songTrackLabel(song, 'плюс')} track={plusTrack} asset={plusTrack ? audioById.get(plusTrack.audioId) : undefined} usedInGames={usages.length > 0} />
            </div>

            <div className="media-song-card__footer">
              <div className="song-usage">
                {usages.length === 0 ? <span>Не используется в играх</span> : <span title={usages.map((usage) => `${usage.title}: ${usage.count}`).join('\n')}>Используется: {usages.map((usage) => usage.title).join(', ')}</span>}
              </div>
              <div className="media-song-card__footer-actions">
                <ActionMenu label={`Дополнительные действия для ${song.artist || 'исполнителя не указано'} — ${song.title || 'песни без названия'}`}>
                  <button onClick={() => songDuplicated(song.id)}>Создать отдельную копию</button>
                  <button className="action-menu__danger" onClick={() => {
                    const usageCount = usages.reduce((total, usage) => total + usage.count, 0);
                    void confirm({
                      title: `Удалить «${song.artist || 'Без исполнителя'} — ${song.title || 'Без названия'}»?`,
                      description: usageCount > 0
                        ? `Песня назначена ${usageCount} вопросам и будет автоматически снята с них. Связанные аудиотреки останутся в разделе «Аудио».`
                        : 'Связанные аудиотреки останутся в разделе «Аудио».',
                      confirmLabel: 'Удалить песню',
                      tone: 'danger',
                    }).then((confirmed) => { if (confirmed) songDeleteRequested(song.id); });
                  }}>Удалить песню</button>
                </ActionMenu>
              </div>
            </div>
          </article>
        );
      })}
      {hasMore && <button className="secondary-button media-load-more" onClick={onLoadMore}>Показать ещё</button>}
    </section>
  );
}

function songTrackLabel(song: Song, role: 'минус' | 'плюс') {
  const songLabel = [song.artist.trim(), song.title.trim()].filter(Boolean).join(' — ');
  return songLabel ? `${songLabel} (${role})` : '';
}
