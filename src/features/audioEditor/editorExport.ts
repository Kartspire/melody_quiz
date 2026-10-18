import type { AudioProjectRange } from '../../model/types';
export function safeAudioName(value: string) {
  const clean = value.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-').trim().replace(/[. ]+$/g, '').slice(0, 110).replace(/[. ]+$/g, '') || 'audio-mix';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
}
export function rangeExportNames(projectName: string, ranges: readonly AudioProjectRange[], existing: readonly string[] = []) {
  const used = new Set(existing.map(n => n.toLocaleLowerCase('ru-RU')));
  return ranges.map(range => {
    const base = safeAudioName(projectName ? `${projectName} — ${range.name}` : range.name);
    let name = base; let suffix = 2;
    while (used.has(name.toLocaleLowerCase('ru-RU'))) name = `${base} (${suffix++})`;
    used.add(name.toLocaleLowerCase('ru-RU'));
    return `${name}.wav`;
  });
}
