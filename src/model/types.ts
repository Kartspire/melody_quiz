export type AudioAsset = {
  name: string;
  type: string;
  size: number;
  blob: Blob;
};

export type Question = {
  id: string;
  points: number;
  title: string;
  artist: string;
  minus?: AudioAsset;
  plus?: AudioAsset;
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
  title: string;
  rounds: Round[];
  teams: Team[];
};

export type GameSession = {
  started: boolean;
  roundIndex: number;
  activeQuestionId: string | null;
  completedQuestionIds: string[];
  scores: Record<string, number>;
  awardedTeamId: string | null;
};

export type PersistedState = {
  config: GameConfig;
  session: GameSession;
};

export type Screen = 'game' | 'admin';
