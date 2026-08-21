export type AudioAsset = {
  id: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  sha256?: string;
};

export type Song = {
  id: string;
  artist: string;
  title: string;
  minusAudioId?: string;
  plusAudioId?: string;
  createdAt: number;
  updatedAt: number;
};

export type Question = {
  id: string;
  points: number;
  songId?: string;
};

export type Category = {
  id: string;
  name: string;
  questions: Question[];
};

export type Round = {
  id: string;
  name: string;
  categories: Category[];
};

export type Team = {
  id: string;
  name: string;
  color: string;
};

export type GameConfig = {
  id: string;
  title: string;
  rounds: Round[];
  teams: Team[];
  createdAt: number;
  updatedAt: number;
};

export type GameSession = {
  gameId: string;
  started: boolean;
  roundIndex: number;
  activeQuestionId: string | null;
  completedQuestionIds: string[];
  scores: Record<string, number>;
  awardedTeamId: string | null;
  answerRevealed: boolean;
  activeExcludedTeamIds: string[];
  currentIncorrectTeamIds: string[];
  nextExcludedTeamIds: string[];
};

export type PersistedState = {
  version: 2;
  games: GameConfig[];
  songs: Song[];
  audioAssets: AudioAsset[];
  sessions: GameSession[];
  activeGameId: string | null;
};

export type LegacyAudioAsset = Omit<AudioAsset, 'id'>;

export type LegacyQuestion = {
  id: string;
  points: number;
  title: string;
  artist: string;
  minus?: LegacyAudioAsset;
  plus?: LegacyAudioAsset;
};

export type LegacyGameConfig = {
  title: string;
  rounds: Array<{
    id: string;
    name: string;
    categories: Array<{
      id: string;
      name: string;
      questions: LegacyQuestion[];
    }>;
  }>;
  teams: Team[];
};

export type LegacyPersistedState = {
  config: LegacyGameConfig;
  session: Omit<GameSession, 'gameId' | 'currentIncorrectTeamIds'> & { currentIncorrectTeamIds?: string[] };
};

export type PlayableQuestion = Question & {
  song?: Song;
  minus?: AudioAsset;
  plus?: AudioAsset;
};

export type Screen = 'library' | 'media' | 'settings' | 'game' | 'admin';
