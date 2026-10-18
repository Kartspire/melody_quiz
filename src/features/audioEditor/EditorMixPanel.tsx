import { useEffect, useRef, useState } from 'react';
import type { AudioAsset, AudioProject, MediaTrack } from '../../model/types';
import { getErrorMessage } from '../../lib/errors';
import { captureStateWrite } from '../../model/core/writeAccess';
import { GainSlider } from './editorFields';
import { analyzeMix } from './analyzeMix';
import { normalizationGain, type LoudnessAnalysis } from './loudness';
import type { MixLevels } from './audioEngine';
import { NumberField } from './AudioEditorClipInspector';

export function EditorMixPanel({ project, tracks, assets, levels, onChange, onBegin, onCommit }: {
  project: AudioProject; tracks: readonly MediaTrack[]; assets: readonly AudioAsset[]; levels: MixLevels;
  onChange: (project: AudioProject, preview?: boolean) => void; onBegin: () => void; onCommit: () => void;
}) {
  const peaks = useRef({ left: 0, right: 0 });
  peaks.current.left = Math.max(peaks.current.left, levels.left); peaks.current.right = Math.max(peaks.current.right, levels.right);
  const [, refresh] = useState(0);
  const [analysis, setAnalysis] = useState<{ result: LoudnessAnalysis; project: AudioProject; tracks: readonly MediaTrack[]; assets: readonly AudioAsset[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageGain, setMessageGain] = useState<number | null>(null);
  const [target, setTarget] = useState(-16);
  const controller = useRef<AbortController | null>(null);
  const current = useRef(project); current.current = project;
  useEffect(() => () => controller.current?.abort(), []);
  const valid = analysis?.project === project && analysis.tracks === tracks && analysis.assets === assets ? analysis.result : null;
  const analyze = async () => {
    if (controller.current) return;
    const c = new AbortController(); controller.current = c; setBusy(true); setMessage(''); setMessageGain(null);
    try {
      const result = await analyzeMix(project, tracks, assets, c.signal);
      if (current.current !== project) throw new Error('Монтаж изменился. Повторите анализ.');
      setAnalysis({ result, project, tracks, assets });
    } catch (error) { if (!c.signal.aborted) setMessage(getErrorMessage(error, 'Не удалось проанализировать микс.')); }
    finally { controller.current = null; setBusy(false); }
  };
  const apply = (mode: 'peak' | 'lufs') => {
    if (!valid) return;
    try {
      captureStateWrite()();
      const result = normalizationGain(valid, project.masterGainDb ?? 0, mode, target);
      setMessageGain(result.gainDb);
      onChange({ ...project, masterGainDb: result.gainDb });
      setMessage(`Применено: ${result.gainDb.toFixed(1)} dB.${result.limited ? ' Цель ограничена пиками или диапазоном общей громкости.' : ''}${result.lufs !== null ? ` Ожидается ${result.lufs.toFixed(1)} LUFS.` : ''}`);
    } catch (error) { setMessageGain(null); setMessage(getErrorMessage(error, 'Не удалось применить нормализацию.')); }
  };
  return <section className="audio-editor-mix-panel" aria-label="Общий звук">
    <GainSlider label="Общая громкость" value={project.masterGainDb ?? 0} max={24} onBegin={onBegin} onPreview={v => onChange({ ...project, masterGainDb: v }, true)} onCommit={onCommit} />
    <div className="audio-editor-meters">
      {(['left', 'right'] as const).map((channel, index) => <div className="audio-editor-meter" key={channel}><span>{index ? 'R' : 'L'}</span><meter min={-60} max={0} value={levelDb(levels[channel])} aria-label={`Уровень ${index ? 'R' : 'L'}`} /><output className={peaks.current[channel] >= 1 ? 'audio-editor-overload' : ''}>{formatPeak(peaks.current[channel])} dBFS</output></div>)}
      <button className="secondary-button" onClick={() => { peaks.current = { left: 0, right: 0 }; refresh(v => v + 1); }}>Сбросить пики</button>
      {(peaks.current.left >= 1 || peaks.current.right >= 1) && <strong role="status" className="audio-editor-overload">Перегрузка</strong>}
    </div>
    <details className="audio-editor-normalize"><summary>Анализ и нормализация</summary>
      <p>Анализируется весь итоговый микс с учётом дорожек и общей громкости (до 10 минут). Нормализация меняет общую громкость и отменяется через Undo.</p>
      <button className="secondary-button" disabled={busy} onClick={() => void analyze()}>{busy ? 'Анализируем…' : 'Проанализировать микс'}</button>
      {busy && <button className="secondary-button" onClick={() => controller.current?.abort()}>Отменить анализ</button>}
      {valid && <p>Пик: {valid.peakDb?.toFixed(1) ?? '−∞'} dBFS · Громкость: {valid.lufs?.toFixed(1) ?? 'не определена'} LUFS</p>}
      <div className="inline-actions"><button className="secondary-button" disabled={!valid || busy} onClick={() => apply('peak')}>По пику до −1 dBFS</button>
        <NumberField label="Цель, LUFS" value={target} min={-36} max={-5} step={1} onChange={setTarget} />
        <button className="secondary-button" disabled={!valid || busy} onClick={() => apply('lufs')}>По громкости LUFS</button></div>
      <small>Потолок −1 dBFS относится к отсчётам сигнала; true peak и лимитер не применяются.</small>
      {message && (messageGain === null || Math.abs(messageGain - (project.masterGainDb ?? 0)) < 0.000001) && <p role="status">{message}</p>}
    </details>
  </section>;
}
function levelDb(value: number) { return value > 0 ? Math.max(-60, 20 * Math.log10(value)) : -60; }
function formatPeak(value: number) { return value > 0 ? (20 * Math.log10(value)).toFixed(1) : '−∞'; }
