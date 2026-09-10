export const GAME_POINTS_STEP = 10;

export const GAME_LIMITS = {
  rounds: 10,
  categoriesPerRound: 100,
  questionsPerCategory: 100,
  teams: 32,
  interRounds: 20,
  continueLyricsTasks: 50,
  commonThemeStages: 50,
} as const;

/** Creation caps for the eager editor UI. Stored/imported games keep the wider GAME_LIMITS for backwards compatibility. */
export const EDITOR_LIMITS = {
  categoriesPerRound: 20,
  questionsPerCategory: 20,
} as const;

export const INTER_ROUND_LIMITS = {
  continueLyrics: {
    requiredWordsCount: { min: 1, max: 100 },
    cutAtMs: { min: 500, max: 6 * 60 * 60 * 1000 },
  },
} as const;

export const DATA_LIMITS = {
  audioFileBytes: 512 * 1024 * 1024,
  audioUploadBytes: 128 * 1024 * 1024,
  packageBytes: 2 * 1024 * 1024 * 1024,
  manifestBytes: 2 * 1024 * 1024,
  gameJsonBytes: 10 * 1024 * 1024,
  songsJsonBytes: 20 * 1024 * 1024,
  tracksJsonBytes: 20 * 1024 * 1024,
  backupStateJsonBytes: 64 * 1024 * 1024,
  packageFiles: 10_000,
  packageSongs: 5_000,
  packageTracks: 10_000,
  sessionHistoryEntries: 200,
  text: {
    gameTitle: 200,
    roundName: 200,
    categoryName: 200,
    teamName: 100,
    artist: 300,
    songTitle: 300,
    mediaTrackName: 300,
    audioProjectName: 200,
    audioLaneName: 120,
    interRoundTitle: 200,
    interRoundRules: 8_000,
    interRoundAnswer: 1000,
    commonTheme: 500,
    audioName: 255,
    mimeType: 120,
    id: 200,
  },
  maxQuestionPoints: 1_000_000_000,
} as const;
