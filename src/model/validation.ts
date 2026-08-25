import { DATA_LIMITS, GAME_LIMITS, INTER_ROUND_LIMITS } from './limits';
import { getInterRoundTrackIds } from '../interRounds/templates';
import { hasAvailableAudioAssetReference, isVerifiedAudioAsset } from './media/domain/audioAsset';
import {
  isPersistableTeamName,
  isValidContinueLyricsCutAtMs,
  isValidContinueLyricsRequiredWordsCount,
  isValidQuestionPoints,
  isValidTeamColor,
  normalizeRuleText,
} from './rules';
import type {
  AudioAsset,
  GameConfig,
  GameSession,
  GameSessionHistoryEntry,
  InterRound,
  MediaTrack,
  PersistedState,
  Song,
} from './types';

const MIN_DATE = Date.UTC(2000, 0, 1);
const MAX_DATE = Date.UTC(2100, 0, 1);

export function assertValidGameStructure(game: GameConfig): void {
  const issues = getGameStructureIssues(game);
  if (issues.length > 0) throw new Error(`Некорректная структура game.json: ${issues[0]}`);
}

export function getGameStructureIssues(config: GameConfig): string[] {
  return collectGameIssues(config, 'playable');
}

export function getGameStorageIssues(config: GameConfig): string[] {
  return collectGameIssues(config, 'draft');
}

type GameValidationMode = 'draft' | 'playable';

function collectGameIssues(config: GameConfig, mode: GameValidationMode): string[] {
  const requiresPlayable = mode === 'playable';
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
  if (!isBoundedText(config.title, DATA_LIMITS.text.gameTitle) || (requiresPlayable && !config.title.trim())) issues.push('Не задано корректное название игры.');
  if (!isValidTimestamp(config.createdAt) || !isValidTimestamp(config.updatedAt)) issues.push('Некорректная дата создания или изменения игры.');

  if (!Array.isArray(config.rounds) || config.rounds.length < 1 || config.rounds.length > GAME_LIMITS.rounds) {
    issues.push(`В игре должно быть от 1 до ${GAME_LIMITS.rounds} раундов.`);
    return issues;
  }
  if (!Array.isArray(config.interRounds) || config.interRounds.length > GAME_LIMITS.interRounds) {
    issues.push(`В игре может быть не больше ${GAME_LIMITS.interRounds} межраундов.`);
    return issues;
  }
  if (!Array.isArray(config.stages) || config.stages.length !== config.rounds.length + config.interRounds.length || config.stages.length === 0) {
    issues.push('Последовательность этапов игры повреждена.');
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
    if (!isPersistableTeamName(team?.name) || (requiresPlayable && !team.name.trim())) {
      issues.push(`Команда ${teamIndex + 1}: не задано корректное название.`);
    } else if (requiresPlayable) {
      const normalized = normalizeRuleText(team.name);
      if (teamNames.has(normalized)) issues.push(`Команда ${teamIndex + 1}: название «${team.name.trim()}» уже используется.`);
      teamNames.add(normalized);
    }
    const color = typeof team?.color === 'string' ? team.color.toLowerCase() : '';
    if (!isValidTeamColor(color)) issues.push(`Команда ${teamIndex + 1}: задан некорректный цвет.`);
    else if (requiresPlayable && teamColors.has(color)) issues.push(`Команда ${teamIndex + 1}: этот цвет уже используется другой командой.`);
    if (color) teamColors.add(color);
  });

  config.rounds.forEach((round, roundIndex) => {
    takeId(round?.id, `Раунд ${roundIndex + 1}`);
    if (!isBoundedText(round?.name, DATA_LIMITS.text.roundName) || (requiresPlayable && !round.name.trim())) issues.push(`Раунд ${roundIndex + 1}: не задано корректное название.`);
    if (!Array.isArray(round?.categories) || round.categories.length < 1 || round.categories.length > GAME_LIMITS.categoriesPerRound) {
      issues.push(`Раунд ${roundIndex + 1}: должно быть от 1 до ${GAME_LIMITS.categoriesPerRound} категорий.`);
      return;
    }

    round.categories.forEach((category, categoryIndex) => {
      takeId(category?.id, `Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}`);
      if (!isBoundedText(category?.name, DATA_LIMITS.text.categoryName) || (requiresPlayable && !category.name.trim())) {
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
        if (!isValidQuestionPoints(question?.points)) {
          issues.push(`${prefix}: стоимость должна быть целым числом от 1 до ${DATA_LIMITS.maxQuestionPoints}.`);
        } else if (requiresPlayable && usedPoints.has(question.points)) {
          issues.push(`${prefix}: стоимость ${question.points} уже используется в этой категории.`);
        } else {
          usedPoints.add(question.points);
        }
        if (question?.songId !== undefined && (!isBoundedText(question.songId, DATA_LIMITS.text.id) || !question.songId)) issues.push(`${prefix}: некорректная ссылка на песню.`);
      });
    });
  });

  config.interRounds.forEach((interRound, index) => validateInterRound(interRound, index, mode, takeId, issues));

  const roundIds = new Set(config.rounds.map((round) => round.id));
  const interRoundIds = new Set(config.interRounds.map((interRound) => interRound.id));
  const usedRoundIds = new Set<string>();
  const usedInterRoundIds = new Set<string>();
  config.stages.forEach((stage, index) => {
    takeId(stage?.id, `Этап ${index + 1}`);
    if (stage?.kind === 'round') {
      if (!roundIds.has(stage.roundId)) issues.push(`Этап ${index + 1}: ссылка на отсутствующий раунд.`);
      if (usedRoundIds.has(stage.roundId)) issues.push(`Этап ${index + 1}: раунд добавлен в последовательность повторно.`);
      usedRoundIds.add(stage.roundId);
    } else if (stage?.kind === 'interRound') {
      if (!interRoundIds.has(stage.interRoundId)) issues.push(`Этап ${index + 1}: ссылка на отсутствующий межраунд.`);
      if (usedInterRoundIds.has(stage.interRoundId)) issues.push(`Этап ${index + 1}: межраунд добавлен в последовательность повторно.`);
      usedInterRoundIds.add(stage.interRoundId);
    } else {
      issues.push(`Этап ${index + 1}: неизвестный тип этапа.`);
    }
  });
  if (usedRoundIds.size !== roundIds.size || usedInterRoundIds.size !== interRoundIds.size) issues.push('Не все раунды и межраунды включены в последовательность игры.');

  return issues;
}

