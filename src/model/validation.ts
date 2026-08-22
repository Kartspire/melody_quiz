import { DATA_LIMITS, GAME_LIMITS } from './limits';
import type { AudioAsset, GameConfig, GameSession, PersistedState, Song } from './types';

const MIN_DATE = Date.UTC(2000, 0, 1);
const MAX_DATE = Date.UTC(2100, 0, 1);

export function assertValidGameStructure(game: GameConfig): void {
  const issues = getGameStructureIssues(game);
  if (issues.length > 0) throw new Error(`Некорректная структура game.json: ${issues[0]}`);
}

export function getGameStructureIssues(config: GameConfig): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const takeId = (id: unknown, label: string) => {
    if (!isBoundedText(id, DATA_LIMITS.text.id)) {
      issues.push(`${label}: отсутствует корректный id.`);
      return;
    }
    if (ids.has(id)) issues.push(`${label}: id «${id}» повторяется.`);
    ids.add(id);
  };

  if (!config || typeof config !== 'object') return ['Игра отсутствует или имеет неверный формат.'];
  takeId(config.id, 'Игра');
  if (!isBoundedText(config.title, DATA_LIMITS.text.gameTitle) || !config.title.trim()) issues.push('Не задано корректное название игры.');
  if (!isValidTimestamp(config.createdAt) || !isValidTimestamp(config.updatedAt)) issues.push('Некорректная дата создания или изменения игры.');

  if (!Array.isArray(config.rounds) || config.rounds.length < 1 || config.rounds.length > GAME_LIMITS.rounds) {
    issues.push(`В игре должно быть от 1 до ${GAME_LIMITS.rounds} раундов.`);
    return issues;
  }
  if (!Array.isArray(config.teams) || config.teams.length < 1 || config.teams.length > GAME_LIMITS.teams) {
    issues.push(`В игре должно быть от 1 до ${GAME_LIMITS.teams} команд.`);
    return issues;
  }

  const teamNames = new Set<string>();
  const teamColors = new Set<string>();
  config.teams.forEach((team, teamIndex) => {
    takeId(team?.id, `Команда ${teamIndex + 1}`);
    if (!isBoundedText(team?.name, DATA_LIMITS.text.teamName) || !team.name.trim()) {
      issues.push(`Команда ${teamIndex + 1}: не задано корректное название.`);
    } else {
      const normalized = normalizeText(team.name);
      if (teamNames.has(normalized)) issues.push(`Команда ${teamIndex + 1}: название «${team.name.trim()}» уже используется.`);
      teamNames.add(normalized);
    }
    const color = typeof team?.color === 'string' ? team.color.toLowerCase() : '';
    if (!/^#[0-9a-f]{6}$/.test(color)) issues.push(`Команда ${teamIndex + 1}: задан некорректный цвет.`);
    else if (teamColors.has(color)) issues.push(`Команда ${teamIndex + 1}: этот цвет уже используется другой командой.`);
    if (color) teamColors.add(color);
  });

  config.rounds.forEach((round, roundIndex) => {
    takeId(round?.id, `Раунд ${roundIndex + 1}`);
    if (!isBoundedText(round?.name, DATA_LIMITS.text.roundName) || !round.name.trim()) issues.push(`Раунд ${roundIndex + 1}: не задано корректное название.`);
    if (!Array.isArray(round?.categories) || round.categories.length < 1 || round.categories.length > GAME_LIMITS.categoriesPerRound) {
      issues.push(`Раунд ${roundIndex + 1}: должно быть от 1 до ${GAME_LIMITS.categoriesPerRound} категорий.`);
      return;
    }

    round.categories.forEach((category, categoryIndex) => {
      takeId(category?.id, `Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}`);
      if (!isBoundedText(category?.name, DATA_LIMITS.text.categoryName) || !category.name.trim()) {
        issues.push(`Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}: не задано корректное название.`);
      }
      if (!Array.isArray(category?.questions) || category.questions.length < 1 || category.questions.length > GAME_LIMITS.questionsPerCategory) {
        issues.push(`Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}: должно быть от 1 до ${GAME_LIMITS.questionsPerCategory} вопросов.`);
        return;
      }

      const usedPoints = new Set<number>();
      category.questions.forEach((question, questionIndex) => {
        const prefix = `Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}, вопрос ${questionIndex + 1}`;
        takeId(question?.id, prefix);
        if (!Number.isSafeInteger(question?.points) || question.points <= 0 || question.points > DATA_LIMITS.maxQuestionPoints) {
          issues.push(`${prefix}: стоимость должна быть целым числом от 1 до ${DATA_LIMITS.maxQuestionPoints}.`);
        } else if (usedPoints.has(question.points)) {
          issues.push(`${prefix}: стоимость ${question.points} уже используется в этой категории.`);
        } else {
          usedPoints.add(question.points);
        }
        if (question?.songId !== undefined && !isBoundedText(question.songId, DATA_LIMITS.text.id)) {
          issues.push(`${prefix}: некорректная ссылка на песню.`);
        }
      });
    });
  });

  return issues;
}


