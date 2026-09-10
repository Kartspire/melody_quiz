import { createEvent, createStore } from 'effector';
import type { Screen } from '../types';
import { canWriteState } from '../core/writeAccess';

export const screenChanged = createEvent<Screen>();

export const $screen = createStore<Screen>('library', { updateFilter: canWriteState })
  .on(screenChanged, (_, screen) => screen);