function validateInterRound(
  interRound: InterRound,
  index: number,
  mode: GameValidationMode,
  takeId: (id: unknown, label: string) => void,
  issues: string[],
) {
  const requiresPlayable = mode === 'playable';
  const prefix = `Межраунд ${index + 1}`;
  takeId(interRound?.id, prefix);
  if (!isBoundedText(interRound?.title, DATA_LIMITS.text.interRoundTitle) || (requiresPlayable && !interRound.title.trim())) issues.push(`${prefix}: не задано корректное название.`);
  if (interRound?.templateId === 'continueLyrics' && interRound.templateVersion !== 1) issues.push(`${prefix}: версия шаблона не поддерживается.`);
  if (interRound?.templateId === 'commonTheme4' && interRound.templateVersion !== 2) issues.push(`${prefix}: версия шаблона не поддерживается.`);

  if (interRound?.templateId === 'continueLyrics') {
    if (!Array.isArray(interRound.tasks) || interRound.tasks.length < 1 || interRound.tasks.length > GAME_LIMITS.continueLyricsTasks) {
      issues.push(`${prefix}: должно быть от 1 до ${GAME_LIMITS.continueLyricsTasks} заданий.`);
      return;
    }
    interRound.tasks.forEach((task, taskIndex) => {
      const taskPrefix = `${prefix}, задание ${taskIndex + 1}`;
      takeId(task?.id, taskPrefix);
      if (!task || typeof task !== 'object') {
        issues.push(`${taskPrefix}: некорректная структура задания.`);
        return;
      }
      if (task.trackId !== undefined && (!isBoundedText(task.trackId, DATA_LIMITS.text.id) || !task.trackId)) issues.push(`${taskPrefix}: некорректная ссылка на аудиотрек.`);
      if (requiresPlayable && !task.trackId) issues.push(`${taskPrefix}: не выбран аудиотрек.`);
      if (!isValidContinueLyricsRequiredWordsCount(task.requiredWordsCount)) issues.push(`${taskPrefix}: количество слов должно быть от ${INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount.min} до ${INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount.max}.`);
      if (!isValidContinueLyricsCutAtMs(task.cutAtMs)) issues.push(`${taskPrefix}: время остановки должно быть от 0,5 секунды до 6 часов.`);
      if (!isBoundedText(task.answerText, DATA_LIMITS.text.interRoundAnswer) || (requiresPlayable && !task.answerText.trim())) issues.push(`${taskPrefix}: не указан правильный текст ответа.`);
    });
    return;
  }

  if (interRound?.templateId === 'commonTheme4') {
    if (!Array.isArray(interRound.stages) || interRound.stages.length < 1 || interRound.stages.length > GAME_LIMITS.commonThemeStages) {
      issues.push(`${prefix}: должно быть от 1 до ${GAME_LIMITS.commonThemeStages} этапов по 4 трека.`);
      return;
    }
    interRound.stages.forEach((stage, stageIndex) => {
      const stagePrefix = `${prefix}, этап ${stageIndex + 1}`;
      takeId(stage?.id, stagePrefix);
      if (!stage || typeof stage !== 'object') {
        issues.push(`${stagePrefix}: некорректная структура этапа.`);
        return;
      }
      if (!Array.isArray(stage.tracks) || stage.tracks.length !== 4) {
        issues.push(`${stagePrefix}: должно быть ровно 4 трека.`);
        return;
      }
      stage.tracks.forEach((track, trackIndex) => {
        const trackPrefix = `${stagePrefix}, трек ${trackIndex + 1}`;
        takeId(track?.id, trackPrefix);
        if (!track || typeof track !== 'object') {
          issues.push(`${trackPrefix}: некорректная структура трека.`);
          return;
        }
        if (track.trackId !== undefined && (!isBoundedText(track.trackId, DATA_LIMITS.text.id) || !track.trackId)) issues.push(`${trackPrefix}: некорректная ссылка на аудиотрек.`);
        if (requiresPlayable && !track.trackId) issues.push(`${trackPrefix}: не выбран аудиотрек.`);
        if (!isBoundedText(track.answerTitle, DATA_LIMITS.text.songTitle) || (requiresPlayable && !track.answerTitle.trim())) issues.push(`${trackPrefix}: не указано название песни для ответа.`);
        if (!isBoundedText(track.answerArtist, DATA_LIMITS.text.artist) || (requiresPlayable && !track.answerArtist.trim())) issues.push(`${trackPrefix}: не указан исполнитель для ответа.`);
      });
      if (!isBoundedText(stage.commonTheme, DATA_LIMITS.text.commonTheme) || (requiresPlayable && !stage.commonTheme.trim())) issues.push(`${stagePrefix}: не указана общая тема.`);
    });
    return;
  }

  issues.push(`${prefix}: неизвестный шаблон межраунда.`);
}

