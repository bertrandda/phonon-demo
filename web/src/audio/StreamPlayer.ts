/**
 * Plays PCM chunks back to back as they arrive, each scheduled right after the previous one
 * (or now, if playback has caught up with generation).
 */
export class StreamPlayer {
  private ctx: AudioContext | null = null;
  private next = 0;

  /** Call from a user gesture, so the browser lets the context play. */
  start(sampleRate: number) {
    this.stop();
    this.ctx = new AudioContext({ sampleRate });
    this.next = this.ctx.currentTime + 0.05;
  }

  push(pcm: Float32Array) {
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buffer.getChannelData(0).set(pcm);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.next = Math.max(this.next, ctx.currentTime);
    source.start(this.next);
    this.next += buffer.duration;
  }

  /** Seconds of audio scheduled but not played yet. */
  get buffered(): number {
    return this.ctx ? Math.max(0, this.next - this.ctx.currentTime) : 0;
  }

  stop() {
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Mono float PCM as a 16-bit WAV file. */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const s of chunk) {
      view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, s)) * 0x7fff), true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
