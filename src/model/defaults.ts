import { createId } from '../lib/ids';
import type {
  AudioAsset,
  Category,
  GameConfig,
  GameSession,
  LegacyPersistedState,
  PersistedState,
  Question,
  Round,
  Song,
  Team,
} from './types';

const TEAM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#14b8a6', '#e11d48'];

export const createQuestion = (points = 100): Question => ({
  id: createId('question'),
  points,
});

export const createCategory = (index = 0): Category => ({
  id: createId('category'),
  name: `Категория ${index + 1}`,
  questions: [100, 200, 300, 400, 500].map(createQuestion),
});

export const createRound = (index = 0): Round => ({
  id: createId('round'),
  name: `Раунд ${index + 1}`,
  categories: [createCategory(0)],
});

export const createTeam = (index = 0): Team => ({
  id: createId('team'),
  name: `Команда ${index + 1}`,
  color: TEAM_COLORS[index % TEAM_COLORS.length],
});

export const createGame = (title = 'Новая игра'): GameConfig => {
  const now = Date.now();
  return {
    id: createId('game'),
    title,
    rounds: [createRound(0)],
    teams: [createTeam(0), createTeam(1)],
    createdAt: now,
    updatedAt: now,
  };
};

export const cloneGame = (source: GameConfig): GameConfig => {
  const now = Date.now();
  return {
    id: createId('game'),
    title: `${source.title} — копия`,
    createdAt: now,
    updatedAt: now,
    teams: source.teams.map((team, index) => ({ ...team, id: createId(`team-${index + 1}`) })),
    rounds: source.rounds.map((round) => ({
      ...round,
      id: createId('round'),
      categories: round.categories.map((category) => ({
        ...category,
        id: createId('category'),
        questions: category.questions.map((question) => ({ ...question, id: createId('question') })),
      })),
    })),
  };
};

export const createSession = (config: GameConfig): GameSession => ({
  gameId: config.id,
  started: false,
  roundIndex: 0,
  activeQuestionId: null,
  completedQuestionIds: [],
  scores: Object.fromEntries(config.teams.map((team) => [team.id, 0])),
  awardedTeamId: null,
  answerRevealed: false,
  activeExcludedTeamIds: [],
  currentIncorrectTeamIds: [],
  nextExcludedTeamIds: [],
});

export const createAudioAsset = (file: File): AudioAsset => ({
  id: createId('audio'),
  name: file.name,
  type: file.type,
  size: file.size,
  blob: file,
});

export const createSong = ({
  artist,
  title,
  minus,
  plus,
}: {
  artist: string;
  title: string;
  minus?: AudioAsset;
  plus?: AudioAsset;
}): Song => {
  const now = Date.now();
  return {
    id: createId('song'),
    artist: artist.trim(),
    title: title.trim(),
    minusAudioId: minus?.id,
    plusAudioId: plus?.id,
    createdAt: now,
    updatedAt: now,
  };
};

export const createInitialState = (): PersistedState => {
  const game = createGame('Угадай мелодию');
  return {
    version: 2,
    games: [game],
    songs: [],
    audioAssets: [],
    sessions: [createSession(game)],
    activeGameId: game.id,
  };
};

export const migrateLegacyState = (legacy: LegacyPersistedState): PersistedState => {
  const now = Date.now();
  const gameId = createId('game');
  const songs: Song[] = [];
  const audioAssets: AudioAsset[] = [];

  const rounds = legacy.config.rounds.map((round) => ({
    id: round.id,
    name: round.name,
    categories: round.categories.map((category) => ({
      id: category.id,
      name: category.name,
      questions: category.questions.map((question) => {
        const minus = question.minus
          ? { ...question.minus, id: createId('audio') }
          : undefined;
        const plus = question.plus
          ? { ...question.plus, id: createId('audio') }
          : undefined;

        if (minus) audioAssets.push(minus);
        if (plus) audioAssets.push(plus);

        const hasSongData = Boolean(question.artist || question.title || minus || plus);
        if (!hasSongData) return { id: question.id, points: question.points };

        const song: Song = {
          id: createId('song'),
          artist: question.artist ?? '',
          title: question.title ?? '',
          minusAudioId: minus?.id,
          plusAudioId: plus?.id,
          createdAt: now,
          updatedAt: now,
        };
        songs.push(song);
        return { id: question.id, points: question.points, songId: song.id };
      }),
    })),
  }));

  const game: GameConfig = {
    id: gameId,
    title: legacy.config.title || 'Угадай мелодию',
    rounds,
    teams: legacy.config.teams,
    createdAt: now,
    updatedAt: now,
  };

  const legacySession = legacy.session;
  const session: GameSession = {
    gameId,
    started: legacySession.started ?? false,
    roundIndex: legacySession.roundIndex ?? 0,
    activeQuestionId: legacySession.activeQuestionId ?? null,
    completedQuestionIds: legacySession.completedQuestionIds ?? [],
    scores: legacySession.scores ?? {},
    awardedTeamId: legacySession.awardedTeamId ?? null,
    answerRevealed: legacySession.answerRevealed ?? Boolean(legacySession.awardedTeamId),
    activeExcludedTeamIds: legacySession.activeExcludedTeamIds ?? [],
    currentIncorrectTeamIds: legacySession.currentIncorrectTeamIds ?? [],
    nextExcludedTeamIds: legacySession.nextExcludedTeamIds ?? [],
  };

  return {
    version: 2,
    games: [game],
    songs,
    audioAssets,
    sessions: [session],
    activeGameId: gameId,
  };
};
