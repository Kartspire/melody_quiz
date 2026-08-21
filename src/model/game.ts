import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import { loadState, saveState } from '../lib/storage';
import { createCategory, createDefaultConfig, createQuestion, createRound, createSession, createTeam } from './defaults';
import type { AudioAsset, GameConfig, GameSession, Question, Screen, Team } from './types';

const defaultConfig = createDefaultConfig();

export const appStarted = createEvent();
export const screenChanged = createEvent<Screen>();
export const gameRestarted = createEvent();
export const questionOpened = createEvent<string>();
export const questionClosed = createEvent();
export const teamAwarded = createEvent<string>();
export const teamScoreChanged = createEvent<{ teamId: string; score: number }>();
export const nextRoundRequested = createEvent();

export const gameTitleChanged = createEvent<string>();
export const roundCountChanged = createEvent<number>();
export const roundNameChanged = createEvent<{ roundId: string; name: string }>();
export const categoryAdded = createEvent<{ roundId: string }>();
export const categoryRemoved = createEvent<{ roundId: string; categoryId: string }>();
export const categoryNameChanged = createEvent<{ roundId: string; categoryId: string; name: string }>();
export const questionAdded = createEvent<{ roundId: string; categoryId: string }>();
export const questionRemoved = createEvent<{ roundId: string; categoryId: string; questionId: string }>();
export const questionChanged = createEvent<{
  roundId: string;
  categoryId: string;
  questionId: string;
  patch: Partial<Pick<Question, 'points' | 'title' | 'artist'>>;
}>();
export const questionAudioChanged = createEvent<{
  roundId: string;
  categoryId: string;
  questionId: string;
  kind: 'minus' | 'plus';
  asset?: AudioAsset;
}>();
export const teamAdded = createEvent();
export const teamRemoved = createEvent<string>();
export const teamChanged = createEvent<{ teamId: string; patch: Partial<Pick<Team, 'name' | 'color'>> }>();

const loadFx = createEffect(loadState);
const saveFx = createEffect(saveState);

export const $screen = createStore<Screen>('game').on(screenChanged, (_, screen) => screen);
export const $hydrated = createStore(false).on(loadFx.finally, () => true);
export const $config = createStore<GameConfig>(defaultConfig);
export const $session = createStore<GameSession>(createSession(defaultConfig));

$config
  .on(loadFx.doneData, (state, persisted) => persisted?.config ?? state)
  .on(gameTitleChanged, (state, title) => ({ ...state, title }))
  .on(roundCountChanged, (state, count) => {
    const safeCount = Math.max(1, Math.min(10, Math.floor(count || 1)));
    const rounds = state.rounds.slice(0, safeCount);
    while (rounds.length < safeCount) rounds.push(createRound(rounds.length));
    return { ...state, rounds };
  })
  .on(roundNameChanged, (state, payload) => ({
    ...state,
    rounds: state.rounds.map((round) => (round.id === payload.roundId ? { ...round, name: payload.name } : round)),
  }))
  .on(categoryAdded, (state, { roundId }) => ({
    ...state,
    rounds: state.rounds.map((round) =>
      round.id === roundId ? { ...round, categories: [...round.categories, createCategory(round.categories.length)] } : round,
    ),
  }))
  .on(categoryRemoved, (state, { roundId, categoryId }) => ({
    ...state,
    rounds: state.rounds.map((round) =>
      round.id === roundId
        ? { ...round, categories: round.categories.filter((category) => category.id !== categoryId) }
        : round,
    ),
  }))
  .on(categoryNameChanged, (state, payload) => ({
    ...state,
    rounds: state.rounds.map((round) =>
      round.id === payload.roundId
        ? {
            ...round,
            categories: round.categories.map((category) =>
              category.id === payload.categoryId ? { ...category, name: payload.name } : category,
            ),
          }
        : round,
    ),
  }))
  .on(questionAdded, (state, { roundId, categoryId }) => ({
    ...state,
    rounds: state.rounds.map((round) =>
      round.id === roundId
        ? {
            ...round,
            categories: round.categories.map((category) => {
              if (category.id !== categoryId) return category;
              const lastPoints = category.questions.at(-1)?.points ?? 0;
              return { ...category, questions: [...category.questions, createQuestion(lastPoints + 100)] };
            }),
          }
        : round,
    ),
  }))
  .on(questionRemoved, (state, payload) => ({
    ...state,
    rounds: state.rounds.map((round) =>
      round.id === payload.roundId
        ? {
            ...round,
            categories: round.categories.map((category) =>
              category.id === payload.categoryId
                ? { ...category, questions: category.questions.filter((question) => question.id !== payload.questionId) }
                : category,
            ),
          }
        : round,
    ),
  }))
  .on(questionChanged, (state, payload) => updateQuestion(state, payload, (question) => ({ ...question, ...payload.patch })))
  .on(questionAudioChanged, (state, payload) =>
    updateQuestion(state, payload, (question) => ({ ...question, [payload.kind]: payload.asset })),
  )
  .on(teamAdded, (state) => ({ ...state, teams: [...state.teams, createTeam(state.teams.length)] }))
  .on(teamRemoved, (state, teamId) => ({
    ...state,
    teams: state.teams.length > 1 ? state.teams.filter((team) => team.id !== teamId) : state.teams,
  }))
  .on(teamChanged, (state, { teamId, patch }) => ({
    ...state,
    teams: state.teams.map((team) => (team.id === teamId ? { ...team, ...patch } : team)),
  }));

