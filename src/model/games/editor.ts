import { combine, createEvent, sample } from 'effector';
import {
  createCategory,
  createInterRoundStage,
  createQuestion,
  createRound,
  createRoundStage,
  createSession,
  createTeam,
} from '../defaults';
import { DATA_LIMITS, EDITOR_LIMITS, GAME_LIMITS } from '../limits';
import {
  getNextQuestionPoints,
  isPersistableTeamName,
  isQuestionPointsAvailable,
  isTeamColorAvailable,
  isTeamNameAvailable,
  isValidContinueLyricsCutAtMs,
  isValidContinueLyricsRequiredWordsCount,
  isValidTeamColor,
} from '../rules';
import { reconcileSession } from '../session';
import {
  createCommonThemeStage,
  createContinueLyricsTask,
  createInterRound,
} from '../../interRounds/templates';
import { $games, $mediaTracks, $sessions, $songs } from '../core/state';
import { $activeGame } from './selectors';
import type { GameConfig, InterRound, InterRoundTemplateId, Question, Team } from '../types';

export const gameTitleChanged = createEvent<string>();
export const roundAdded = createEvent();
export const roundRemoved = createEvent<string>();
export const roundNameChanged = createEvent<{ roundId: string; name: string }>();
export const stageMoved = createEvent<{ stageId: string; direction: -1 | 1 }>();
export const interRoundAdded = createEvent<InterRoundTemplateId>();
export const interRoundRemoved = createEvent<string>();
export const interRoundTitleChanged = createEvent<{ interRoundId: string; title: string }>();
export const continueLyricsTaskAdded = createEvent<string>();
export const continueLyricsTaskRemoved = createEvent<{ interRoundId: string; taskId: string }>();
export const continueLyricsTaskChanged = createEvent<{
  interRoundId: string;
  taskId: string;
  patch: Partial<Pick<
    Extract<InterRound, { templateId: 'continueLyrics' }>['tasks'][number],
    'trackId' | 'requiredWordsCount' | 'cutAtMs' | 'answerText'
  >>;
}>();
export const commonThemeStageAdded = createEvent<string>();
export const commonThemeStageRemoved = createEvent<{ interRoundId: string; stageId: string }>();
export const commonThemeTrackChanged = createEvent<{
  interRoundId: string;
  stageId: string;
  itemId: string;
  patch: Partial<Pick<
    Extract<InterRound, { templateId: 'commonTheme4' }>['stages'][number]['tracks'][number],
    'trackId' | 'answerTitle' | 'answerArtist'
  >>;
}>();
export const commonThemeChanged = createEvent<{ interRoundId: string; stageId: string; commonTheme: string }>();
export const categoryAdded = createEvent<{ roundId: string }>();
export const categoryRemoved = createEvent<{ roundId: string; categoryId: string }>();
export const categoryNameChanged = createEvent<{ roundId: string; categoryId: string; name: string }>();
export const questionAdded = createEvent<{ roundId: string; categoryId: string }>();
export const questionRemoved = createEvent<{ roundId: string; categoryId: string; questionId: string }>();
export const questionChanged = createEvent<{
  roundId: string;
  categoryId: string;
  questionId: string;
  patch: Partial<Pick<Question, 'points'>>;
}>();
export const questionSongChanged = createEvent<{
  roundId: string;
  categoryId: string;
  questionId: string;
  songId?: string;
}>();
export const teamAdded = createEvent();
export const teamRemoved = createEvent<string>();
export const teamChanged = createEvent<{ teamId: string; patch: Partial<Pick<Team, 'name' | 'color'>> }>();

const gameConfigUpdated = createEvent<GameConfig>();
const activeGameSource = combine({ game: $activeGame });

$games.on(gameConfigUpdated, (games, updated) =>
  games.map((game) => game.id === updated.id ? updated : game),
);

sample({
  clock: gameTitleChanged,
  source: activeGameSource,
  filter: ({ game }, title) => Boolean(game && title.length <= DATA_LIMITS.text.gameTitle && game.title !== title),
  fn: ({ game }, title) => touchGame({ ...game!, title }),
  target: gameConfigUpdated,
});

sample({
  clock: roundAdded,
  source: activeGameSource,
  filter: ({ game }) => Boolean(game && game.rounds.length < GAME_LIMITS.rounds),
  fn: ({ game }) => {
    const round = createRound(game!.rounds.length);
    return touchGame({
      ...game!,
      rounds: [...game!.rounds, round],
      stages: [...game!.stages, createRoundStage(round.id)],
    });
  },
  target: gameConfigUpdated,
});

