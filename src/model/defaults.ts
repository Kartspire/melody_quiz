import { createId } from '../lib/ids';
import { cloneInterRoundInstance } from '../interRounds/templates';
import { canonicalizeAudioAsset, createContentAddressedAudioAsset } from '../lib/audio';
import { DATA_LIMITS, GAME_POINTS_STEP } from './limits';
import { captureStateWrite } from './core/writeAccess';
import type {
  AudioAsset,
  Category,
  GameConfig,
  GameSession,
  GameStage,
  LegacyPersistedState,
  MediaTrack,
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

const TEAM_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f97316',
  '#84cc16', '#6366f1', '#14b8a6', '#e11d48', '#0ea5e9', '#8b5cf6', '#10b981', '#f43f5e',
  '#64748b', '#d946ef', '#65a30d', '#ea580c', '#0891b2', '#7c3aed', '#059669', '#be123c',
  '#475569', '#c026d3', '#4d7c0f', '#c2410c', '#0e7490', '#6d28d9', '#047857', '#9f1239',
] as const;

export const createQuestion = (points = GAME_POINTS_STEP): Question => ({ id: createId('question'), points });

export const createCategory = (index = 0): Category => ({
  id: createId('category'),
  name: `Категория ${index + 1}`,
  questions: Array.from({ length: 5 }, (_, index) => (index + 1) * GAME_POINTS_STEP).map(createQuestion),
});

export const createRound = (index = 0): Round => ({
  id: createId('round'),
  name: `Раунд ${index + 1}`,
  categories: [createCategory(0)],
});

export const createRoundStage = (roundId: string): GameStage => ({ id: createId('stage'), kind: 'round', roundId });
export const createInterRoundStage = (interRoundId: string): GameStage => ({ id: createId('stage'), kind: 'interRound', interRoundId });

export const createTeam = (index = 0): Team => ({
  id: createId('team'),
  name: `Команда ${index + 1}`,
  color: TEAM_COLORS[index % TEAM_COLORS.length],
});

export const createGame = (title = 'Новая игра'): GameConfig => {
  const now = Date.now();
  const round = createRound(0);
  return {
    id: createId('game'),
    title: boundedText(title, DATA_LIMITS.text.gameTitle, 'Новая игра'),
    rounds: [round],
    interRounds: [],
    stages: [createRoundStage(round.id)],
    teams: [createTeam(0), createTeam(1)],
    createdAt: now,
    updatedAt: now,
  };
};


export const cloneGame = (source: GameConfig): GameConfig => {
  const now = Date.now();
  const roundIdMap = new Map<string, string>();
  const interRoundIdMap = new Map<string, string>();

  const rounds = source.rounds.map((round) => {
    const id = createId('round');
    roundIdMap.set(round.id, id);
    return {
      ...round,
      id,
      categories: round.categories.map((category) => ({
        ...category,
        id: createId('category'),
        questions: category.questions.map((question) => ({ ...question, id: createId('question') })),
      })),
    };
  });

  const interRounds = source.interRounds.map((interRound) => {
    const cloned = cloneInterRoundInstance(interRound);
    interRoundIdMap.set(interRound.id, cloned.id);
    return cloned;
  });

  return {
    id: createId('game'),
    title: withSuffix(source.title, ' — копия', DATA_LIMITS.text.gameTitle, 'Без названия'),
    createdAt: now,
    updatedAt: now,
    teams: source.teams.map((team, index) => ({ ...team, id: createId(`team-${index + 1}`) })),
    rounds,
    interRounds,
    stages: source.stages.map((stage) => stage.kind === 'round'
      ? { id: createId('stage'), kind: 'round', roundId: roundIdMap.get(stage.roundId)! }
      : { id: createId('stage'), kind: 'interRound', interRoundId: interRoundIdMap.get(stage.interRoundId)! }),
  };
};

