import {
  createCategory,
  createInterRoundStage,
  createQuestion,
  createRound,
  createRoundStage,
  createTeam,
} from '../../defaults';
import { DATA_LIMITS, EDITOR_LIMITS, GAME_LIMITS } from '../../limits';
import {
  getNextQuestionPoints,
  isPersistableTeamName,
  isQuestionPointsAvailable,
  isTeamColorAvailable,
  isTeamNameAvailable,
  isValidContinueLyricsCutAtMs,
  isValidContinueLyricsRequiredWordsCount,
  isValidTeamColor,
} from '../../rules';
import {
  createCommonThemeStage,
  createContinueLyricsTask,
  createInterRound,
} from '../../../interRounds/templates';
import type { GameConfig, InterRound, InterRoundTemplateId, Question, Team } from '../../types';

export type GameEditorCommand =
  | { type: 'changeGameTitle'; title: string }
  | { type: 'addRound' }
  | { type: 'removeRound'; roundId: string }
  | { type: 'changeRoundName'; roundId: string; name: string }
  | { type: 'moveStage'; stageId: string; direction: -1 | 1 }
  | { type: 'addInterRound'; templateId: InterRoundTemplateId }
  | { type: 'removeInterRound'; interRoundId: string }
  | { type: 'changeInterRoundTitle'; interRoundId: string; title: string }
  | { type: 'addContinueLyricsTask'; interRoundId: string }
  | { type: 'removeContinueLyricsTask'; interRoundId: string; taskId: string }
  | {
      type: 'changeContinueLyricsTask';
      interRoundId: string;
      taskId: string;
      patch: Partial<Pick<
        Extract<InterRound, { templateId: 'continueLyrics' }>['tasks'][number],
        'trackId' | 'requiredWordsCount' | 'cutAtMs' | 'answerText'
      >>;
    }
  | { type: 'addCommonThemeStage'; interRoundId: string }
  | { type: 'removeCommonThemeStage'; interRoundId: string; stageId: string }
  | {
      type: 'changeCommonThemeTrack';
      interRoundId: string;
      stageId: string;
      itemId: string;
      patch: Partial<Pick<
        Extract<InterRound, { templateId: 'commonTheme4' }>['stages'][number]['tracks'][number],
        'trackId' | 'answerTitle' | 'answerArtist'
      >>;
    }
  | { type: 'changeCommonTheme'; interRoundId: string; stageId: string; commonTheme: string }
  | { type: 'addCategory'; roundId: string }
  | { type: 'removeCategory'; roundId: string; categoryId: string }
  | { type: 'changeCategoryName'; roundId: string; categoryId: string; name: string }
  | { type: 'addQuestion'; roundId: string; categoryId: string }
  | { type: 'removeQuestion'; roundId: string; categoryId: string; questionId: string }
  | {
      type: 'changeQuestion';
      roundId: string;
      categoryId: string;
      questionId: string;
      patch: Partial<Pick<Question, 'points'>>;
    }
  | { type: 'changeQuestionSong'; roundId: string; categoryId: string; questionId: string; songId?: string }
  | { type: 'addTeam' }
  | { type: 'removeTeam'; teamId: string }
  | { type: 'changeTeam'; teamId: string; patch: Partial<Pick<Team, 'name' | 'color'>> };

export type GameEditorCommandContext = {
  hasMediaTrack?: (trackId: string) => boolean;
  hasSong?: (songId: string) => boolean;
  now?: () => number;
};

export type GameEditorCommandResult = {
  game: GameConfig;
  changed: boolean;
  /** Structural changes can invalidate the saved play session and must be reconciled. */
  sessionImpact: 'none' | 'reconcile';
};