$session
  .on(loadFx.doneData, (state, persisted) => persisted?.session ?? state)
  .on(questionOpened, (state, questionId) => ({ ...state, started: true, activeQuestionId: questionId, awardedTeamId: null }))
  .on(questionClosed, (state) => ({ ...state, activeQuestionId: null, awardedTeamId: null }))
  .on(teamScoreChanged, (state, { teamId, score }) => ({
    ...state,
    scores: { ...state.scores, [teamId]: score },
  }))
  .on(nextRoundRequested, (state) => ({
    ...state,
    roundIndex: state.roundIndex + 1,
    activeQuestionId: null,
    awardedTeamId: null,
  }));

sample({ clock: appStarted, target: loadFx });
sample({ clock: gameRestarted, source: $config, fn: (config) => createSession(config), target: $session });

sample({
  clock: teamAwarded,
  source: combine({ config: $config, session: $session }),
  filter: ({ session }) => Boolean(session.activeQuestionId) && !session.completedQuestionIds.includes(session.activeQuestionId!),
  fn: ({ config, session }, teamId) => {
    const question = findQuestion(config, session.activeQuestionId!);
    return {
      ...session,
      awardedTeamId: teamId,
      completedQuestionIds: [...session.completedQuestionIds, session.activeQuestionId!],
      scores: { ...session.scores, [teamId]: (session.scores[teamId] ?? 0) + (question?.points ?? 0) },
    };
  },
  target: $session,
});

sample({
  clock: $config.updates,
  source: combine({ session: $session, hydrated: $hydrated }),
  filter: ({ hydrated }) => hydrated,
  fn: ({ session }, config) => reconcileSession(config, session),
  target: $session,
});

const $persistedState = combine({ config: $config, session: $session });
let saveTimer: number | undefined;
const scheduleSaveFx = createEffect((state: { config: GameConfig; session: GameSession }) => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveFx(state), 250);
});

sample({
  clock: $persistedState.updates,
  source: combine({ state: $persistedState, hydrated: $hydrated }),
  filter: ({ hydrated }) => hydrated,
  fn: ({ state }) => state,
  target: scheduleSaveFx,
});

export const $activeRound = combine($config, $session, (config, session) => config.rounds[session.roundIndex] ?? null);
export const $activeQuestion = combine($config, $session, (config, session) =>
  session.activeQuestionId ? findQuestion(config, session.activeQuestionId) ?? null : null,
);
export const $isGameFinished = combine($config, $session, (config, session) => session.roundIndex >= config.rounds.length);

export const isRoundComplete = (config: GameConfig, session: GameSession) => {
  const round = config.rounds[session.roundIndex];
  if (!round) return true;
  const ids = round.categories.flatMap((category) => category.questions.map((question) => question.id));
  return ids.length > 0 && ids.every((id) => session.completedQuestionIds.includes(id));
};

function findQuestion(config: GameConfig, questionId: string) {
  for (const round of config.rounds) {
    for (const category of round.categories) {
      const question = category.questions.find((item) => item.id === questionId);
      if (question) return question;
    }
  }
  return undefined;
}

function updateQuestion(
  state: GameConfig,
  payload: { roundId: string; categoryId: string; questionId: string },
  updater: (question: Question) => Question,
): GameConfig {
  return {
    ...state,
    rounds: state.rounds.map((round) =>
      round.id === payload.roundId
        ? {
            ...round,
            categories: round.categories.map((category) =>
              category.id === payload.categoryId
                ? {
                    ...category,
                    questions: category.questions.map((question) =>
                      question.id === payload.questionId ? updater(question) : question,
                    ),
                  }
                : category,
            ),
          }
        : round,
    ),
  };
}

function reconcileSession(config: GameConfig, session: GameSession): GameSession {
  const teamIds = new Set(config.teams.map((team) => team.id));
  const scores = Object.fromEntries(config.teams.map((team) => [team.id, session.scores[team.id] ?? 0]));
  const questionIds = new Set(
    config.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions.map((question) => question.id))),
  );

  return {
    ...session,
    roundIndex: Math.min(session.roundIndex, config.rounds.length),
    activeQuestionId: session.activeQuestionId && questionIds.has(session.activeQuestionId) ? session.activeQuestionId : null,
    completedQuestionIds: session.completedQuestionIds.filter((id) => questionIds.has(id)),
    scores,
    awardedTeamId: session.awardedTeamId && teamIds.has(session.awardedTeamId) ? session.awardedTeamId : null,
  };
}