export function getGameStorageIssues(config: GameConfig): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const takeId = (id: unknown, label: string) => {
    if (!isBoundedText(id, DATA_LIMITS.text.id) || !id) {
      issues.push(`${label}: отсутствует корректный id.`);
      return;
    }
    if (ids.has(id)) issues.push(`${label}: id «${id}» повторяется.`);
    ids.add(id);
  };

  if (!config || typeof config !== 'object') return ['Игра отсутствует или имеет неверный формат.'];
  takeId(config.id, 'Игра');
  if (!isBoundedText(config.title, DATA_LIMITS.text.gameTitle)) issues.push('Название игры имеет некорректный формат или слишком большую длину.');
  if (!isValidTimestamp(config.createdAt) || !isValidTimestamp(config.updatedAt)) issues.push('Некорректная дата создания или изменения игры.');
  if (!Array.isArray(config.teams) || config.teams.length < 1 || config.teams.length > GAME_LIMITS.teams) {
    issues.push(`В игре должно быть от 1 до ${GAME_LIMITS.teams} команд.`);
    return issues;
  }
  if (!Array.isArray(config.rounds) || config.rounds.length < 1 || config.rounds.length > GAME_LIMITS.rounds) {
    issues.push(`В игре должно быть от 1 до ${GAME_LIMITS.rounds} раундов.`);
    return issues;
  }

  config.teams.forEach((team, teamIndex) => {
    takeId(team?.id, `Команда ${teamIndex + 1}`);
    if (!isBoundedText(team?.name, DATA_LIMITS.text.teamName)) issues.push(`Команда ${teamIndex + 1}: слишком длинное или некорректное название.`);
    if (typeof team?.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(team.color)) issues.push(`Команда ${teamIndex + 1}: задан некорректный цвет.`);
  });

  config.rounds.forEach((round, roundIndex) => {
    takeId(round?.id, `Раунд ${roundIndex + 1}`);
    if (!isBoundedText(round?.name, DATA_LIMITS.text.roundName)) issues.push(`Раунд ${roundIndex + 1}: слишком длинное или некорректное название.`);
    if (!Array.isArray(round?.categories) || round.categories.length < 1 || round.categories.length > GAME_LIMITS.categoriesPerRound) {
      issues.push(`Раунд ${roundIndex + 1}: некорректное количество категорий.`);
      return;
    }
    round.categories.forEach((category, categoryIndex) => {
      takeId(category?.id, `Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}`);
      if (!isBoundedText(category?.name, DATA_LIMITS.text.categoryName)) issues.push(`Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}: слишком длинное или некорректное название.`);
      if (!Array.isArray(category?.questions) || category.questions.length < 1 || category.questions.length > GAME_LIMITS.questionsPerCategory) {
        issues.push(`Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}: некорректное количество вопросов.`);
        return;
      }
      category.questions.forEach((question, questionIndex) => {
        const prefix = `Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}, вопрос ${questionIndex + 1}`;
        takeId(question?.id, prefix);
        if (!Number.isSafeInteger(question?.points) || question.points <= 0 || question.points > DATA_LIMITS.maxQuestionPoints) issues.push(`${prefix}: некорректная стоимость.`);
        if (question?.songId !== undefined && !isBoundedText(question.songId, DATA_LIMITS.text.id)) issues.push(`${prefix}: некорректная ссылка на песню.`);
      });
    });
  });

  return issues;
}