sample({
  clock: roundRemoved,
  source: activeGameSource,
  filter: ({ game }, roundId) => Boolean(
    game && game.rounds.length > 1 && game.rounds.some((round) => round.id === roundId),
  ),
  fn: ({ game }, roundId) => touchGame({
    ...game!,
    rounds: game!.rounds.filter((round) => round.id !== roundId),
    stages: game!.stages.filter((stage) => stage.kind !== 'round' || stage.roundId !== roundId),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: roundNameChanged,
  source: activeGameSource,
  filter: ({ game }, { roundId, name }) => Boolean(game && name.length <= DATA_LIMITS.text.roundName && game.rounds.some((round) => round.id === roundId && round.name !== name)),
  fn: ({ game }, payload) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) => round.id === payload.roundId ? { ...round, name: payload.name } : round),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: stageMoved,
  source: activeGameSource,
  filter: ({ game }, { stageId, direction }) => {
    if (!game) return false;
    const index = game.stages.findIndex((stage) => stage.id === stageId);
    const nextIndex = index + direction;
    return index >= 0 && nextIndex >= 0 && nextIndex < game.stages.length;
  },
  fn: ({ game }, { stageId, direction }) => {
    const stages = [...game!.stages];
    const index = stages.findIndex((stage) => stage.id === stageId);
    const nextIndex = index + direction;
    [stages[index], stages[nextIndex]] = [stages[nextIndex], stages[index]];
    return touchGame({ ...game!, stages });
  },
  target: gameConfigUpdated,
});

sample({
  clock: interRoundAdded,
  source: activeGameSource,
  filter: ({ game }) => Boolean(game && game.interRounds.length < GAME_LIMITS.interRounds),
  fn: ({ game }, templateId) => {
    const interRound = createInterRound(
      templateId,
      game!.interRounds.filter((item) => item.templateId === templateId).length,
    );
    return touchGame({
      ...game!,
      interRounds: [...game!.interRounds, interRound],
      stages: [...game!.stages, createInterRoundStage(interRound.id)],
    });
  },
  target: gameConfigUpdated,
});

