import { combine, createEvent, merge, sample } from 'effector';
import { createSession } from '../defaults';
import {
  findQuestion,
  getActiveStage,
  getInterRoundForStage,
  getRoundForStage,
  getRoundOrdinal,
} from '../session';
import { $audioAssets, $games, $mediaTracks, $sessions, $songs } from '../core/state';
import { $activeGame, $session } from './selectors';
import {
  canNavigateBack,
  transitionGameSession,
  type GameSessionCommand,
} from './domain/sessionTransitions';
import { resolvePlayableQuestion } from './domain/sessionSelectors';
import type { PlayableQuestion } from '../types';

export const gameProgressResetRequested = createEvent();
export const questionOpened = createEvent<string>();
export const questionClosed = createEvent<{ completed: boolean; advanceStage?: boolean }>();
export const teamAwarded = createEvent<string>();
export const teamIncorrectToggled = createEvent<string>();
export const nobodyGuessed = createEvent();
export const teamScoreChanged = createEvent<{ teamId: string; score: number }>();
export const nextStageRequested = createEvent();
export const previousStageRequested = createEvent();
export const interRoundStarted = createEvent();
export const interRoundAnswerRevealed = createEvent();
export const commonThemeTrackAdvanced = createEvent();
export const interRoundNextRequested = createEvent();

export const gameSessionResetRequested = createEvent<string>();

sample({
  clock: gameProgressResetRequested,
  source: $activeGame,
  filter: (game) => Boolean(game),
  fn: (game) => game!.id,
  target: gameSessionResetRequested,
});

sample({
  clock: gameSessionResetRequested,
  source: combine({ games: $games, sessions: $sessions }),
  filter: ({ games }, gameId) => games.some((game) => game.id === gameId),
  fn: ({ games, sessions }, gameId) => {
    const game = games.find((item) => item.id === gameId)!;
    return { ...sessions, [gameId]: createSession(game) };
  },
  target: $sessions,
});

const gameSessionCommandRequested = merge([
  questionOpened.map((questionId): GameSessionCommand => ({ type: 'openQuestion', questionId })),
  questionClosed.map(({ completed, advanceStage }): GameSessionCommand => ({ type: 'closeQuestion', completed, advanceStage })),
  teamAwarded.map((teamId): GameSessionCommand => ({ type: 'awardTeam', teamId })),
  teamIncorrectToggled.map((teamId): GameSessionCommand => ({ type: 'markTeamIncorrect', teamId })),
  nobodyGuessed.map((): GameSessionCommand => ({ type: 'nobodyGuessed' })),
  teamScoreChanged.map(({ teamId, score }): GameSessionCommand => ({ type: 'changeTeamScore', teamId, score })),
  nextStageRequested.map((): GameSessionCommand => ({ type: 'nextStage' })),
  previousStageRequested.map((): GameSessionCommand => ({ type: 'previousStage' })),
  interRoundStarted.map((): GameSessionCommand => ({ type: 'startInterRound' })),
  interRoundAnswerRevealed.map((): GameSessionCommand => ({ type: 'revealInterRoundAnswer' })),
  commonThemeTrackAdvanced.map((): GameSessionCommand => ({ type: 'advanceCommonThemeTrack' })),
  interRoundNextRequested.map((): GameSessionCommand => ({ type: 'nextInterRoundStep' })),
]);

sample({
  clock: gameSessionCommandRequested,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => Boolean(game && sessions[game.id]),
  fn: ({ game, sessions }, command) => {
    const session = sessions[game!.id];
    const nextSession = transitionGameSession(game!, session, command);
    return nextSession === session
      ? sessions
      : { ...sessions, [game!.id]: nextSession };
  },
  target: $sessions,
});

export const $canGoToPreviousStage = combine($activeGame, $session, (game, session) =>
  Boolean(game && session && canNavigateBack(session)),
);

export const $activeStage = combine($activeGame, $session, (game, session) =>
  game && session ? getActiveStage(game, session) : null,
);

export const $activeRound = combine($activeGame, $activeStage, (game, stage) =>
  game ? getRoundForStage(game, stage) : null,
);

export const $activeInterRound = combine($activeGame, $activeStage, (game, stage) =>
  game ? getInterRoundForStage(game, stage) : null,
);

export const $activeRoundOrdinal = combine($activeGame, $session, (game, session) =>
  game && session ? getRoundOrdinal(game, session.stageIndex) : 1,
);

export const $activeQuestion = combine(
  {
    game: $activeGame,
    session: $session,
    songs: $songs,
    mediaTracks: $mediaTracks,
    audioAssets: $audioAssets,
  },
  ({ game, session, songs, mediaTracks, audioAssets }): PlayableQuestion | null => {
    if (!game || !session?.activeQuestionId) return null;
    const question = findQuestion(game, session.activeQuestionId);
    return question ? resolvePlayableQuestion(question, songs, mediaTracks, audioAssets) : null;
  },
);

export const $isGameFinished = combine($activeGame, $session, (game, session) =>
  Boolean(game && session && session.stageIndex >= game.stages.length),
);