export function getGameStartIssues(
  config: GameConfig,
  songs: Song[],
  mediaTracks: MediaTrack[],
  audioAssets: AudioAsset[],
  completedQuestionIds: string[] = [],
  completedInterRoundIds: string[] = [],
): string[] {
  const issues = [...getGameStructureIssues(config)];
  if (issues.length > 0) return issues;

  const completed = new Set(completedQuestionIds);
  const completedInterRounds = new Set(completedInterRoundIds);
  const songById = new Map(songs.map((song) => [song.id, song]));
  const trackById = new Map(mediaTracks.map((track) => [track.id, track]));
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
        if (!hasPlayableTrack(song.minusTrackId, trackById, audioById)) issues.push(`${prefix}: отсутствует или повреждён минус.`);
        if (!hasPlayableTrack(song.plusTrackId, trackById, audioById)) issues.push(`${prefix}: отсутствует или повреждён плюс.`);
      }
    }
  }

  for (const interRound of config.interRounds) {
    if (completedInterRounds.has(interRound.id)) continue;
    if (interRound.templateId === 'continueLyrics') {
      interRound.tasks.forEach((task, index) => {
        if (!hasPlayableTrack(task.trackId, trackById, audioById)) issues.push(`Межраунд «${interRound.title}», задание ${index + 1}: аудиотрек отсутствует или повреждён.`);
      });
      continue;
    }
    interRound.stages.forEach((stage, stageIndex) => {
      stage.tracks.forEach((track, trackIndex) => {
        if (!hasPlayableTrack(track.trackId, trackById, audioById)) issues.push(`Межраунд «${interRound.title}», этап ${stageIndex + 1}, трек ${trackIndex + 1}: аудиотрек отсутствует или повреждён.`);
      });
    });
  }

  return issues;
}

