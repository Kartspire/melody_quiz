import { createId } from '../lib/ids';
import type {
  CommonTheme4InterRound,
  CommonThemeStage,
  CommonThemeTrack,
  ContinueLyricsInterRound,
  InterRound,
  InterRoundTemplateId,
} from '../model/types';

export type InterRoundTemplateDefinition = {
  id: InterRoundTemplateId;
  version: number;
  name: string;
  shortDescription: string;
  rulesTitle: string;
  rules: string[];
  create: (index?: number) => InterRound;
};

export const INTER_ROUND_TEMPLATES: Record<InterRoundTemplateId, InterRoundTemplateDefinition> = {
  continueLyrics: {
    id: 'continueLyrics',
    version: 1,
    name: 'Продолжи песню',
    shortDescription: 'Трек обрывается, а команды записывают указанное количество следующих слов.',
    rulesTitle: 'Правила: продолжи песню',
    create: createContinueLyricsInterRound,
    rules: [
      'Прослушайте фрагмент песни до остановки.',
      'Число на экране показывает, сколько следующих слов нужно записать.',
      'Запишите ответ на бланке и сдайте его ведущему.',
      'После сдачи бланков ведущий покажет правильный текст и включит исходный трек целиком.',
    ],
  },
  commonTheme4: {
    id: 'commonTheme4',
    version: 2,
    name: '4 трека — общая тема',
    shortDescription: 'В каждом этапе звучат четыре трека. Нужно назвать песни, исполнителей и общую тему.',
    rulesTitle: 'Правила: четыре трека',
    create: createCommonTheme4InterRound,
    rules: [
      'В каждом этапе последовательно прозвучат четыре музыкальных трека.',
      'Для каждого трека запишите название песни и исполнителя.',
      'Дополнительно определите одну общую тему, которая объединяет четыре трека текущего этапа.',
      'После сдачи бланков ведущий покажет ответы, затем может перейти к следующему этапу.',
    ],
  },
};

export const INTER_ROUND_TEMPLATE_LIST = Object.values(INTER_ROUND_TEMPLATES);

export function createInterRound(templateId: InterRoundTemplateId, index = 0): InterRound {
  return INTER_ROUND_TEMPLATES[templateId].create(index);
}

export function createContinueLyricsTask() {
  return {
    id: createId('lyrics-task'),
    trackId: undefined,
    requiredWordsCount: 5,
    cutAtMs: 30_000,
    answerText: '',
  };
}

export function createContinueLyricsInterRound(index = 0): ContinueLyricsInterRound {
  return {
    id: createId('inter-round'),
    templateId: 'continueLyrics',
    templateVersion: 1,
    title: index > 0 ? `Продолжи песню ${index + 1}` : 'Продолжи песню',
    tasks: [createContinueLyricsTask()],
  };
}

function createCommonThemeTrack(): CommonThemeTrack {
  return {
    id: createId('theme-track'),
    trackId: undefined,
    answerTitle: '',
    answerArtist: '',
  };
}

export function createCommonThemeStage(): CommonThemeStage {
  return {
    id: createId('theme-stage'),
    tracks: [createCommonThemeTrack(), createCommonThemeTrack(), createCommonThemeTrack(), createCommonThemeTrack()],
    commonTheme: '',
  };
}

export function createCommonTheme4InterRound(index = 0): CommonTheme4InterRound {
  return {
    id: createId('inter-round'),
    templateId: 'commonTheme4',
    templateVersion: 2,
    title: index > 0 ? `4 трека — общая тема ${index + 1}` : '4 трека — общая тема',
    stages: [createCommonThemeStage()],
  };
}

export function getInterRoundTemplate(templateId: InterRoundTemplateId) {
  return INTER_ROUND_TEMPLATES[templateId];
}

export function getInterRoundTrackIds(interRound: InterRound): Array<string | undefined> {
  return interRound.templateId === 'continueLyrics'
    ? interRound.tasks.map((task) => task.trackId)
    : interRound.stages.flatMap((stage) => stage.tracks.map((track) => track.trackId));
}

export function remapInterRoundTrackIds(interRound: InterRound, mapTrackId: (trackId: string) => string | undefined): InterRound {
  if (interRound.templateId === 'continueLyrics') {
    return {
      ...interRound,
      tasks: interRound.tasks.map((task) => ({ ...task, trackId: task.trackId ? mapTrackId(task.trackId) : undefined })),
    };
  }
  return {
    ...interRound,
    stages: interRound.stages.map((stage) => ({
      ...stage,
      tracks: stage.tracks.map((track) => ({ ...track, trackId: track.trackId ? mapTrackId(track.trackId) : undefined })) as typeof stage.tracks,
    })),
  };
}

export function cloneInterRoundInstance(source: InterRound): InterRound {
  if (source.templateId === 'continueLyrics') {
    return {
      ...source,
      id: createId('inter-round'),
      tasks: source.tasks.map((task) => ({ ...task, id: createId('lyrics-task') })),
    };
  }
  return {
    ...source,
    id: createId('inter-round'),
    stages: source.stages.map((stage) => ({
      ...stage,
      id: createId('theme-stage'),
      tracks: stage.tracks.map((track) => ({ ...track, id: createId('theme-track') })) as typeof stage.tracks,
    })),
  };
}

export function getInterRoundAnswerStepCount(interRound: InterRound): number {
  return interRound.templateId === 'continueLyrics' ? interRound.tasks.length : interRound.stages.length;
}
