import { getGameStartIssues, getSessionContinuationIssues } from './validation';
import type { AudioAsset, GameConfig, GameSession, MediaTrack, Song } from './types';

export type GameLaunchMode = 'continue' | 'fresh' | 'restart';

export type GameLaunchRequest = {
  gameId: string;
  mode: GameLaunchMode;
};

export type GameLaunchDecision =
  | {
      type: 'ready';
      gameId: string;
      resetSession: boolean;
    }
  | {
      type: 'invalid';
      gameId: string;
      gameTitle: string;
      issues: string[];
    }
  | {
      type: 'confirm-restart';
      gameId: string;
      gameTitle: string;
    };

export type GameLaunchPrompt = Extract<GameLaunchDecision, { type: 'invalid' | 'confirm-restart' }>;

export type EvaluateGameLaunchInput = {
  request: GameLaunchRequest;
  game: GameConfig;
  session?: GameSession | null;
  songs: Song[];
  mediaTracks: MediaTrack[];
  audioAssets: AudioAsset[];
};

export function evaluateGameLaunch({
  request,
  game,
  session,
  songs,
  mediaTracks,
  audioAssets,
}: EvaluateGameLaunchInput): GameLaunchDecision {
  const finished = Boolean(session && session.stageIndex >= game.stages.length);

  if (request.mode === 'continue') {
    const issues = finished
      ? []
      : hasSessionProgress(session)
        ? getSessionContinuationIssues(game, session ?? undefined, songs, mediaTracks, audioAssets)
        : getGameStartIssues(game, songs, mediaTracks, audioAssets);

    if (issues.length > 0) return invalidDecision(game, issues);

    return {
      type: 'ready',
      gameId: game.id,
      // A game gets a placeholder clean session as soon as it is created in the editor.
      // Recreate that untouched session on the first real launch so derived launch state
      // (including the random selector for the first round) uses the final team list.
      resetSession: !session || !hasSessionProgress(session),
    };
  }

  const issues = getGameStartIssues(game, songs, mediaTracks, audioAssets);
  if (issues.length > 0) return invalidDecision(game, issues);

  if (request.mode === 'fresh' && hasSessionProgress(session)) {
    return {
      type: 'confirm-restart',
      gameId: game.id,
      gameTitle: game.title,
    };
  }

  return {
    type: 'ready',
    gameId: game.id,
    resetSession: true,
  };
}

export function hasSessionProgress(session?: GameSession | null) {
  return Boolean(
    session &&
      (session.started ||
        session.completedQuestionIds.length > 0 ||
        Object.values(session.scores).some((score) => score !== 0) ||
        session.stageIndex > 0 ||
        session.completedInterRoundIds.length > 0),
  );
}

function invalidDecision(game: GameConfig, issues: string[]): GameLaunchDecision {
  return {
    type: 'invalid',
    gameId: game.id,
    gameTitle: game.title,
    issues,
  };
}
