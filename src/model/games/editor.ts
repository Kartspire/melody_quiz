import { combine, createEvent, merge, sample } from 'effector';
import { createSession } from '../defaults';
import { reconcileSession } from '../session';
import { $games, $mediaTracks, $sessions, $songs } from '../core/state';
import { $activeGame } from './selectors';
import {
  applyGameEditorCommand,
  type GameEditorCommand,
  type GameEditorCommandResult,
} from './domain/editorCommands';
import type { InterRound, InterRoundTemplateId, Question, Team } from '../types';

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

const gameEditorCommandRequested = merge([
  gameTitleChanged.map((title): GameEditorCommand => ({ type: 'changeGameTitle', title })),
  roundAdded.map((): GameEditorCommand => ({ type: 'addRound' })),
  roundRemoved.map((roundId): GameEditorCommand => ({ type: 'removeRound', roundId })),
  roundNameChanged.map(({ roundId, name }): GameEditorCommand => ({ type: 'changeRoundName', roundId, name })),
  stageMoved.map(({ stageId, direction }): GameEditorCommand => ({ type: 'moveStage', stageId, direction })),
  interRoundAdded.map((templateId): GameEditorCommand => ({ type: 'addInterRound', templateId })),
  interRoundRemoved.map((interRoundId): GameEditorCommand => ({ type: 'removeInterRound', interRoundId })),
  interRoundTitleChanged.map(({ interRoundId, title }): GameEditorCommand => ({ type: 'changeInterRoundTitle', interRoundId, title })),
  continueLyricsTaskAdded.map((interRoundId): GameEditorCommand => ({ type: 'addContinueLyricsTask', interRoundId })),
  continueLyricsTaskRemoved.map(({ interRoundId, taskId }): GameEditorCommand => ({ type: 'removeContinueLyricsTask', interRoundId, taskId })),
  continueLyricsTaskChanged.map(({ interRoundId, taskId, patch }): GameEditorCommand => ({
    type: 'changeContinueLyricsTask',
    interRoundId,
    taskId,
    patch,
  })),
  commonThemeStageAdded.map((interRoundId): GameEditorCommand => ({ type: 'addCommonThemeStage', interRoundId })),
  commonThemeStageRemoved.map(({ interRoundId, stageId }): GameEditorCommand => ({ type: 'removeCommonThemeStage', interRoundId, stageId })),
  commonThemeTrackChanged.map(({ interRoundId, stageId, itemId, patch }): GameEditorCommand => ({
    type: 'changeCommonThemeTrack',
    interRoundId,
    stageId,
    itemId,
    patch,
  })),
  commonThemeChanged.map(({ interRoundId, stageId, commonTheme }): GameEditorCommand => ({
    type: 'changeCommonTheme',
    interRoundId,
    stageId,
    commonTheme,
  })),
  categoryAdded.map(({ roundId }): GameEditorCommand => ({ type: 'addCategory', roundId })),
  categoryRemoved.map(({ roundId, categoryId }): GameEditorCommand => ({ type: 'removeCategory', roundId, categoryId })),
  categoryNameChanged.map(({ roundId, categoryId, name }): GameEditorCommand => ({ type: 'changeCategoryName', roundId, categoryId, name })),
  questionAdded.map(({ roundId, categoryId }): GameEditorCommand => ({ type: 'addQuestion', roundId, categoryId })),
  questionRemoved.map(({ roundId, categoryId, questionId }): GameEditorCommand => ({ type: 'removeQuestion', roundId, categoryId, questionId })),
  questionChanged.map(({ roundId, categoryId, questionId, patch }): GameEditorCommand => ({
    type: 'changeQuestion',
    roundId,
    categoryId,
    questionId,
    patch,
  })),
  questionSongChanged.map(({ roundId, categoryId, questionId, songId }): GameEditorCommand => ({
    type: 'changeQuestionSong',
    roundId,
    categoryId,
    questionId,
    songId,
  })),
  teamAdded.map((): GameEditorCommand => ({ type: 'addTeam' })),
  teamRemoved.map((teamId): GameEditorCommand => ({ type: 'removeTeam', teamId })),
  teamChanged.map(({ teamId, patch }): GameEditorCommand => ({ type: 'changeTeam', teamId, patch })),
]);

const gameEditorSource = combine({
  game: $activeGame,
  mediaTracks: $mediaTracks,
  songs: $songs,
});
const gameConfigUpdated = createEvent<GameEditorCommandResult>();

sample({
  clock: gameEditorCommandRequested,
  source: gameEditorSource,
  filter: ({ game }) => Boolean(game),
  fn: ({ game, mediaTracks, songs }, command) => applyGameEditorCommand(game!, command, {
    hasMediaTrack: (trackId) => mediaTracks.some((track) => track.id === trackId),
    hasSong: (songId) => songs.some((song) => song.id === songId),
  }),
  target: gameConfigUpdated,
});

$games.on(gameConfigUpdated, (games, result) => result.changed
  ? games.map((game) => game.id === result.game.id ? result.game : game)
  : games,
);

sample({
  clock: gameConfigUpdated,
  source: $sessions,
  filter: (_, result) => result.changed && result.sessionImpact === 'reconcile',
  fn: (sessions, result) => ({
    ...sessions,
    [result.game.id]: reconcileSession(
      result.game,
      sessions[result.game.id] ?? createSession(result.game),
    ),
  }),
  target: $sessions,
});