sample({
  clock: interRoundRemoved,
  source: activeGameSource,
  filter: ({ game }, interRoundId) => Boolean(game?.interRounds.some((item) => item.id === interRoundId)),
  fn: ({ game }, interRoundId) => touchGame({
    ...game!,
    interRounds: game!.interRounds.filter((item) => item.id !== interRoundId),
    stages: game!.stages.filter((stage) => stage.kind !== 'interRound' || stage.interRoundId !== interRoundId),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: interRoundTitleChanged,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, title }) => Boolean(
    game
    && title.length <= DATA_LIMITS.text.interRoundTitle
    && game.interRounds.some((item) => item.id === interRoundId && item.title !== title),
  ),
  fn: ({ game }, { interRoundId, title }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId ? { ...item, title } : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: continueLyricsTaskAdded,
  source: activeGameSource,
  filter: ({ game }, interRoundId) => Boolean(game?.interRounds.some(
    (item) => item.id === interRoundId
      && item.templateId === 'continueLyrics'
      && item.tasks.length < GAME_LIMITS.continueLyricsTasks,
  )),
  fn: ({ game }, interRoundId) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'continueLyrics'
      ? { ...item, tasks: [...item.tasks, createContinueLyricsTask()] }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: continueLyricsTaskRemoved,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, taskId }) => Boolean(game?.interRounds.some(
    (item) => item.id === interRoundId
      && item.templateId === 'continueLyrics'
      && item.tasks.length > 1
      && item.tasks.some((task) => task.id === taskId),
  )),
  fn: ({ game }, { interRoundId, taskId }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'continueLyrics'
      ? { ...item, tasks: item.tasks.filter((task) => task.id !== taskId) }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: continueLyricsTaskChanged,
  source: combine({ game: $activeGame, mediaTracks: $mediaTracks }),
  filter: ({ game, mediaTracks }, { interRoundId, taskId, patch }) => {
    if (!game) return false;
    const interRound = game.interRounds.find((item) => item.id === interRoundId);
    if (interRound?.templateId !== 'continueLyrics') return false;
    const task = interRound.tasks.find((item) => item.id === taskId);
    if (!task) return false;
    if (patch.answerText !== undefined && patch.answerText.length > DATA_LIMITS.text.interRoundAnswer) return false;
    if (patch.trackId !== undefined && (patch.trackId.length > DATA_LIMITS.text.id || !mediaTracks.some((track) => track.id === patch.trackId))) return false;
    if (patch.requiredWordsCount !== undefined && !isValidContinueLyricsRequiredWordsCount(patch.requiredWordsCount)) return false;
    if (patch.cutAtMs !== undefined && !isValidContinueLyricsCutAtMs(patch.cutAtMs)) return false;
    return Object.entries(patch).some(([key, value]) => task[key as keyof typeof task] !== value);
  },
  fn: ({ game }, { interRoundId, taskId, patch }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'continueLyrics'
      ? { ...item, tasks: item.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task) }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: commonThemeStageAdded,
  source: activeGameSource,
  filter: ({ game }, interRoundId) => Boolean(game && game.interRounds.some(
    (item) => item.id === interRoundId
      && item.templateId === 'commonTheme4'
      && item.stages.length < GAME_LIMITS.commonThemeStages,
  )),
  fn: ({ game }, interRoundId) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'commonTheme4'
      ? { ...item, stages: [...item.stages, createCommonThemeStage()] }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: commonThemeStageRemoved,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, stageId }) => Boolean(game && game.interRounds.some(
    (item) => item.id === interRoundId
      && item.templateId === 'commonTheme4'
      && item.stages.length > 1
      && item.stages.some((stage) => stage.id === stageId),
  )),
  fn: ({ game }, { interRoundId, stageId }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'commonTheme4'
      ? { ...item, stages: item.stages.filter((stage) => stage.id !== stageId) }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: commonThemeTrackChanged,
  source: combine({ game: $activeGame, mediaTracks: $mediaTracks }),
  filter: ({ game, mediaTracks }, { interRoundId, stageId, itemId, patch }) => {
    if (!game) return false;
    const interRound = game.interRounds.find((item) => item.id === interRoundId);
    if (interRound?.templateId !== 'commonTheme4') return false;
    const track = interRound.stages.find((stage) => stage.id === stageId)
      ?.tracks.find((item) => item.id === itemId);
    if (!track) return false;
    if (patch.answerTitle !== undefined && patch.answerTitle.length > DATA_LIMITS.text.songTitle) return false;
    if (patch.answerArtist !== undefined && patch.answerArtist.length > DATA_LIMITS.text.artist) return false;
    if (patch.trackId !== undefined && (patch.trackId.length > DATA_LIMITS.text.id || !mediaTracks.some((item) => item.id === patch.trackId))) return false;
    return Object.entries(patch).some(([key, value]) => track[key as keyof typeof track] !== value);
  },
  fn: ({ game }, { interRoundId, stageId, itemId, patch }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'commonTheme4'
      ? {
          ...item,
          stages: item.stages.map((stage) => stage.id === stageId
            ? {
                ...stage,
                tracks: stage.tracks.map((track) => track.id === itemId ? { ...track, ...patch } : track) as typeof stage.tracks,
              }
            : stage),
        }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: commonThemeChanged,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, stageId, commonTheme }) => Boolean(
    game
    && commonTheme.length <= DATA_LIMITS.text.commonTheme
    && game.interRounds.some((item) => item.id === interRoundId
      && item.templateId === 'commonTheme4'
      && item.stages.some((stage) => stage.id === stageId && stage.commonTheme !== commonTheme)),
  ),
  fn: ({ game }, { interRoundId, stageId, commonTheme }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'commonTheme4'
      ? { ...item, stages: item.stages.map((stage) => stage.id === stageId ? { ...stage, commonTheme } : stage) }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: categoryAdded,
  source: activeGameSource,
  filter: ({ game }, { roundId }) => Boolean(
    game && game.rounds.some((round) =>
      round.id === roundId && round.categories.length < EDITOR_LIMITS.categoriesPerRound,
    ),
  ),
  fn: ({ game }, { roundId }) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) =>
      round.id === roundId
        ? { ...round, categories: [...round.categories, createCategory(round.categories.length)] }
        : round,
    ),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: categoryRemoved,
  source: activeGameSource,
  filter: ({ game }, { roundId, categoryId }) => Boolean(
    game && game.rounds.some((round) =>
      round.id === roundId
      && round.categories.length > 1
      && round.categories.some((category) => category.id === categoryId),
    ),
  ),
  fn: ({ game }, { roundId, categoryId }) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) => round.id === roundId
      ? { ...round, categories: round.categories.filter((category) => category.id !== categoryId) }
      : round),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: categoryNameChanged,
  source: activeGameSource,
  filter: ({ game }, { roundId, categoryId, name }) => Boolean(game && name.length <= DATA_LIMITS.text.categoryName && game.rounds.some((round) => round.id === roundId && round.categories.some((category) => category.id === categoryId && category.name !== name))),
  fn: ({ game }, payload) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) => round.id === payload.roundId
      ? {
          ...round,
          categories: round.categories.map((category) =>
            category.id === payload.categoryId ? { ...category, name: payload.name } : category,
          ),
        }
      : round),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: questionAdded,
  source: activeGameSource,
  filter: ({ game }, { roundId, categoryId }) => Boolean(
    game && game.rounds.some((round) => round.id === roundId && round.categories.some(
      (category) => category.id === categoryId && category.questions.length < EDITOR_LIMITS.questionsPerCategory,
    )),
  ),
  fn: ({ game }, { roundId, categoryId }) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) => round.id === roundId
      ? {
          ...round,
          categories: round.categories.map((category) => {
            if (category.id !== categoryId) return category;
            const points = getNextQuestionPoints(category.questions);
            return { ...category, questions: [...category.questions, createQuestion(points)] };
          }),
        }
      : round),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: questionRemoved,
  source: activeGameSource,
  filter: ({ game }, payload) => Boolean(
    game && game.rounds.some((round) => round.id === payload.roundId && round.categories.some(
      (category) => category.id === payload.categoryId
        && category.questions.length > 1
        && category.questions.some((question) => question.id === payload.questionId),
    )),
  ),
  fn: ({ game }, payload) => touchGame(updateQuestionCollection(game!, payload, (questions) =>
    questions.filter((question) => question.id !== payload.questionId),
  )),
  target: gameConfigUpdated,
});

