import { useEffect, useRef } from 'react';
import type { AudioAsset } from '../../model/types';
import { getWaveformPeaks } from './waveformPeaks';

const MAX_WAVEFORM_BITMAP_WIDTH = 4096;

export function WaveformCanvas({ asset, sourceStartMs, sourceEndMs }: { asset?: AudioAsset; sourceStartMs: number; sourceEndMs: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = ref.current;
    if (!canvas || !asset) return;

    const draw = async () => {
      const waveform = await getWaveformPeaks(asset);
      if (cancelled || !ref.current) return;
      const target = ref.current;
      const rect = target.getBoundingClientRect();
      const width = Math.max(1, Math.min(MAX_WAVEFORM_BITMAP_WIDTH, Math.round(rect.width * window.devicePixelRatio)));
      const height = Math.max(1, Math.round(rect.height * window.devicePixelRatio));
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
      const ctx = target.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const duration = Math.max(1, waveform.durationMs);
      const startRatio = Math.max(0, Math.min(1, sourceStartMs / duration));
      const endRatio = Math.max(startRatio, Math.min(1, sourceEndMs / duration));
      const peakStart = Math.floor(startRatio * waveform.peaks.length);
      const peakEnd = Math.max(peakStart + 1, Math.ceil(endRatio * waveform.peaks.length));
      const peakSpan = Math.max(1, peakEnd - peakStart);
      const center = height / 2;
      ctx.fillStyle = 'rgba(255,255,255,.62)';

      for (let x = 0; x < width; x += 1) {
        const from = peakStart + Math.floor(x / width * peakSpan);
        const to = Math.min(peakEnd, Math.max(from + 1, peakStart + Math.ceil((x + 1) / width * peakSpan)));
        let peak = 0;
        for (let index = from; index < to; index += 1) peak = Math.max(peak, waveform.peaks[index] ?? 0);
        const bar = Math.max(1, peak * height * 0.9);
        ctx.fillRect(x, center - bar / 2, 1, bar);
      }
    };

    void draw().catch(() => undefined);
    const observer = new ResizeObserver(() => void draw().catch(() => undefined));
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [asset, sourceEndMs, sourceStartMs]);

  return <canvas ref={ref} className="audio-editor-waveform" aria-hidden="true" />;
}
