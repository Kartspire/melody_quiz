import { useEffect, useId, useRef, useState } from 'react';
import type { AudioAsset, MediaTrack } from '../../model/types';
import { normalizeSearchText } from '../../lib/search';
import { AUDIO_FILE_ACCEPT } from '../../model/media';

export function EditorSources({ tracks, assets, selectedId, onSelect, onImport, onPreview, isPlaying, disabled }: {
  tracks: readonly MediaTrack[]; assets: readonly AudioAsset[]; selectedId: string; onSelect: (id: string) => void;
  onImport: (files: File[]) => void; onPreview: () => void; isPlaying: boolean; disabled: boolean;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pickerId = useId();
  const [url, setUrl] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const selectedTrack = tracks.find(t => t.id === selectedId);
  const asset = assets.find(a => a.id === selectedTrack?.audioId);
  useEffect(() => { if (!asset) { setUrl(''); return; } const next = URL.createObjectURL(asset.blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [asset]);
  useEffect(() => { if (isPlaying) audio.current?.pause(); }, [isPlaying]);
  const filtered = tracks.filter(t => normalizeSearchText(t.name).includes(normalizeSearchText(query ?? '')));
  const active = Math.min(activeIndex, filtered.length - 1);
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);
  const close = () => { setOpen(false); setQuery(null); };
  const show = () => {
    setActiveIndex(Math.max(0, filtered.findIndex(t => t.id === selectedId)));
    setOpen(true);
  };
  const choose = (id: string) => { onSelect(id); close(); };
  return <div className="audio-editor-sources">
    <div className="audio-editor-source-picker" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) close(); }}>
      <label htmlFor={pickerId}><span>Исходник из медиатеки</span></label>
      <div className="audio-editor-source-input">
        <input ref={input} id={pickerId} role="combobox" autoComplete="off" placeholder="Найти и выбрать трек"
          value={query ?? selectedTrack?.name ?? ''} title={selectedTrack?.name} aria-expanded={open} aria-controls={`${pickerId}-list`}
          aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${pickerId}-option-${active}` : undefined}
          onFocus={e => { show(); e.currentTarget.select(); }} onClick={() => { if (!open) show(); }}
          onChange={e => { setQuery(e.target.value); setActiveIndex(0); setOpen(true); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (!open) show();
              else setActiveIndex(Math.max(0, Math.min(filtered.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))));
            } else if (e.key === 'Enter' && open) {
              e.preventDefault();
              if (filtered[active]) choose(filtered[active].id);
            } else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); }
          }} />
        <button type="button" className="audio-editor-source-toggle" tabIndex={-1} aria-label={open ? 'Скрыть исходники' : 'Показать исходники'}
          onPointerDown={e => e.preventDefault()} onClick={() => { if (open) close(); else { input.current?.focus(); show(); } }}>
          <span aria-hidden="true">▾</span>
        </button>
      </div>
      {open && <div className="audio-editor-source-dropdown">
        <div ref={list} id={`${pickerId}-list`} role="listbox" aria-label="Исходники из медиатеки">
          {filtered.map((track, index) => <button type="button" key={track.id} id={`${pickerId}-option-${index}`} role="option"
            tabIndex={-1} aria-selected={track.id === selectedId} data-active={index === active} title={track.name}
            onPointerDown={e => e.preventDefault()} onClick={() => choose(track.id)}>
            <span>{track.name}</span><span aria-hidden="true">{track.id === selectedId ? '✓' : ''}</span>
          </button>)}
        </div>
        {!filtered.length && <p role="status">{tracks.length ? 'Ничего не найдено' : 'Медиатека пуста — импортируйте аудио'}</p>}
      </div>}
    </div>
    {url && <audio ref={audio} controls preload="none" src={url} onPlay={onPreview} aria-label="Прослушать исходник" />}
    <label className="secondary-button audio-editor-file-button">Импорт аудио<input type="file" accept={AUDIO_FILE_ACCEPT} multiple disabled={disabled} onChange={e => { onImport(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></label>
  </div>;
}