export function getGameStartIssues(config: GameConfig, songs: Song[], audioAssets: AudioAsset[], completedQuestionIds: string[] = []): string[] {
  const issues = [...getGameStructureIssues(config)];
  if (issues.length > 0) return issues;

  const completed = new Set(completedQuestionIds);
  const songById = new Map(songs.map((song) => [song.id, song]));
  const audioById = new Map(audioAssets.map((asset) => [asset.id, asset]));

  for (const [roundIndex, round] of config.rounds.entries()) {
    for (const [categoryIndex, category] of round.categories.entries()) {
      for (const [questionIndex, question] of category.questions.entries()) {
        if (completed.has(question.id)) continue;
        const prefix = `Раунд ${roundIndex + 1}, «${category.name || `Категория ${categoryIndex + 1}`}», вопрос ${questionIndex + 1}`;
        if (!question.songId) {
          issues.push(`${prefix}: не выбрана песня.`);
          continue;
        }
        const song = songById.get(question.songId);
        if (!song) {
          issues.push(`${prefix}: выбранная песня отсутствует в медиатеке.`);
          continue;
        }
        if (!hasPlayableAudio(song.minusAudioId, audioById)) issues.push(`${prefix}: отсутствует или повреждён минус.`);
        if (!hasPlayableAudio(song.plusAudioId, audioById)) issues.push(`${prefix}: отсутствует или повреждён плюс.`);
      }
    }
  }

  return issues;
}

export function getSessionContinuationIssues(config: GameConfig, session: GameSession | undefined, songs: Song[], audioAssets: AudioAsset[]) {
  return getGameStartIssues(config, songs, audioAssets, session?.completedQuestionIds ?? []);
}

export function assertValidSong(song: Song): void {
  if (!song || !isBoundedText(song.id, DATA_LIMITS.text.id)) throw new Error('В хранилище найдена песня с некорректным id.');
  if (!isBoundedText(song.artist, DATA_LIMITS.text.artist) || !isBoundedText(song.title, DATA_LIMITS.text.songTitle)) {
    throw new Error(`Песня «${song.id}» содержит слишком длинное или некорректное название/исполнителя.`);
  }
  if (!song.artist.trim() && !song.title.trim()) throw new Error(`Песня «${song.id}» не содержит исполнителя и названия.`);
  if (!isValidTimestamp(song.createdAt) || !isValidTimestamp(song.updatedAt)) throw new Error(`Песня «${song.id}» содержит некорректную дату.`);
  for (const audioId of [song.minusAudioId, song.plusAudioId]) {
    if (audioId !== undefined && !isSha256(audioId)) throw new Error(`Песня «${song.id}» содержит некорректную ссылку на аудио.`);
  }
}


function assertPersistableSong(song: Song): void {
  if (!song || !isBoundedText(song.id, DATA_LIMITS.text.id) || !song.id) throw new Error('В хранилище найдена песня с некорректным id.');
  if (!isBoundedText(song.artist, DATA_LIMITS.text.artist) || !isBoundedText(song.title, DATA_LIMITS.text.songTitle)) {
    throw new Error(`Песня «${song.id}» содержит слишком длинное или некорректное название/исполнителя.`);
  }
  if (!isValidTimestamp(song.createdAt) || !isValidTimestamp(song.updatedAt)) throw new Error(`Песня «${song.id}» содержит некорректную дату.`);
  for (const audioId of [song.minusAudioId, song.plusAudioId]) {
    if (audioId !== undefined && !isSha256(audioId)) throw new Error(`Песня «${song.id}» содержит некорректную ссылку на аудио.`);
  }
}

