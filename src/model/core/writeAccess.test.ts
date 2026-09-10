import { expect, it } from 'vitest';
import { beginStateReplacement, captureStateWrite } from './writeAccess';

it('rejects an audio operation that finishes after state has been replaced', () => {
  const completeOldWrite = captureStateWrite();
  const replacement = beginStateReplacement();
  expect(() => captureStateWrite()).toThrow('Дождитесь');
  replacement.release();
  expect(completeOldWrite).toThrow('импортированы');
  expect(captureStateWrite()).not.toThrow();
});
