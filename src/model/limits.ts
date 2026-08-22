export const GAME_LIMITS = {
  rounds: 10,
  categoriesPerRound: 100,
  questionsPerCategory: 100,
  teams: 32,
} as const;

export const DATA_LIMITS = {
  audioFileBytes: 512 * 1024 * 1024,
  packageBytes: 4 * 1024 * 1024 * 1024,
  manifestBytes: 2 * 1024 * 1024,
  gameJsonBytes: 10 * 1024 * 1024,
  songsJsonBytes: 20 * 1024 * 1024,
  packageFiles: 20_000,
  packageSongs: 10_000,
  text: {
    gameTitle: 200,
    roundName: 200,
    categoryName: 200,
    teamName: 100,
    artist: 300,
    songTitle: 300,
    audioName: 255,
    mimeType: 120,
    id: 200,
  },
  maxQuestionPoints: 1_000_000_000,
} as const;
