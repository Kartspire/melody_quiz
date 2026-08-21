import { createId } from '../lib/ids';
import type { Category, GameConfig, GameSession, Question, Round, Team } from './types';

export const createQuestion = (points = 100): Question => ({
  id: createId('question'),
  points,
  title: '',
  artist: '',
});

export const createCategory = (index = 0): Category => ({
  id: createId('category'),
  name: `Категория ${index + 1}`,
  questions: [100, 200, 300, 400, 500].map(createQuestion),
});

export const createRound = (index = 0): Round => ({
  id: createId('round'),
  name: `Раунд ${index + 1}`,
  categories: [createCategory(0), createCategory(1), createCategory(2)],
});

export const createTeam = (index = 0): Team => {
  const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899'];

  return {
    id: createId('team'),
    name: `Команда ${index + 1}`,
    color: colors[index % colors.length],
  };
};

export const createDefaultConfig = (): GameConfig => ({
  title: 'Угадай мелодию',
  rounds: [createRound(0), createRound(1), createRound(2)],
  teams: [createTeam(0), createTeam(1)],
});

export const createSession = (config: GameConfig): GameSession => ({
  started: false,
  roundIndex: 0,
  activeQuestionId: null,
  completedQuestionIds: [],
  scores: Object.fromEntries(config.teams.map((team) => [team.id, 0])),
  awardedTeamId: null,
});