export const createSession = (config: GameConfig, random: () => number = Math.random): GameSession => ({
  gameId: config.id,
  started: false,
  stageIndex: 0,
  stageId: config.stages[0]?.id ?? null,
  activeQuestionId: null,
  pausedQuestionId: null,
  completedQuestionIds: [],
  completedInterRoundIds: [],
  interRound: null,
  scores: Object.fromEntries(config.teams.map((team) => [team.id, 0])),
  selectingTeamId: pickRandomTeamId(config.teams, random),
  awardedTeamId: null,
  answerRevealed: false,
  activeExcludedTeamIds: [],
  currentIncorrectTeamIds: [],
  nextExcludedTeamIds: [],
  history: [],
  updatedAt: Date.now(),
});

function pickRandomTeamId(teams: Team[], random: () => number) {
  if (teams.length === 0) return null;
  const normalized = Math.min(Math.max(random(), 0), 0.9999999999999999);
  return teams[Math.floor(normalized * teams.length)]?.id ?? teams[0]?.id ?? null;
}

export const createAudioAsset = async (file: File) => {
  const checkWrite = captureStateWrite();
  const asset = await createContentAddressedAudioAsset(file);
  checkWrite();
  return asset;
};

export const createMediaTrack = (asset: AudioAsset, name = asset.name): MediaTrack => {
  const now = Date.now();
  return {
    id: createId('track'),
    name: boundedText(name, DATA_LIMITS.text.mediaTrackName, asset.name || 'Аудиотрек'),
    audioId: asset.id,
    createdAt: now,
    updatedAt: now,
  };
};

export const createSong = ({
  artist,
  title,
  minusTrack,
  plusTrack,
}: {
  artist: string;
  title: string;
  minusTrack?: MediaTrack;
  plusTrack?: MediaTrack;
}): Song => {
  const now = Date.now();
  return {
    id: createId('song'),
    artist: boundedText(artist, DATA_LIMITS.text.artist),
    title: boundedText(title, DATA_LIMITS.text.songTitle),
    minusTrackId: minusTrack?.id,
    plusTrackId: plusTrack?.id,
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
    version: 4,
    games: [game],
    songs: [],
    mediaTracks: [],
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
  const trackByAudioId = new Map<string, MediaTrack>();

  const trackFor = (asset: AudioAsset | undefined) => {
    if (!asset) return undefined;
    const existing = trackByAudioId.get(asset.id);
    if (existing) return existing;
    const track = createMediaTrack(asset);
    trackByAudioId.set(asset.id, track);
    return track;
  };

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
          minusTrackId: trackFor(minus)?.id,
          plusTrackId: trackFor(plus)?.id,
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

  const stages = rounds.map((round) => createRoundStage(round.id));
  const game: GameConfig = {
    id: gameId,
    title: legacy.config.title || 'Угадай мелодию',
    rounds,
    interRounds: [],
    stages,
    teams: legacy.config.teams,
    createdAt: now,
    updatedAt: now,
  };

  const legacyRoundIndex = Math.max(0, legacy.session.roundIndex ?? 0);
  const stageIndex = Math.min(legacyRoundIndex, stages.length);
  const session: GameSession = {
    gameId,
    started: legacy.session.started ?? false,
    stageIndex,
    stageId: stages[stageIndex]?.id ?? null,
    activeQuestionId: legacy.session.activeQuestionId ?? null,
    pausedQuestionId: null,
    completedQuestionIds: legacy.session.completedQuestionIds ?? [],
    completedInterRoundIds: [],
    interRound: null,
    scores: legacy.session.scores ?? {},
    selectingTeamId: legacy.session.selectingTeamId ?? pickRandomTeamId(game.teams, Math.random),
    awardedTeamId: legacy.session.awardedTeamId ?? null,
    answerRevealed: legacy.session.answerRevealed ?? Boolean(legacy.session.awardedTeamId),
    activeExcludedTeamIds: legacy.session.activeExcludedTeamIds ?? [],
    currentIncorrectTeamIds: legacy.session.currentIncorrectTeamIds ?? [],
    nextExcludedTeamIds: legacy.session.nextExcludedTeamIds ?? [],
    history: [],
    updatedAt: now,
  };

  return {
    version: 4,
    games: [game],
    songs,
    mediaTracks: [...trackByAudioId.values()],
    audioAssets: [...audioByHash.values()],
    sessions: [session],
    activeGameId: gameId,
  };
};
