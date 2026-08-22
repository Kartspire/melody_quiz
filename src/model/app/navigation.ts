import { createEvent, createStore } from 'effector';
import type { Screen } from '../types';

export const screenChanged = createEvent<Screen>();

export const $screen = createStore<Screen>('library')
  .on(screenChanged, (_, screen) => screen);