export function getSessionContinuationIssues(
  config: GameConfig,
  session: GameSession | undefined,
  songs: Song[],
  mediaTracks: MediaTrack[],
  audioAssets: AudioAsset[],
) {
  return getGameStartIssues(
    config,
    songs,
    mediaTracks,
    audioAssets,
    session?.completedQuestionIds ?? [],
    session?.completedInterRoundIds ?? [],
  );
}

export function assertValidSong(song: Song): void {
  assertPersistableSong(song);
  if (!song.artist.trim() && !song.title.trim()) throw new Error(`Песня «${song.id}» не содержит исполнителя и названия.`);
}

function assertPersistableSong(song: Song): void {
  if (!song || !isBoundedText(song.id, DATA_LIMITS.text.id) || !song.id) throw new Error('В хранилище найдена песня с некорректным id.');
  if (!isBoundedText(song.artist, DATA_LIMITS.text.artist) || !isBoundedText(song.title, DATA_LIMITS.text.songTitle)) throw new Error(`Песня «${song.id}» содержит слишком длинное или некорректное название/исполнителя.`);
  if (!isValidTimestamp(song.createdAt) || !isValidTimestamp(song.updatedAt)) throw new Error(`Песня «${song.id}» содержит некорректную дату.`);
  for (const trackId of [song.minusTrackId, song.plusTrackId]) {
    if (trackId !== undefined && (!isBoundedText(trackId, DATA_LIMITS.text.id) || !trackId)) throw new Error(`Песня «${song.id}» содержит некорректную ссылку на медиатрек.`);
  }
}

export function assertValidMediaTrack(track: MediaTrack): void {
  if (!track || !isBoundedText(track.id, DATA_LIMITS.text.id) || !track.id) throw new Error('В хранилище найден медиатрек с некорректным id.');
  if (!isBoundedText(track.name, DATA_LIMITS.text.mediaTrackName) || !track.name.trim()) throw new Error(`Медиатрек «${track.id}» не содержит корректного названия.`);
  if (!isSha256(track.audioId)) throw new Error(`Медиатрек «${track.name}» содержит некорректную ссылку на аудио.`);
  if (!isValidTimestamp(track.createdAt) || !isValidTimestamp(track.updatedAt)) throw new Error(`Медиатрек «${track.name}» содержит некорректную дату.`);
}

