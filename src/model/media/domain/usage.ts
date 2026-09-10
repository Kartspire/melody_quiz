import { getInterRoundTrackIds } from '../../../interRounds/templates';
import type { AudioProject, GameConfig, Song } from '../../types';

export type SongUsage = {
  gameId: string;
  title: string;
  count: number;
};

export type MediaTrackUsage = {
  sourceId: string;
  label: string;
  role: string;
};

export function buildSongUsageMap(games: readonly GameConfig[]) {
  const result = new Map<string, SongUsage[]>();

  for (const game of games) {
    const counts = new Map<string, number>();
    for (const round of game.rounds) {
      for (const category of round.categories) {
        for (const question of category.questions) {
          if (question.songId) counts.set(question.songId, (counts.get(question.songId) ?? 0) + 1);
        }
      }
    }

    for (const [songId, count] of counts) {
      const entries = result.get(songId) ?? [];
      entries.push({ gameId: game.id, title: game.title, count });
      result.set(songId, entries);
    }
  }

  return result;
}

export function buildMediaTrackUsageMap(games: readonly GameConfig[], songs: readonly Song[], audioProjects: readonly AudioProject[] = []) {
  const result = new Map<string, MediaTrackUsage[]>();

  for (const song of songs) {
    for (const [trackId, role] of [[song.minusTrackId, 'минус'], [song.plusTrackId, 'плюс']] as const) {
      if (!trackId) continue;
      const items = result.get(trackId) ?? [];
      items.push({
        sourceId: song.id,
        label: `${song.artist || 'Без исполнителя'} — ${song.title || 'Без названия'}`,
        role,
      });
      result.set(trackId, items);
    }
  }

  for (const game of games) {
    for (const interRound of game.interRounds) {
      const refs = getInterRoundTrackIds(interRound).map((trackId, index) => ({
        trackId,
        role: interRound.templateId === 'continueLyrics' ? `задание ${index + 1}` : `трек ${index + 1}`,
      }));

      for (const ref of refs) {
        if (!ref.trackId) continue;
        const items = result.get(ref.trackId) ?? [];
        items.push({ sourceId: interRound.id, label: `${game.title}: ${interRound.title}`, role: ref.role });
        result.set(ref.trackId, items);
      }
    }
  }

  for (const project of audioProjects) {
    for (const lane of project.lanes) {
      const counts = new Map<string, number>();
      for (const clip of lane.clips) counts.set(clip.sourceTrackId, (counts.get(clip.sourceTrackId) ?? 0) + 1);
      for (const [trackId, count] of counts) {
        const items = result.get(trackId) ?? [];
        items.push({
          sourceId: project.id,
          label: `Монтаж: ${project.name}`,
          role: count > 1 ? `${lane.name}, ${count} фрагмента` : lane.name,
        });
        result.set(trackId, items);
      }
    }
  }

  return result;
}

export function isMediaTrackUsed(games: readonly GameConfig[], songs: readonly Song[], trackId: string, audioProjects: readonly AudioProject[] = []) {
  return buildMediaTrackUsageMap(games, songs, audioProjects).has(trackId);
}
