import { createId } from '../lib/ids';
import { getDefaultInterRoundRules } from '../interRounds/templates';
import type { CommonThemeTrack, GameConfig, GameStage, InterRound } from './types';

type LegacyCommonTheme4InterRoundV1 = {
  id: string;
  templateId: 'commonTheme4';
  templateVersion: 1;
  title: string;
  tracks: [CommonThemeTrack, CommonThemeTrack, CommonThemeTrack, CommonThemeTrack];
  commonTheme: string;
};

type RawInterRound = InterRound | LegacyCommonTheme4InterRoundV1;
type RawGameConfig = Omit<GameConfig, 'interRounds' | 'stages'> & {
  interRounds?: RawInterRound[];
  stages?: GameStage[];
};

export function normalizeGameConfig(raw: GameConfig | RawGameConfig): { game: GameConfig; changed: boolean } {
  const source = raw as RawGameConfig;
  let changed = !Array.isArray(source.interRounds) || !Array.isArray(source.stages);
  const interRounds = (Array.isArray(source.interRounds) ? source.interRounds : []).map((interRound) => {
    const normalized = normalizeInterRound(interRound);
    if (normalized.changed) changed = true;
    return normalized.interRound;
  });
  const roundIds = new Set((source.rounds ?? []).map((round) => round.id));
  const interRoundIds = new Set(interRounds.map((interRound) => interRound.id));

  const seenRoundIds = new Set<string>();
  const seenInterRoundIds = new Set<string>();
  const stages: GameStage[] = [];
  for (const stage of source.stages ?? []) {
    if (!stage || typeof stage.id !== 'string') {
      changed = true;
      continue;
    }
    if (stage.kind === 'round' && roundIds.has(stage.roundId) && !seenRoundIds.has(stage.roundId)) {
      stages.push(stage);
      seenRoundIds.add(stage.roundId);
      continue;
    }
    if (stage.kind === 'interRound' && interRoundIds.has(stage.interRoundId) && !seenInterRoundIds.has(stage.interRoundId)) {
      stages.push(stage);
      seenInterRoundIds.add(stage.interRoundId);
      continue;
    }
    changed = true;
  }

  for (const round of source.rounds ?? []) {
    if (!seenRoundIds.has(round.id)) {
      stages.push({ id: createId('stage'), kind: 'round', roundId: round.id });
      changed = true;
    }
  }
  for (const interRound of interRounds) {
    if (!seenInterRoundIds.has(interRound.id)) {
      stages.push({ id: createId('stage'), kind: 'interRound', interRoundId: interRound.id });
      changed = true;
    }
  }

  return {
    changed,
    game: {
      ...source,
      interRounds,
      stages,
    },
  } as { game: GameConfig; changed: boolean };
}

function normalizeInterRound(raw: RawInterRound): { interRound: InterRound; changed: boolean } {
  if (raw?.templateId === 'commonTheme4' && raw.templateVersion === 1 && Array.isArray(raw.tracks)) {
    return {
      changed: true,
      interRound: {
        id: raw.id,
        templateId: 'commonTheme4',
        templateVersion: 2,
        title: raw.title,
        rules: getDefaultInterRoundRules('commonTheme4'),
        stages: [{
          id: createId('theme-stage'),
          tracks: raw.tracks,
          commonTheme: raw.commonTheme,
        }],
      },
    };
  }

  if (raw?.templateId === 'continueLyrics' || raw?.templateId === 'commonTheme4') {
    const candidate = raw as InterRound & { rules?: unknown };
    if (typeof candidate.rules !== 'string') {
      return {
        interRound: {
          ...candidate,
          rules: getDefaultInterRoundRules(candidate.templateId),
        } as InterRound,
        changed: true,
      };
    }
  }

  return { interRound: raw as InterRound, changed: false };
}