export function assertValidPersistedState(state: PersistedState): void {
  if (!state || state.version !== 4 || !Array.isArray(state.games) || !Array.isArray(state.songs) || !Array.isArray(state.mediaTracks) || !Array.isArray(state.audioAssets) || !Array.isArray(state.sessions)) {
    throw new Error('Локальное хранилище имеет неподдерживаемую структуру.');
  }
  for (const game of state.games) {
    const issues = getGameStorageIssues(game);
    if (issues.length > 0) throw new Error(`Локальная игра «${game?.title || game?.id || 'без названия'}» повреждена: ${issues[0]}`);
  }
  state.songs.forEach(assertPersistableSong);
  state.mediaTracks.forEach(assertValidMediaTrack);

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
  const trackIds = new Set<string>();
  for (const track of state.mediaTracks) {
    if (trackIds.has(track.id)) throw new Error(`Медиатрек «${track.id}» продублирован в локальном хранилище.`);
    trackIds.add(track.id);
  }
  const audioIds = new Set<string>();
  for (const asset of state.audioAssets) {
    if (!isVerifiedAudioAsset(asset)) throw new Error('Локальное хранилище содержит повреждённую запись аудио.');
    if (audioIds.has(asset.id)) throw new Error(`Аудиофайл «${asset.id}» продублирован в локальном хранилище.`);
    audioIds.add(asset.id);
  }

  for (const track of state.mediaTracks) if (!audioIds.has(track.audioId)) throw new Error(`Медиатрек «${track.name}» ссылается на отсутствующий аудиофайл.`);
  for (const song of state.songs) {
    for (const trackId of [song.minusTrackId, song.plusTrackId]) {
      if (trackId && !trackIds.has(trackId)) throw new Error(`Песня «${song.artist} — ${song.title}» ссылается на отсутствующий медиатрек.`);
    }
  }
  for (const game of state.games) {
    for (const question of game.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions))) {
      if (question.songId && !songIds.has(question.songId)) throw new Error(`Игра «${game.title}» ссылается на отсутствующую песню.`);
    }
    for (const interRound of game.interRounds) {
      for (const trackId of getInterRoundTrackIds(interRound)) if (trackId && !trackIds.has(trackId)) throw new Error(`Межраунд «${interRound.title}» ссылается на отсутствующий медиатрек.`);
    }
  }

  const sessionGameIds = new Set<string>();
  for (const session of state.sessions) {
    if (!session || !gameIds.has(session.gameId)) throw new Error('Локальное хранилище содержит сессию для отсутствующей игры.');
    if (sessionGameIds.has(session.gameId)) throw new Error(`Для игры «${session.gameId}» найдено несколько игровых сессий.`);
    sessionGameIds.add(session.gameId);

    const game = state.games.find((item) => item.id === session.gameId)!;
    const teamIds = new Set(game.teams.map((team) => team.id));
    const questionIds = new Set(game.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions.map((question) => question.id))));
    const interRoundIds = new Set(game.interRounds.map((interRound) => interRound.id));

    if (!Number.isSafeInteger(session.stageIndex) || session.stageIndex < 0 || session.stageIndex > game.stages.length || typeof session.started !== 'boolean' || typeof session.answerRevealed !== 'boolean' || !isValidTimestamp(session.updatedAt)) {
      throw new Error('Локальное хранилище содержит повреждённую игровую сессию.');
    }
    if (!Array.isArray(session.history) || session.history.length > DATA_LIMITS.sessionHistoryEntries || session.history.some((entry) => !isValidHistoryEntry(entry))) {
      throw new Error('Локальное хранилище содержит повреждённую историю игровой сессии.');
    }
    const expectedStageId = game.stages[session.stageIndex]?.id ?? null;
    if (session.stageId !== expectedStageId) throw new Error('Игровая сессия содержит несогласованный активный этап.');

    for (const list of [session.completedQuestionIds, session.completedInterRoundIds, session.activeExcludedTeamIds, session.currentIncorrectTeamIds, session.nextExcludedTeamIds]) {
      if (!Array.isArray(list) || list.some((id) => !isBoundedText(id, DATA_LIMITS.text.id))) throw new Error('Локальное хранилище содержит повреждённый список идентификаторов в игровой сессии.');
    }
    if (session.completedQuestionIds.some((id) => !questionIds.has(id))) throw new Error('Игровая сессия содержит завершённый вопрос из другой игры.');
    if (session.completedInterRoundIds.some((id) => !interRoundIds.has(id))) throw new Error('Игровая сессия содержит завершённый межраунд из другой игры.');
    for (const ids of [session.activeExcludedTeamIds, session.currentIncorrectTeamIds, session.nextExcludedTeamIds]) {
      if (ids.some((id) => !teamIds.has(id))) throw new Error('Игровая сессия содержит ссылку на отсутствующую команду.');
    }

    if (!session.scores || typeof session.scores !== 'object' || Object.values(session.scores).some((score) => !Number.isSafeInteger(score))) throw new Error('Локальное хранилище содержит повреждённые баллы игровой сессии.');
    if (Object.keys(session.scores).some((teamId) => !teamIds.has(teamId)) || [...teamIds].some((teamId) => !Number.isSafeInteger(session.scores[teamId]))) {
      throw new Error('Таблица счёта игровой сессии не соответствует списку команд.');
    }

    const activeStage = game.stages[session.stageIndex];
    const activeRound = activeStage?.kind === 'round'
      ? game.rounds.find((item) => item.id === activeStage.roundId)
      : undefined;
    const activeRoundQuestionIds = new Set(activeRound?.categories.flatMap((category) => category.questions.map((question) => question.id)) ?? []);
    if (session.activeQuestionId !== null) {
      if (!isBoundedText(session.activeQuestionId, DATA_LIMITS.text.id) || !activeStage || activeStage.kind !== 'round') throw new Error('Игровая сессия содержит некорректный активный вопрос.');
      if (!activeRoundQuestionIds.has(session.activeQuestionId)) throw new Error('Активный вопрос не относится к текущему раунду.');
    }
    if (session.pausedQuestionId !== null) {
      if (session.activeQuestionId !== null || !isBoundedText(session.pausedQuestionId, DATA_LIMITS.text.id) || !activeRoundQuestionIds.has(session.pausedQuestionId) || session.completedQuestionIds.includes(session.pausedQuestionId)) {
        throw new Error('Игровая сессия содержит некорректный приостановленный вопрос.');
      }
    }
    if (session.awardedTeamId !== null && (!teamIds.has(session.awardedTeamId) || !session.activeQuestionId)) throw new Error('Игровая сессия содержит некорректную команду-победителя вопроса.');

    if (session.interRound) {
      if (!activeStage || activeStage.kind !== 'interRound' || activeStage.interRoundId !== session.interRound.interRoundId) throw new Error('Прогресс межраунда не соответствует текущему этапу.');
      if (!isBoundedText(session.interRound.interRoundId, DATA_LIMITS.text.id) || !['intro', 'play', 'answer'].includes(session.interRound.phase) || !Number.isSafeInteger(session.interRound.taskIndex) || session.interRound.taskIndex < 0 || !Number.isSafeInteger(session.interRound.trackIndex) || session.interRound.trackIndex < 0) throw new Error('Локальное хранилище содержит повреждённый прогресс межраунда.');
      const interRound = game.interRounds.find((item) => item.id === session.interRound!.interRoundId)!;
      const items = interRound.templateId === 'continueLyrics' ? interRound.tasks : interRound.stages;
      const expectedItemId = items[session.interRound.taskIndex]?.id ?? null;
      if (session.interRound.itemId !== expectedItemId) throw new Error('Прогресс межраунда содержит несогласованный текущий шаг.');
      if (interRound.templateId === 'continueLyrics' && session.interRound.trackIndex !== 0) throw new Error('Некорректная позиция трека в межраунде «Продолжи песню».');
      if (interRound.templateId === 'commonTheme4' && session.interRound.trackIndex > 4) throw new Error('Некорректная позиция трека в межраунде «4 трека».');
    } else if (activeStage?.kind === 'interRound' && session.completedInterRoundIds.includes(activeStage.interRoundId)) {
      throw new Error('Сессия остановлена на уже завершённом межраунде.');
    }
  }
  if (state.activeGameId !== null && !gameIds.has(state.activeGameId)) throw new Error('Активная игра отсутствует в локальном хранилище.');
}

