export type AudioAsset = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly blob: Blob;
  readonly sha256: string;
  readonly verified: true;
};

export type MediaTrack = {
  id: string;
  name: string;
  audioId: string;
  createdAt: number;
  updatedAt: number;
};

export type Song = {
  id: string;
  artist: string;
  title: string;
  minusTrackId?: string;
  plusTrackId?: string;
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

export type InterRoundTemplateId = 'continueLyrics' | 'commonTheme4';

export type ContinueLyricsTask = {
  id: string;
  trackId?: string;
  requiredWordsCount: number;
  cutAtMs: number;
  answerText: string;
};

export type ContinueLyricsInterRound = {
  id: string;
  templateId: 'continueLyrics';
  templateVersion: 1;
  title: string;
  tasks: ContinueLyricsTask[];
};

export type CommonThemeTrack = {
  id: string;
  trackId?: string;
  answerTitle: string;
  answerArtist: string;
};

export type CommonThemeStage = {
  id: string;
  tracks: [CommonThemeTrack, CommonThemeTrack, CommonThemeTrack, CommonThemeTrack];
  commonTheme: string;
};

export type CommonTheme4InterRound = {
  id: string;
  templateId: 'commonTheme4';
  templateVersion: 2;
  title: string;
  stages: CommonThemeStage[];
};

export type InterRound = ContinueLyricsInterRound | CommonTheme4InterRound;

export type GameStage =
  | { id: string; kind: 'round'; roundId: string }
  | { id: string; kind: 'interRound'; interRoundId: string };

export type GameConfig = {
  id: string;
  title: string;
  rounds: Round[];
  interRounds: InterRound[];
  stages: GameStage[];
  teams: Team[];
  createdAt: number;
  updatedAt: number;
};

export type InterRoundPlayPhase = 'intro' | 'play' | 'answer';

export type InterRoundSession = {
  interRoundId: string;
  phase: InterRoundPlayPhase;
  taskIndex: number;
  /** Stable identity of the current continue-lyrics task or common-theme stage. */
  itemId: string | null;
  trackIndex: number;
};

export type GameSessionHistoryEntry = {
  started: boolean;
  stageIndex: number;
  /** Stable identity of the active stage at the time of the checkpoint. */
  stageId: string | null;
  activeQuestionId: string | null;
  pausedQuestionId: string | null;
  completedQuestionIds: string[];
  completedInterRoundIds: string[];
  interRound: InterRoundSession | null;
  scores: Record<string, number>;
  awardedTeamId: string | null;
  answerRevealed: boolean;
  activeExcludedTeamIds: string[];
  currentIncorrectTeamIds: string[];
  nextExcludedTeamIds: string[];
};

export type GameSession = GameSessionHistoryEntry & {
  gameId: string;
  /** Previous visible gameplay states. The latest entry is restored by the Back action. */
  history: GameSessionHistoryEntry[];
  /** Last meaningful gameplay/session change. Used to choose the most recently played saved game. */
  updatedAt: number;
};

export type PersistedState = {
  version: 4;
  games: GameConfig[];
  songs: Song[];
  mediaTracks: MediaTrack[];
  audioAssets: AudioAsset[];
  sessions: GameSession[];
  activeGameId: string | null;
};

export type LegacyAudioAsset = {
  name: string;
  type: string;
  size?: number;
  blob: Blob;
};

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
  session: {
    started?: boolean;
    roundIndex?: number;
    activeQuestionId?: string | null;
    completedQuestionIds?: string[];
    scores?: Record<string, number>;
    awardedTeamId?: string | null;
    answerRevealed?: boolean;
    activeExcludedTeamIds?: string[];
    currentIncorrectTeamIds?: string[];
    nextExcludedTeamIds?: string[];
  };
};

export type PlayableQuestion = Question & {
  song?: Song;
  minusTrack?: MediaTrack;
  plusTrack?: MediaTrack;
  minus?: AudioAsset;
  plus?: AudioAsset;
};

export type Screen = 'library' | 'media' | 'vocal-removal' | 'settings' | 'game' | 'admin';
