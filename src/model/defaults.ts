import { createId } from '../lib/ids';
import { canonicalizeAudioAsset, createContentAddressedAudioAsset } from '../lib/audio';
import { DATA_LIMITS } from './limits';
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


function boundedText(value: string, maxLength: number, fallback = '') {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, maxLength);
}

function withSuffix(value: string, suffix: string, maxLength: number, fallback: string) {
  const source = value.trim() || fallback;
  const allowedSourceLength = Math.max(0, maxLength - suffix.length);
  return `${source.slice(0, allowedSourceLength).trimEnd()}${suffix}`.slice(0, maxLength);
}

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
    title: boundedText(title, DATA_LIMITS.text.gameTitle, 'Новая игра'),
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
    title: withSuffix(source.title, ' — копия', DATA_LIMITS.text.gameTitle, 'Без названия'),
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

export const createAudioAsset = (file: File) => createContentAddressedAudioAsset(file);

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
    artist: boundedText(artist, DATA_LIMITS.text.artist),
    title: boundedText(title, DATA_LIMITS.text.songTitle),
    minusAudioId: minus?.id,
    plusAudioId: plus?.id,
    createdAt: now,
    updatedAt: now,
  };
};

export const cloneSong = (source: Song): Song => {
  const now = Date.now();
  return {
    ...source,
    id: createId('song'),
    title: withSuffix(source.title, ' — копия', DATA_LIMITS.text.songTitle, 'Без названия'),
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

export const migrateLegacyState = async (legacy: LegacyPersistedState): Promise<PersistedState> => {
  const now = Date.now();
  const gameId = createId('game');
  const songs: Song[] = [];
  const audioByHash = new Map<string, AudioAsset>();

  const rounds = [] as GameConfig['rounds'];
  for (const round of legacy.config.rounds) {
    const categories = [] as GameConfig['rounds'][number]['categories'];
    for (const category of round.categories) {
      const questions = [] as Question[];
      for (const question of category.questions) {
        const minus = question.minus
          ? await canonicalizeAudioAsset({ name: question.minus.name, type: question.minus.type, blob: question.minus.blob })
          : undefined;
        const plus = question.plus
          ? await canonicalizeAudioAsset({ name: question.plus.name, type: question.plus.type, blob: question.plus.blob })
          : undefined;

        if (minus) audioByHash.set(minus.id, minus);
        if (plus) audioByHash.set(plus.id, plus);

        const hasSongData = Boolean(question.artist || question.title || minus || plus);
        if (!hasSongData) {
          questions.push({ id: question.id, points: question.points });
          continue;
        }

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
        questions.push({ id: question.id, points: question.points, songId: song.id });
      }
      categories.push({ id: category.id, name: category.name, questions });
    }
    rounds.push({ id: round.id, name: round.name, categories });
  }

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
    audioAssets: [...audioByHash.values()],
    sessions: [session],
    activeGameId: gameId,
  };
};
