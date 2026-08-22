// Compatibility facade for the application model.
// Domain logic lives in focused modules; UI can keep importing from this file
// while feature code is migrated independently.

export {
  $activeGameId,
  $audioAssets,
  $games,
  $mediaTracks,
  $sessions,
  $songs,
} from './core/state';

export { $screen, screenChanged } from './app/navigation';
export {
  $hydrated,
  $persistedState,
  $storageError,
  $storageReadOnly,
  $storageSaveStatus,
  appStarted,
  persistedStateImported,
  persistedStateImportFx,
  storageRetryRequested,
} from './app/storage';

export {
  activeGameChanged,
  gameCreated,
  gameDeleted,
  gameDuplicated,
} from './games/library';

export {
  categoryAdded,
  categoryNameChanged,
  categoryRemoved,
  commonThemeChanged,
  commonThemeStageAdded,
  commonThemeStageRemoved,
  commonThemeTrackChanged,
  continueLyricsTaskAdded,
  continueLyricsTaskChanged,
  continueLyricsTaskRemoved,
  gameTitleChanged,
  interRoundAdded,
  interRoundRemoved,
  interRoundTitleChanged,
  questionAdded,
  questionChanged,
  questionRemoved,
  questionSongChanged,
  roundAdded,
  roundNameChanged,
  roundRemoved,
  stageMoved,
  teamAdded,
  teamChanged,
  teamRemoved,
} from './games/editor';

export { $activeGame, $session } from './games/selectors';

export {
  $activeInterRound,
  $activeQuestion,
  $activeRound,
  $activeRoundOrdinal,
  $activeStage,
  $isGameFinished,
  commonThemeTrackAdvanced,
  gameProgressResetRequested,
  interRoundAnswerRevealed,
  interRoundNextRequested,
  interRoundStarted,
  nextStageRequested,
  nobodyGuessed,
  questionClosed,
  questionOpened,
  teamAwarded,
  teamIncorrectToggled,
  teamScoreChanged,
} from './games/session';

export {
  $gameLaunchPrompt,
  gameLaunchPromptDismissed,
  gameLaunchRequested,
  gameLaunchRestartConfirmed,
} from './games/launch';

export {
  mediaTrackAdded,
  mediaTrackAudioChanged,
  mediaTrackChanged,
  mediaTrackDeleteRequested,
  songAdded,
  songChanged,
  songDeleteRequested,
  songDuplicated,
  songTrackChanged,
} from './media/model';

export { isRoundComplete } from './session';
export { hasSessionProgress } from './launch';