export function assertValidPersistedState(state: PersistedState): void {
  if (!state || state.version !== 2 || !Array.isArray(state.games) || !Array.isArray(state.songs) || !Array.isArray(state.audioAssets) || !Array.isArray(state.sessions)) {
    throw new Error('Локальное хранилище имеет неподдерживаемую структуру.');
  }
  for (const game of state.games) {
    const issues = getGameStorageIssues(game);
    if (issues.length > 0) throw new Error(`Локальная игра «${game?.title || game?.id || 'без названия'}» повреждена: ${issues[0]}`);
  }
  state.songs.forEach(assertPersistableSong);

  const gameIds = new Set<string>();
  for (const game of state.games) {
    if (gameIds.has(game.id)) throw new Error(`Игра «${game.id}» продублирована в локальном хранилище.`);
    gameIds.add(game.id);
  }
  const songIds = new Set<string>();
  for (const song of state.songs) {
    if (songIds.has(song.id)) throw new Error(`Песня «${song.id}» продублирована в локальном хранилище.`);
    songIds.add(song.id);
  }
  const audioIds = new Set<string>();
  for (const asset of state.audioAssets) {
    if (!asset || !isSha256(asset.id) || asset.sha256 !== asset.id || !(asset.blob instanceof Blob) || asset.blob.size <= 0 || asset.verified !== true) {
      throw new Error('Локальное хранилище содержит повреждённую запись аудио.');
    }
    if (audioIds.has(asset.id)) throw new Error(`Аудиофайл «${asset.id}» продублирован в локальном хранилище.`);
    audioIds.add(asset.id);
  }

  for (const song of state.songs) {
    for (const audioId of [song.minusAudioId, song.plusAudioId]) {
      if (audioId && !audioIds.has(audioId)) throw new Error(`Песня «${song.artist} — ${song.title}» ссылается на отсутствующий аудиофайл.`);
    }
  }
  for (const game of state.games) {
    for (const question of game.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions))) {
      if (question.songId && !songIds.has(question.songId)) throw new Error(`Игра «${game.title}» ссылается на отсутствующую песню.`);
    }
  }

  const sessionGameIds = new Set<string>();
  for (const session of state.sessions) {
    if (!session || !gameIds.has(session.gameId)) throw new Error('Локальное хранилище содержит сессию для отсутствующей игры.');
    if (sessionGameIds.has(session.gameId)) throw new Error(`Для игры «${session.gameId}» найдено несколько игровых сессий.`);
    sessionGameIds.add(session.gameId);
    if (!Number.isSafeInteger(session.roundIndex) || session.roundIndex < 0 || typeof session.started !== 'boolean' || typeof session.answerRevealed !== 'boolean') {
      throw new Error('Локальное хранилище содержит повреждённую игровую сессию.');
    }
    for (const list of [session.completedQuestionIds, session.activeExcludedTeamIds, session.currentIncorrectTeamIds, session.nextExcludedTeamIds]) {
      if (!Array.isArray(list) || list.some((id) => !isBoundedText(id, DATA_LIMITS.text.id))) throw new Error('Локальное хранилище содержит повреждённый список идентификаторов в игровой сессии.');
    }
    if (!session.scores || typeof session.scores !== 'object' || Object.values(session.scores).some((score) => !Number.isSafeInteger(score))) {
      throw new Error('Локальное хранилище содержит повреждённые баллы игровой сессии.');
    }
  }
  if (state.activeGameId !== null && !gameIds.has(state.activeGameId)) throw new Error('Активная игра отсутствует в локальном хранилище.');
}

export function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_DATE && value <= MAX_DATE && !Number.isNaN(new Date(value).getTime());
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function hasPlayableAudio(audioId: string | undefined, audioById: Map<string, AudioAsset>) {
  if (!audioId) return false;
  const asset = audioById.get(audioId);
  return Boolean(asset && asset.id === asset.sha256 && isSha256(asset.id) && asset.verified === true && asset.blob instanceof Blob && asset.blob.size > 0);
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}
