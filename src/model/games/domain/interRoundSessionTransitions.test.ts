import { describe, expect, it } from 'vitest';
import { createGame, createInterRoundStage, createSession } from '../../defaults';
import { createCommonTheme4InterRound, createCommonThemeStage } from '../../../interRounds/templates';
import { transitionGameSession } from './sessionTransitions';

const NOW = () => 1_900_000_000_000;

function createMultiStageCommonThemeGame() {
  const game = createGame('Common theme final answers');
  const interRound = createCommonTheme4InterRound();
  interRound.stages.push(createCommonThemeStage());
  const interRoundStage = createInterRoundStage(interRound.id);
  game.interRounds = [interRound];
  game.stages = [interRoundStage];
  return { game, interRound };
}

function advanceFourTracks(game: ReturnType<typeof createGame>, session: ReturnType<typeof createSession>) {
  let next = session;
  for (let index = 0; index < 4; index += 1) {
    next = transitionGameSession(game, next, { type: 'advanceCommonThemeTrack' }, NOW);
  }
  return next;
}

describe('common-theme inter-round answer flow', () => {
  it('reveals answers only after every stage has been played', () => {
    const { game, interRound } = createMultiStageCommonThemeGame();
    let session = createSession(game);

    session = transitionGameSession(game, session, { type: 'startInterRound' }, NOW);
    session = advanceFourTracks(game, session);

    expect(session.interRound).toMatchObject({ phase: 'play', taskIndex: 0, trackIndex: 4 });

    const earlyReveal = transitionGameSession(game, session, { type: 'revealInterRoundAnswer' }, NOW);
    expect(earlyReveal).toBe(session);

    session = transitionGameSession(game, session, { type: 'nextInterRoundStep' }, NOW);
    expect(session.interRound).toMatchObject({ phase: 'play', taskIndex: 1, trackIndex: 0 });

    session = advanceFourTracks(game, session);
    expect(session.interRound).toMatchObject({ phase: 'play', taskIndex: 1, trackIndex: 4 });

    session = transitionGameSession(game, session, { type: 'revealInterRoundAnswer' }, NOW);
    expect(session.interRound).toMatchObject({ phase: 'answer', taskIndex: 1, trackIndex: 4 });

    session = transitionGameSession(game, session, { type: 'nextInterRoundStep' }, NOW);
    expect(session.interRound).toBeNull();
    expect(session.completedInterRoundIds).toContain(interRound.id);
    expect(session.stageIndex).toBe(game.stages.length);
  });

  it('goes back from the next stage to the completed previous stage without revealing answers', () => {
    const { game } = createMultiStageCommonThemeGame();
    let session = createSession(game);

    session = transitionGameSession(game, session, { type: 'startInterRound' }, NOW);
    session = advanceFourTracks(game, session);
    session = transitionGameSession(game, session, { type: 'nextInterRoundStep' }, NOW);

    expect(session.interRound).toMatchObject({ phase: 'play', taskIndex: 1, trackIndex: 0 });

    session = transitionGameSession(game, session, { type: 'previousStage' }, NOW);
    expect(session.interRound).toMatchObject({ phase: 'play', taskIndex: 0, trackIndex: 4 });
  });
});
