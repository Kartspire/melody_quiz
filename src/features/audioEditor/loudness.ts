export type LoudnessAnalysis = { peakDb: number | null; lufs: number | null; durationMs: number };
type Coefficients = readonly [number, number, number, number, number];
// ITU-R BS.1770-5 Annex 1, Tables 1 and 2; these coefficients require 48 kHz.
// https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
const shelf: Coefficients = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const highpass: Coefficients = [1, -2, 1, -1.99004745483398, 0.99007225036621];
function biquad([b0, b1, b2, a1, a2]: Coefficients) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
export function analyzeStereo48k(channels: readonly Float32Array[]): LoudnessAnalysis {
  if (channels.length !== 2 || channels[0].length !== channels[1].length) throw new Error('Для анализа требуется стерео 48 кГц.');
  const length = channels[0].length;
  const block = 19200, hop = 4800;
  const energies = new Float64Array(Math.max(0, Math.floor((length - block) / hop) + 1));
  let peak = 0;
  for (const samples of channels) {
    const first = biquad(shelf), second = biquad(highpass);
    const ring = new Float64Array(block);
    let sum = 0, index = 0;
    for (let i = 0; i < length; i++) {
      const sample = samples[i];
      if (!Number.isFinite(sample)) throw new Error('В миксе обнаружены некорректные отсчёты.');
      peak = Math.max(peak, Math.abs(sample));
      const weighted = second(first(sample));
      const power = weighted * weighted;
      sum += power - ring[i % block]; ring[i % block] = power;
      if (i + 1 >= block && (i + 1 - block) % hop === 0) energies[index++] += Math.max(0, sum / block);
    }
  }
  const toLufs = (energy: number) => -0.691 + 10 * Math.log10(energy);
  const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const absolute = Array.from(energies).filter(e => toLufs(e) >= -70);
  const relativeGate = absolute.length ? toLufs(average(absolute)) - 10 : Infinity;
  const gated = absolute.filter(e => toLufs(e) >= relativeGate);
  return { peakDb: peak > 0 ? 20 * Math.log10(peak) : null, lufs: gated.length ? toLufs(average(gated)) : null, durationMs: length / 48 };
}
export function normalizationGain(analysis: LoudnessAnalysis, masterGainDb: number, mode: 'peak' | 'lufs', target = -16) {
  if (analysis.peakDb === null) throw new Error('Микс содержит тишину. Громкость не изменена.');
  if (mode === 'lufs' && analysis.lufs === null) throw new Error('Для LUFS нужен слышимый сигнал длиной от 0,4 секунды. Можно использовать нормализацию по пику.');
  const desired = mode === 'peak' ? -1 - analysis.peakDb : target - analysis.lufs!;
  const delta = Math.min(desired, -1 - analysis.peakDb);
  const gainDb = Math.max(-60, Math.min(24, masterGainDb + delta));
  const actualDelta = gainDb - masterGainDb;
  return { gainDb, limited: actualDelta < desired - 0.01, peakDb: analysis.peakDb + actualDelta, lufs: analysis.lufs === null ? null : analysis.lufs + actualDelta };
}
