import { useEffect, useRef, useState } from 'react';
import type { AudioAsset, AudioProject, AudioTimeRange, MediaTrack } from '../../model/types';
import { $mediaTracks } from '../../model/core/state';
import { captureStateWrite } from '../../model/core/writeAccess';
import { addMediaTrackFileFx } from '../../model/media';
import { createStoredZip, type ZipInput } from '../../lib/zipStore';
import { downloadBlob } from '../../lib/download';
import { getErrorMessage } from '../../lib/errors';
import { renderAudioProjectToWav } from './audioEngine';
import { getProjectDurationMs } from './audioProject';
import { rangeExportNames, safeAudioName } from './editorExport';
import { TextField } from './editorFields';

export function EditorExportPanel({ project, tracks, assets, range, onSelectRange, onChange }: {
  project: AudioProject; tracks: readonly MediaTrack[]; assets: readonly AudioAsset[]; range: AudioTimeRange | null;
  onSelectRange: (range: AudioTimeRange) => void; onChange: (project: AudioProject) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [rendered, setRendered] = useState<{ blob: Blob; project: AudioProject; name: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const current = useRef({ project, tracks, assets }); current.current = { project, tracks, assets };
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { setRendered(null); }, [project, tracks, assets]);
  const start = () => { const c = new AbortController(); controller.current = c; setBusy(true); setError(''); setProgress('Подготовка…'); return c; };
  const report = (err: unknown, c: AbortController) => { if (c.signal.aborted) setProgress('Остановлено. Уже сохранённые файлы остаются в медиатеке.'); else setError(getErrorMessage(err, 'Не удалось экспортировать.')); };
  const prepare = async (selection: AudioTimeRange | null) => {
    if (controller.current) return;
    const c = start();
    try {
      const blob = await renderAudioProjectToWav(project, tracks, assets, { range: selection, signal: c.signal });
      if (current.current.project !== project || current.current.tracks !== tracks || current.current.assets !== assets) throw new Error('Монтаж или исходники изменились. Подготовьте WAV повторно.');
      setRendered({ blob, project, name: `${safeAudioName(project.name)}${selection ? `_${selection.startMs}-${selection.endMs}ms` : ''}.wav` });
      setProgress('WAV готов.');
    } catch (err) { report(err, c); } finally { controller.current = null; setBusy(false); }
  };
  const saveSingle = async () => {
    if (!rendered || rendered.project !== project || controller.current) return;
    const c = start();
    try {
      const assertWrite = captureStateWrite();
      await addMediaTrackFileFx({ blob: rendered.blob, fileName: rangeExportNames('', [{ id: '', name: rendered.name.slice(0, -4), startMs: 0, endMs: 1 }], $mediaTracks.getState().map(t => t.name))[0], assertCurrent: () => { c.signal.throwIfAborted(); assertWrite(); } });
      setProgress('WAV добавлен в медиатеку.');
    } catch (err) { report(err, c); } finally { controller.current = null; setBusy(false); }
  };
  const batch = async (destination: 'zip' | 'library') => {
    if (controller.current) return;
    const ranges = (project.ranges ?? []).filter(r => selected.includes(r.id));
    if (!ranges.length) return;
    const c = start();
    const entries: ZipInput[] = [];
    try {
      const assertWrite = captureStateWrite();
      const check = () => { c.signal.throwIfAborted(); assertWrite(); };
      if (destination === 'zip' && ranges.reduce((n, r) => n + (r.endMs - r.startMs) / 1000 * 44100 * 4, 0) > 256 * 1024 * 1024) throw new Error('ZIP ограничен 256 МБ. Выберите меньше диапазонов или экспортируйте в медиатеку.');
      const names = rangeExportNames(project.name, ranges, destination === 'library' ? $mediaTracks.getState().map(t => t.name) : []);
      for (let i = 0; i < ranges.length; i++) {
        check(); setProgress(`${i + 1} / ${ranges.length} · ${ranges[i].name}`);
        const blob = await renderAudioProjectToWav(project, tracks, assets, { range: ranges[i], signal: c.signal });
        check();
        if (destination === 'library') await addMediaTrackFileFx({ blob, fileName: names[i], assertCurrent: check });
        else entries.push({ name: names[i], data: blob });
      }
      if (destination === 'zip') { setProgress('Упаковка ZIP…'); const zip = await createStoredZip(entries); check(); downloadBlob(zip, `${safeAudioName(project.name)}-${Date.now()}.zip`); }
      setProgress(`Готово: ${ranges.length} файлов. Использован снимок монтажа на момент запуска.`);
    } catch (err) { report(err, c); } finally { entries.length = 0; controller.current = null; setBusy(false); }
  };
  return <section className="audio-editor-export-panel">
    <strong>Экспорт WAV</strong><p className="audio-editor-muted">Стерео · 44,1 кГц · 16 бит. До 10 минут в одном файле.</p>
    <div className="inline-actions">
      <button className="primary-button" disabled={busy || !getProjectDurationMs(project)} onClick={() => void prepare(null)}>Подготовить WAV</button>
      <button className="secondary-button" disabled={busy || !range} onClick={() => void prepare(range)}>WAV диапазона</button>
      {rendered && rendered.project === project && <><button className="secondary-button" onClick={() => downloadBlob(rendered.blob, rendered.name)}>Скачать WAV</button><button className="secondary-button" disabled={busy} onClick={() => void saveSingle()}>В медиатеку</button></>}
    </div>
    {(project.ranges?.length ?? 0) > 0 && <>
      <strong>Сохранённые диапазоны</strong>
      <div className="audio-editor-named-ranges">{project.ranges!.map(r => <div key={r.id} className="audio-editor-named-range">
        <input type="checkbox" aria-label={`Экспортировать ${r.name}`} checked={selected.includes(r.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))} />
        <TextField label="Название диапазона" value={r.name} maxLength={120} onCommit={name => onChange({ ...project, ranges: project.ranges!.map(item => item.id === r.id ? { ...item, name } : item) })} />
        <button className="secondary-button" onClick={() => onSelectRange(r)}>{(r.startMs / 1000).toFixed(3)}–{(r.endMs / 1000).toFixed(3)} с</button>
        <button className="secondary-button" disabled={!range} onClick={() => range && onChange({ ...project, ranges: project.ranges!.map(item => item.id === r.id ? { ...item, ...range } : item) })}>Обновить границы</button>
        <button className="secondary-button" aria-label={`Удалить диапазон ${r.name}`} onClick={() => onChange({ ...project, ranges: project.ranges!.filter(item => item.id !== r.id) })}>×</button>
      </div>)}</div>
      <div className="inline-actions"><button className="secondary-button" onClick={() => setSelected(project.ranges!.map(r => r.id))}>Выбрать все</button>
        <button className="secondary-button" disabled={busy || !project.ranges!.some(r => selected.includes(r.id))} onClick={() => void batch('zip')}>Выбранные → ZIP</button>
        <button className="secondary-button" disabled={busy || !project.ranges!.some(r => selected.includes(r.id))} onClick={() => void batch('library')}>Выбранные → медиатека</button>
      </div>
    </>}
    {busy && <button className="secondary-button" onClick={() => { controller.current?.abort(); setProgress('Останавливаем: текущий рендер завершится без сохранения.'); }}>Остановить экспорт</button>}
    <span role="status">{progress}</span>{error && <p role="alert">{error}</p>}
  </section>;
}