export function applyGameEditorCommand(
  game: GameConfig,
  command: GameEditorCommand,
  context: GameEditorCommandContext = {},
): GameEditorCommandResult {
  const now = context.now ?? Date.now;
  const hasMediaTrack = context.hasMediaTrack ?? alwaysFalse;
  const hasSong = context.hasSong ?? alwaysFalse;

  switch (command.type) {
    case 'changeGameTitle': {
      if (command.title.length > DATA_LIMITS.text.gameTitle || game.title === command.title) return unchanged(game);
      return changed(touchGame({ ...game, title: command.title }, now), 'none');
    }

    case 'addRound': {
      if (game.rounds.length >= GAME_LIMITS.rounds) return unchanged(game);
      const round = createRound(game.rounds.length);
      return changed(touchGame({
        ...game,
        rounds: [...game.rounds, round],
        stages: [...game.stages, createRoundStage(round.id)],
      }, now), 'reconcile');
    }

    case 'removeRound': {
      if (game.rounds.length <= 1 || !game.rounds.some((round) => round.id === command.roundId)) return unchanged(game);
      return changed(touchGame({
        ...game,
        rounds: game.rounds.filter((round) => round.id !== command.roundId),
        stages: game.stages.filter((stage) => stage.kind !== 'round' || stage.roundId !== command.roundId),
      }, now), 'reconcile');
    }

    case 'changeRoundName': {
      if (
        command.name.length > DATA_LIMITS.text.roundName
        || !game.rounds.some((round) => round.id === command.roundId && round.name !== command.name)
      ) return unchanged(game);
      return changed(touchGame({
        ...game,
        rounds: game.rounds.map((round) => round.id === command.roundId ? { ...round, name: command.name } : round),
      }, now), 'none');
    }

    case 'moveStage': {
      const index = game.stages.findIndex((stage) => stage.id === command.stageId);
      const nextIndex = index + command.direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= game.stages.length) return unchanged(game);
      const stages = [...game.stages];
      [stages[index], stages[nextIndex]] = [stages[nextIndex], stages[index]];
      return changed(touchGame({ ...game, stages }, now), 'reconcile');
    }

    case 'addInterRound': {
      if (game.interRounds.length >= GAME_LIMITS.interRounds) return unchanged(game);
      const interRound = createInterRound(
        command.templateId,
        game.interRounds.filter((item) => item.templateId === command.templateId).length,
      );
      return changed(touchGame({
        ...game,
        interRounds: [...game.interRounds, interRound],
        stages: [...game.stages, createInterRoundStage(interRound.id)],
      }, now), 'reconcile');
    }

    case 'removeInterRound': {
      if (!game.interRounds.some((item) => item.id === command.interRoundId)) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.filter((item) => item.id !== command.interRoundId),
        stages: game.stages.filter((stage) => stage.kind !== 'interRound' || stage.interRoundId !== command.interRoundId),
      }, now), 'reconcile');
    }

    case 'changeInterRoundTitle': {
      if (
        command.title.length > DATA_LIMITS.text.interRoundTitle
        || !game.interRounds.some((item) => item.id === command.interRoundId && item.title !== command.title)
      ) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.map((item) => item.id === command.interRoundId ? { ...item, title: command.title } : item),
      }, now), 'none');
    }

    case 'addContinueLyricsTask': {
      const target = game.interRounds.find((item) => item.id === command.interRoundId);
      if (target?.templateId !== 'continueLyrics' || target.tasks.length >= GAME_LIMITS.continueLyricsTasks) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.map((item) => item.id === command.interRoundId && item.templateId === 'continueLyrics'
          ? { ...item, tasks: [...item.tasks, createContinueLyricsTask()] }
          : item),
      }, now), 'reconcile');
    }

    case 'removeContinueLyricsTask': {
      const target = game.interRounds.find((item) => item.id === command.interRoundId);
      if (
        target?.templateId !== 'continueLyrics'
        || target.tasks.length <= 1
        || !target.tasks.some((task) => task.id === command.taskId)
      ) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.map((item) => item.id === command.interRoundId && item.templateId === 'continueLyrics'
          ? { ...item, tasks: item.tasks.filter((task) => task.id !== command.taskId) }
          : item),
      }, now), 'reconcile');
    }

    case 'changeContinueLyricsTask': {
      const interRound = game.interRounds.find((item) => item.id === command.interRoundId);
      if (interRound?.templateId !== 'continueLyrics') return unchanged(game);
      const task = interRound.tasks.find((item) => item.id === command.taskId);
      if (!task) return unchanged(game);
      if (command.patch.answerText !== undefined && command.patch.answerText.length > DATA_LIMITS.text.interRoundAnswer) return unchanged(game);
      if (
        command.patch.trackId !== undefined
        && (command.patch.trackId.length > DATA_LIMITS.text.id || !hasMediaTrack(command.patch.trackId))
      ) return unchanged(game);
      if (
        command.patch.requiredWordsCount !== undefined
        && !isValidContinueLyricsRequiredWordsCount(command.patch.requiredWordsCount)
      ) return unchanged(game);
      if (command.patch.cutAtMs !== undefined && !isValidContinueLyricsCutAtMs(command.patch.cutAtMs)) return unchanged(game);
      if (!Object.entries(command.patch).some(([key, value]) => task[key as keyof typeof task] !== value)) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.map((item) => item.id === command.interRoundId && item.templateId === 'continueLyrics'
          ? {
              ...item,
              tasks: item.tasks.map((candidate) => candidate.id === command.taskId
                ? { ...candidate, ...command.patch }
                : candidate),
            }
          : item),
      }, now), 'none');
    }

    case 'addCommonThemeStage': {
      const target = game.interRounds.find((item) => item.id === command.interRoundId);
      if (target?.templateId !== 'commonTheme4' || target.stages.length >= GAME_LIMITS.commonThemeStages) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.map((item) => item.id === command.interRoundId && item.templateId === 'commonTheme4'
          ? { ...item, stages: [...item.stages, createCommonThemeStage()] }
          : item),
      }, now), 'reconcile');
    }

    case 'removeCommonThemeStage': {
      const target = game.interRounds.find((item) => item.id === command.interRoundId);
      if (
        target?.templateId !== 'commonTheme4'
        || target.stages.length <= 1
        || !target.stages.some((stage) => stage.id === command.stageId)
      ) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.map((item) => item.id === command.interRoundId && item.templateId === 'commonTheme4'
          ? { ...item, stages: item.stages.filter((stage) => stage.id !== command.stageId) }
          : item),
      }, now), 'reconcile');
    }

    case 'changeCommonThemeTrack': {
      const interRound = game.interRounds.find((item) => item.id === command.interRoundId);
      if (interRound?.templateId !== 'commonTheme4') return unchanged(game);
      const track = interRound.stages.find((stage) => stage.id === command.stageId)
        ?.tracks.find((item) => item.id === command.itemId);
      if (!track) return unchanged(game);
      if (command.patch.answerTitle !== undefined && command.patch.answerTitle.length > DATA_LIMITS.text.songTitle) return unchanged(game);
      if (command.patch.answerArtist !== undefined && command.patch.answerArtist.length > DATA_LIMITS.text.artist) return unchanged(game);
      if (
        command.patch.trackId !== undefined
        && (command.patch.trackId.length > DATA_LIMITS.text.id || !hasMediaTrack(command.patch.trackId))
      ) return unchanged(game);
      if (!Object.entries(command.patch).some(([key, value]) => track[key as keyof typeof track] !== value)) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.map((item) => item.id === command.interRoundId && item.templateId === 'commonTheme4'
          ? {
              ...item,
              stages: item.stages.map((stage) => stage.id === command.stageId
                ? {
                    ...stage,
                    tracks: stage.tracks.map((candidate) => candidate.id === command.itemId
                      ? { ...candidate, ...command.patch }
                      : candidate) as typeof stage.tracks,
                  }
                : stage),
            }
          : item),
      }, now), 'none');
    }

    case 'changeCommonTheme': {
      if (
        command.commonTheme.length > DATA_LIMITS.text.commonTheme
        || !game.interRounds.some((item) => item.id === command.interRoundId
          && item.templateId === 'commonTheme4'
          && item.stages.some((stage) => stage.id === command.stageId && stage.commonTheme !== command.commonTheme))
      ) return unchanged(game);
      return changed(touchGame({
        ...game,
        interRounds: game.interRounds.map((item) => item.id === command.interRoundId && item.templateId === 'commonTheme4'
          ? {
              ...item,
              stages: item.stages.map((stage) => stage.id === command.stageId
                ? { ...stage, commonTheme: command.commonTheme }
                : stage),
            }
          : item),
      }, now), 'none');
    }

    case 'addCategory': {
      const round = game.rounds.find((item) => item.id === command.roundId);
      if (!round || round.categories.length >= EDITOR_LIMITS.categoriesPerRound) return unchanged(game);
      return changed(touchGame({
        ...game,
        rounds: game.rounds.map((item) => item.id === command.roundId
          ? { ...item, categories: [...item.categories, createCategory(item.categories.length)] }
          : item),
      }, now), 'reconcile');
    }

    case 'removeCategory': {
      const round = game.rounds.find((item) => item.id === command.roundId);
      if (
        !round
        || round.categories.length <= 1
        || !round.categories.some((category) => category.id === command.categoryId)
      ) return unchanged(game);
      return changed(touchGame({
        ...game,
        rounds: game.rounds.map((item) => item.id === command.roundId
          ? { ...item, categories: item.categories.filter((category) => category.id !== command.categoryId) }
          : item),
      }, now), 'reconcile');
    }

    case 'changeCategoryName': {
      if (
        command.name.length > DATA_LIMITS.text.categoryName
        || !game.rounds.some((round) => round.id === command.roundId && round.categories.some(
          (category) => category.id === command.categoryId && category.name !== command.name,
        ))
      ) return unchanged(game);
      return changed(touchGame({
        ...game,
        rounds: game.rounds.map((round) => round.id === command.roundId
          ? {
              ...round,
              categories: round.categories.map((category) => category.id === command.categoryId
                ? { ...category, name: command.name }
                : category),
            }
          : round),
      }, now), 'none');
    }

    case 'addQuestion': {
      const category = findCategory(game, command.roundId, command.categoryId);
      if (!category || category.questions.length >= EDITOR_LIMITS.questionsPerCategory) return unchanged(game);
      return changed(touchGame(updateQuestionCollection(game, command, (questions) => [
        ...questions,
        createQuestion(getNextQuestionPoints(questions)),
      ]), now), 'reconcile');
    }

    case 'removeQuestion': {
      const category = findCategory(game, command.roundId, command.categoryId);
      if (
        !category
        || category.questions.length <= 1
        || !category.questions.some((question) => question.id === command.questionId)
      ) return unchanged(game);
      return changed(touchGame(updateQuestionCollection(game, command, (questions) =>
        questions.filter((question) => question.id !== command.questionId),
      ), now), 'reconcile');
    }

    case 'changeQuestion': {
      const category = findCategory(game, command.roundId, command.categoryId);
      const question = category?.questions.find((item) => item.id === command.questionId);
      if (!category || !question || command.patch.points === undefined) return unchanged(game);
      if (
        command.patch.points === question.points
        || !isQuestionPointsAvailable(category.questions, command.questionId, command.patch.points)
      ) return unchanged(game);
      return changed(touchGame(updateQuestion(game, command, (item) => ({ ...item, ...command.patch })), now), 'none');
    }

    case 'changeQuestionSong': {
      if (command.songId && !hasSong(command.songId)) return unchanged(game);
      const question = findCategory(game, command.roundId, command.categoryId)
        ?.questions.find((item) => item.id === command.questionId);
      if (!question || question.songId === command.songId) return unchanged(game);
      return changed(touchGame(updateQuestion(game, command, (item) => ({ ...item, songId: command.songId })), now), 'none');
    }

    case 'addTeam': {
      if (game.teams.length >= GAME_LIMITS.teams) return unchanged(game);
      return changed(touchGame({ ...game, teams: [...game.teams, createTeam(game.teams.length)] }, now), 'reconcile');
    }

    case 'removeTeam': {
      if (game.teams.length <= 1 || !game.teams.some((team) => team.id === command.teamId)) return unchanged(game);
      return changed(touchGame({
        ...game,
        teams: game.teams.filter((team) => team.id !== command.teamId),
      }, now), 'reconcile');
    }

    case 'changeTeam': {
      const team = game.teams.find((item) => item.id === command.teamId);
      if (!team) return unchanged(game);
      if (
        command.patch.name !== undefined
        && (!isPersistableTeamName(command.patch.name) || !isTeamNameAvailable(game.teams, command.teamId, command.patch.name))
      ) return unchanged(game);
      if (
        command.patch.color !== undefined
        && (!isValidTeamColor(command.patch.color) || !isTeamColorAvailable(game.teams, command.teamId, command.patch.color))
      ) return unchanged(game);
      const hasChanges = (command.patch.name !== undefined && command.patch.name !== team.name)
        || (command.patch.color !== undefined && command.patch.color.toLowerCase() !== team.color.toLowerCase());
      if (!hasChanges) return unchanged(game);
      return changed(touchGame({
        ...game,
        teams: game.teams.map((item) => item.id === command.teamId ? { ...item, ...command.patch } : item),
      }, now), 'none');
    }
  }
}

const alwaysFalse = () => false;

function findCategory(game: GameConfig, roundId: string, categoryId: string) {
  return game.rounds.find((round) => round.id === roundId)
    ?.categories.find((category) => category.id === categoryId);
}

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
          categories: round.categories.map((category) => category.id === payload.categoryId
            ? { ...category, questions: updater(category.questions) }
            : category),
        }
      : round),
  };
}

function touchGame(game: GameConfig, now: () => number): GameConfig {
  return { ...game, updatedAt: now() };
}

function changed(game: GameConfig, sessionImpact: GameEditorCommandResult['sessionImpact']): GameEditorCommandResult {
  return { game, changed: true, sessionImpact };
}

function unchanged(game: GameConfig): GameEditorCommandResult {
  return { game, changed: false, sessionImpact: 'none' };
}
