import { describe, expect, it } from 'vitest';
import { createCommonTheme4InterRound, createContinueLyricsInterRound, getInterRoundTemplate } from './templates';

describe('inter-round templates', () => {
  it('creates a continue-lyrics inter-round with a single default task', () => {
    const interRound = createContinueLyricsInterRound();
    expect(interRound.templateId).toBe('continueLyrics');
    expect(interRound.templateVersion).toBe(1);
    expect(interRound.tasks).toHaveLength(1);
    expect(interRound.tasks[0].requiredWordsCount).toBe(5);
    expect(interRound.tasks[0].cutAtMs).toBe(30_000);
  });

  it('creates a common-theme inter-round with one default stage of four tracks', () => {
    const interRound = createCommonTheme4InterRound();
    expect(interRound.templateId).toBe('commonTheme4');
    expect(interRound.templateVersion).toBe(2);
    expect(interRound.stages).toHaveLength(1);
    expect(interRound.stages[0].tracks).toHaveLength(4);
    expect(getInterRoundTemplate(interRound.templateId).name).toContain('4 трека');
  });
});
