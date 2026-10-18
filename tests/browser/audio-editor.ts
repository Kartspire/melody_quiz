import type { AudioAsset, MediaTrack } from '../../src/model/types';
import { createAudioClip, createAudioProject, createAudioEditorLane } from '../../src/features/audioEditor/audioProject';
import { renderAudioProjectToWav, playAudioProject } from '../../src/features/audioEditor/audioEngine';
import { clearDecodedAudioBufferCache } from '../../src/features/audioEditor/audioBuffers';
import { encodeStereoWav } from '../../src/features/vocalRemoval/wav';

const button = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector<HTMLPreElement>('#result')!;

button.addEventListener('click', async () => {
  button.disabled = true;
  output.textContent = 'Проверяем…';
  output.dataset.status = 'running';
  const context = new AudioContext();
  const lines: string[] = [];
  try {
    const signal = new Float32Array(44_100 * 10).fill(0.5);
    const asset: AudioAsset = {
      id: 'browser-fade-fixture', name: 'constant.wav', type: 'audio/wav',
      blob: encodeStereoWav(signal, signal, 44_100), sha256: 'fixture', verified: true,
    };
    const track: MediaTrack = { id: 'browser-fade-track', audioId: asset.id, name: 'Constant', createdAt: 1, updatedAt: 1 };
    const cases = [
      { name: 'Пересекающиеся fade 8 + 8 секунд', fadeInMs: 8000, fadeOutMs: 8000, rate: 1, samples: [[1, 0.0625], [2, 0.125], [5, 0.3125], [8, 0.125], [9, 0.0625]] },
      { name: 'Неравные fade 9 + 3 секунды', fadeInMs: 9000, fadeOutMs: 3000, rate: 1, samples: [[1, 0.5 / 9], [7.5, 0.5 * 7.5 / 9], [9, 0.5 / 3]] },
      { name: 'Fade с плато 2 + 3 секунды', fadeInMs: 2000, fadeOutMs: 3000, rate: 1, samples: [[1, 0.25], [5, 0.5], [8.5, 0.25]] },
      { name: 'Только Fade In', fadeInMs: 2000, fadeOutMs: 0, rate: 1, samples: [[1, 0.25], [5, 0.5], [9, 0.5]] },
      { name: 'Только Fade Out', fadeInMs: 0, fadeOutMs: 2000, rate: 1, samples: [[1, 0.5], [5, 0.5], [9, 0.25]] },
      { name: 'Замедленный клип, fade 16 + 16 секунд', fadeInMs: 16_000, fadeOutMs: 16_000, rate: 0.5, samples: [[2, 0.0625], [10, 0.3125], [18, 0.0625]] },
    ];
    for (const test of cases) {
      const project = createAudioProject(test.name);
      project.lanes[0].clips = [{ ...createAudioClip(track.id, 10_000), fadeInMs: test.fadeInMs, fadeOutMs: test.fadeOutMs, playbackRate: test.rate }];
      const wav = await renderAudioProjectToWav(project, [track], [asset]);
      const decoded = await context.decodeAudioData(await wav.arrayBuffer());
      if (Math.abs(decoded.duration - 10 / test.rate) > 0.001) throw new Error(`${test.name}: неверная длительность WAV`);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const pcm = decoded.getChannelData(channel);
        for (const [seconds, expected] of test.samples) {
          const actual = pcm[Math.round(seconds * decoded.sampleRate)];
          if (Math.abs(actual - expected) > 0.001) {
            throw new Error(`${test.name}, канал ${channel}, ${seconds} с: ${actual}, ожидалось ${expected}`);
          }
        }
      }
      lines.push(`PASS — ${test.name}`);
      output.textContent = lines.join('\n');
    }
    const assertLevel = (actual: number, expected: number, label: string, tolerance = 0.002) => { if (Math.abs(actual - expected) > tolerance) throw new Error(`${label}: ${actual}, ожидалось ${expected}`); };
    const rangeProject = createAudioProject('Диапазон с исходными fade');
    rangeProject.lanes[0].clips = [{ ...createAudioClip(track.id, 10000), fadeInMs: 8000, fadeOutMs: 8000 }];
    const rangeWav = await renderAudioProjectToWav(rangeProject, [track], [asset], { range: { startMs: 3000, endMs: 6000 } });
    const rangePcm = await context.decodeAudioData(await rangeWav.arrayBuffer());
    assertLevel(rangePcm.duration, 3, 'Длина диапазона', 0.001);
    assertLevel(rangePcm.getChannelData(0)[Math.round(rangePcm.sampleRate * 0.01)], 0.5 * 3.01 / 8, 'Начало fade при экспорте диапазона');
    assertLevel(rangePcm.getChannelData(1)[rangePcm.sampleRate * 2], 0.3125, 'Пересечение fade');
    lines.push('PASS — Диапазон сохраняет огибающую исходного клипа');
    const mixed = createAudioProject('Общий звук');
    mixed.masterGainDb = -6;
    mixed.lanes[0].clips = [createAudioClip(track.id, 10000), createAudioClip(track.id, 10000)];
    mixed.lanes.push({ ...createAudioEditorLane(1), muted: true, clips: [createAudioClip(track.id, 10000)] });
    const mixedPcm = await context.decodeAudioData(await (await renderAudioProjectToWav(mixed, [track], [asset], { range: { startMs: 1000, endMs: 2000 } })).arrayBuffer());
    assertLevel(mixedPcm.getChannelData(0)[1000], 10 ** (-6 / 20), 'Master, наложение и mute');
    lines.push('PASS — Общая громкость, наложение и mute в WAV');
    const long = createAudioProject(); long.lanes[0].clips = [createAudioClip(track.id, 10000, 1200000)];
    const longPcm = await context.decodeAudioData(await (await renderAudioProjectToWav(long, [track], [asset], { range: { startMs: 1201000, endMs: 1202000 } })).arrayBuffer());
    assertLevel(longPcm.duration, 1, 'Короткий диапазон длинного проекта');
    assertLevel(longPcm.getChannelData(0)[1000], 0.5, 'Исходник далеко на таймлайне');
    lines.push('PASS — Короткий WAV из проекта длиннее 10 минут');
    const live = createAudioProject(); live.lanes[0].clips = [createAudioClip(track.id, 10000)];
    const handle = await playAudioProject(live, [track], [asset], 1000, { range: { startMs: 1000, endMs: 1200 }, loop: true });
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await wait(450);
      if (handle.position!() < 1000 || handle.position!() >= 1200 || handle.ended!()) throw new Error('Повтор вышел за границы диапазона');
      assertLevel(handle.levels!().left, 0.5, 'Уровень L', 0.01); assertLevel(handle.levels!().right, 0.5, 'Уровень R', 0.01);
      live.masterGainDb = -6; handle.updateMix!(live); await wait(140);
      assertLevel(handle.levels!().left, 0.5 * 10 ** (-6 / 20), 'Общая громкость без остановки', 0.01);
      live.lanes[0].muted = true; handle.updateMix!(live); await wait(140);
      assertLevel(handle.levels!().left, 0, 'Mute без остановки', 0.001);
      live.lanes[0].muted = false; live.lanes[0].clips[0].gainDb = -6; handle.updateMix!(live); await wait(140);
      assertLevel(handle.levels!().right, 0.5 * 10 ** (-12 / 20), 'Громкость фрагмента без остановки', 0.01);
      live.lanes[0].clips[0].fadeInMs = 8000; handle.updateMix!(live); await wait(140);
      const faded = handle.levels!().left;
      if (faded < 0.014 || faded > 0.020) throw new Error(`Live fade: ${faded}`);
      lines.push('PASS — Повтор, стереометры и живые master/gain/mute/fade');
    } finally { handle.stop(); }
    output.dataset.status = 'passed';
    output.textContent = lines.join('\n') + `\n\nУспешно: ${lines.length} из ${lines.length}.`;
  } catch (error) {
    output.dataset.status = 'failed';
    output.textContent = [...lines, `FAIL — ${error instanceof Error ? error.message : String(error)}`].join('\n');
  } finally {
    clearDecodedAudioBufferCache();
    await context.close();
    button.disabled = false;
  }
});