sample({
  clock: questionChanged,
  source: activeGameSource,
  filter: ({ game }, { roundId, categoryId, questionId, patch }) => {
    if (!game) return false;
    const category = game.rounds
      .find((round) => round.id === roundId)
      ?.categories.find((item) => item.id === categoryId);
    const question = category?.questions.find((item) => item.id === questionId);
    if (!category || !question) return false;
    if (patch.points === undefined) return false;
    return patch.points !== question.points && isQuestionPointsAvailable(category.questions, questionId, patch.points);
  },
  fn: ({ game }, payload) => touchGame(
    updateQuestion(game!, payload, (question) => ({ ...question, ...payload.patch })),
  ),
  target: gameConfigUpdated,
});

sample({
  clock: questionSongChanged,
  source: combine({ game: $activeGame, songs: $songs }),
  filter: ({ game, songs }, { roundId, categoryId, questionId, songId }) => {
    if (!game || (songId && !songs.some((song) => song.id === songId))) return false;
    const question = game.rounds.find((round) => round.id === roundId)
      ?.categories.find((category) => category.id === categoryId)
      ?.questions.find((item) => item.id === questionId);
    return Boolean(question && question.songId !== songId);
  },
  fn: ({ game }, payload) => touchGame(
    updateQuestion(game!, payload, (question) => ({ ...question, songId: payload.songId })),
  ),
  target: gameConfigUpdated,
});

sample({
  clock: teamAdded,
  source: activeGameSource,
  filter: ({ game }) => Boolean(game && game.teams.length < GAME_LIMITS.teams),
  fn: ({ game }) => touchGame({ ...game!, teams: [...game!.teams, createTeam(game!.teams.length)] }),
  target: gameConfigUpdated,
});

sample({
  clock: teamRemoved,
  source: activeGameSource,
  filter: ({ game }, teamId) => Boolean(game && game.teams.length > 1 && game.teams.some((team) => team.id === teamId)),
  fn: ({ game }, teamId) => touchGame({
    ...game!,
    teams: game!.teams.filter((team) => team.id !== teamId),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: teamChanged,
  source: activeGameSource,
  filter: ({ game }, { teamId, patch }) => {
    if (!game) return false;
    const team = game.teams.find((item) => item.id === teamId);
    if (!team) return false;
    if (
      patch.name !== undefined
      && (!isPersistableTeamName(patch.name) || !isTeamNameAvailable(game.teams, teamId, patch.name))
    ) return false;
    if (
      patch.color !== undefined
      && (!isValidTeamColor(patch.color) || !isTeamColorAvailable(game.teams, teamId, patch.color))
    ) return false;
    return (patch.name !== undefined && patch.name !== team.name)
      || (patch.color !== undefined && patch.color.toLowerCase() !== team.color.toLowerCase());
  },
  fn: ({ game }, { teamId, patch }) => touchGame({
    ...game!,
    teams: game!.teams.map((team) => team.id === teamId ? { ...team, ...patch } : team),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: gameConfigUpdated,
  source: $sessions,
  fn: (sessions, config) => ({
    ...sessions,
    [config.id]: reconcileSession(config, sessions[config.id] ?? createSession(config)),
  }),
  target: $sessions,
});

function updateQuestion(
  state: GameConfig,
  payload: { roundId: string; categoryId: string; questionId: string },
  updater: (question: Question) => Question,
): GameConfig {
  return updateQuestionCollection(state, payload, (questions) =>
    questions.map((question) => question.id === payload.questionId ? updater(question) : question),
  );
}

function updateQuestionCollection(
  state: GameConfig,
  payload: { roundId: string; categoryId: string },
  updater: (questions: Question[]) => Question[],
): GameConfig {
  return {
    ...state,
    rounds: state.rounds.map((round) => round.id === payload.roundId
      ? {
          ...round,
          categories: round.categories.map((category) =>
            category.id === payload.categoryId
              ? { ...category, questions: updater(category.questions) }
              : category,
          ),
        }
      : round),
  };
}

function touchGame(game: GameConfig): GameConfig {
  return { ...game, updatedAt: Date.now() };
}
