import { useEffect, useRef } from 'react';
import type { AudioAsset } from '../../model/types';
import { decodeAudioAsset } from './audioBuffers';

const MAX_WAVEFORM_BITMAP_WIDTH = 4096;

export function WaveformCanvas({ asset, sourceStartMs, sourceEndMs }: { asset?: AudioAsset; sourceStartMs: number; sourceEndMs: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = ref.current;
    if (!canvas || !asset) return;

    const draw = async () => {
      const buffer = await decodeAudioAsset(asset);
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
      const data = buffer.getChannelData(0);
      const startSample = Math.max(0, Math.floor(sourceStartMs / 1000 * buffer.sampleRate));
      const endSample = Math.min(data.length, Math.ceil(sourceEndMs / 1000 * buffer.sampleRate));
      const span = Math.max(1, endSample - startSample);
      const step = Math.max(1, Math.floor(span / width));
      const center = height / 2;
      ctx.fillStyle = 'rgba(255,255,255,.62)';
      for (let x = 0; x < width; x += 1) {
        const from = startSample + x * step;
        if (from >= endSample) break;
        const to = Math.min(endSample, from + step);
        let peak = 0;
        for (let index = from; index < to; index += 1) peak = Math.max(peak, Math.abs(data[index] ?? 0));
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