function isValidHistoryEntry(entry: unknown): entry is GameSessionHistoryEntry {
  if (!entry || typeof entry !== 'object') return false;
  const value = entry as Partial<GameSessionHistoryEntry>;
  if (typeof value.started !== 'boolean' || typeof value.answerRevealed !== 'boolean') return false;
  if (!Number.isSafeInteger(value.stageIndex) || (value.stageIndex as number) < 0) return false;
  if (value.stageId !== null && !isBoundedText(value.stageId, DATA_LIMITS.text.id)) return false;
  if (value.activeQuestionId !== null && !isBoundedText(value.activeQuestionId, DATA_LIMITS.text.id)) return false;
  if (value.pausedQuestionId !== null && !isBoundedText(value.pausedQuestionId, DATA_LIMITS.text.id)) return false;
  if (value.awardedTeamId !== null && !isBoundedText(value.awardedTeamId, DATA_LIMITS.text.id)) return false;
  for (const list of [
    value.completedQuestionIds,
    value.completedInterRoundIds,
    value.activeExcludedTeamIds,
    value.currentIncorrectTeamIds,
    value.nextExcludedTeamIds,
  ]) {
    if (!Array.isArray(list) || list.some((id) => !isBoundedText(id, DATA_LIMITS.text.id))) return false;
  }
  if (!value.scores || typeof value.scores !== 'object' || Object.entries(value.scores).some(([teamId, score]) => !isBoundedText(teamId, DATA_LIMITS.text.id) || !Number.isSafeInteger(score))) return false;
  if (value.interRound !== null) {
    const progress = value.interRound;
    if (!progress || !isBoundedText(progress.interRoundId, DATA_LIMITS.text.id)) return false;
    if (!['intro', 'play', 'answer'].includes(progress.phase)) return false;
    if (!Number.isSafeInteger(progress.taskIndex) || progress.taskIndex < 0) return false;
    if (progress.itemId !== null && !isBoundedText(progress.itemId, DATA_LIMITS.text.id)) return false;
    if (!Number.isSafeInteger(progress.trackIndex) || progress.trackIndex < 0) return false;
  }
  return true;
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

function hasPlayableTrack(trackId: string | undefined, trackById: Map<string, MediaTrack>, audioById: Map<string, AudioAsset>) {
  return hasAvailableAudioAssetReference(trackId, trackById, audioById);
}
