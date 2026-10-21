import { useEffect, useRef } from 'react';
import type { Progress, SpeechStats } from '../../../shared/types.ts';

export type Status =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'downloading'; files: Record<string, Progress> }
  | { kind: 'loading' }
  | { kind: 'streaming' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

interface Props {
  status: Status;
  /** Peak amplitude of each 80 ms chunk received. */
  peaks: number[];
  stats: SpeechStats | null;
  sampleRate: number;
  canGenerate: boolean;
  onGenerate: () => void;
  onStop: () => void;
  wavUrl: string | null;
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} Mo`;

function Waveform({ peaks }: { peaks: number[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = el.getBoundingClientRect();
    el.width = width * dpr;
    el.height = height * dpr;
    const ctx = el.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(el).getPropertyValue('--accent') || '#6d5dfc';
    // At least 30 s of room, so the bars do not jump while short phrases stream in.
    const slots = Math.max(peaks.length, 375);
    const bar = width / slots;
    peaks.forEach((p, i) => {
      const h = Math.max(1, Math.min(1, p) * height * 0.9);
      ctx.fillRect(i * bar, (height - h) / 2, Math.max(1, bar - 0.5), h);
    });
  }, [peaks]);
  return <canvas ref={canvas} className="waveform" />;
}

export function PlayerPanel({ status, peaks, stats, sampleRate, canGenerate, onGenerate, onStop, wavUrl }: Props) {
  const busy = ['connecting', 'downloading', 'loading', 'streaming'].includes(status.kind);
  const audioSeconds = stats ? stats.samples / sampleRate : (peaks.length * 1920) / sampleRate;

  return (
    <section className="panel player">
      <div className="row actions">
        {busy ? (
          <button className="primary stop" onClick={onStop}>
            ■ Stop
          </button>
        ) : (
          <button className="primary" onClick={onGenerate} disabled={!canGenerate}>
            ▶ Générer
          </button>
        )}
        <span className="status">
          {status.kind === 'connecting' && 'Connexion…'}
          {status.kind === 'loading' && 'Chargement du modèle en mémoire…'}
          {status.kind === 'streaming' && `Lecture en streaming · ${audioSeconds.toFixed(1)} s`}
          {status.kind === 'done' && (stats?.cancelled ? 'Interrompu' : 'Terminé')}
          {status.kind === 'downloading' && 'Téléchargement depuis Hugging Face…'}
        </span>
        {wavUrl && !busy && (
          <a className="button" href={wavUrl} download="phonon.wav">
            ⬇ WAV
          </a>
        )}
      </div>

      {status.kind === 'downloading' && (
        <div className="downloads">
          {Object.values(status.files).map((p) => (
            <div key={p.file} className="download">
              <span>{p.file}</span>
              <progress value={p.loaded} max={p.total ?? undefined} />
              <span className="meta">
                {mb(p.loaded)}
                {p.total ? ` / ${mb(p.total)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {status.kind === 'error' && <p className="error">{status.message}</p>}

      <Waveform peaks={peaks} />

      {stats && (
        <dl className="stats">
          <div>
            <dt>1er son</dt>
            <dd>{stats.firstAudioMs != null ? `${stats.firstAudioMs.toFixed(0)} ms` : '–'}</dd>
          </div>
          <div>
            <dt>RTF</dt>
            <dd title="temps de génération / durée de l'audio">{audioSeconds ? (stats.totalMs / 1000 / audioSeconds).toFixed(3) : '–'}</dd>
          </div>
          <div>
            <dt>Audio</dt>
            <dd>{audioSeconds.toFixed(2)} s</dd>
          </div>
          <div>
            <dt>Génération</dt>
            <dd>{(stats.totalMs / 1000).toFixed(2)} s</dd>
          </div>
          <div>
            <dt>Trames · tokens · segments</dt>
            <dd>
              {stats.frames} · {stats.tokens} · {stats.chunks}
            </dd>
          </div>
          <div>
            <dt>Pas (moy / min / max)</dt>
            <dd>
              {stats.stepMs.avg.toFixed(1)} / {stats.stepMs.min.toFixed(1)} / {stats.stepMs.max.toFixed(1)} ms
            </dd>
          </div>
          {stats.loadMs > 0 && (
            <div>
              <dt>Chargement modèle</dt>
              <dd>{stats.loadMs.toFixed(0)} ms</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
