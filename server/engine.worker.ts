// A worker thread that owns one Phonon model, loaded in the single-threaded wasm build of
// `phonon-tts`. The generation loop is the one of `phonon-tts/worker.js`, with Node's
// `worker_threads` in place of a Web Worker: `pool.ts` starts it and talks to it.

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import * as wasm from 'phonon-tts/raw';
import type { SpeechStats } from '../shared/types.ts';

export type WorkerRequest =
  | {
      type: 'load';
      id: number;
      weights: string;
      tokenizer: string;
      config: string;
      quant: string;
      lang: string;
      rewrites: string;
      conditions: string[];
    }
  | { type: 'generate'; id: number; text: string; voicePath: string; temperature: number; seed: string }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'result'; id: number; value: unknown }
  | { type: 'error'; id: number; message: string }
  | { type: 'chunk'; id: number; pcm: Float32Array };

export interface LoadResult {
  sampleRate: number;
  frameSize: number;
  languages: string[];
  features: Record<string, boolean>;
  loadMs: number;
}

const port = parentPort!;
const post = (message: WorkerResponse, transfer: ArrayBuffer[] = []) => port.postMessage(message, transfer);

/**
 * The Relaxed SIMD build is faster; a CPU or runtime without Relaxed SIMD gets the plain SIMD
 * one, as `phonon-tts` picks between them in the browser.
 */
function initWasm(): Record<string, boolean> {
  const read = (file: string) => readFileSync(new URL(import.meta.resolve(`phonon-tts/wasm/${file}`)));
  let module: WebAssembly.Module;
  try {
    module = new WebAssembly.Module(read('phonon_tts_bg.wasm'));
  } catch (e) {
    if (!(e instanceof WebAssembly.CompileError)) throw e;
    module = new WebAssembly.Module(read('phonon_tts_simd_bg.wasm'));
  }
  wasm.initSync({ module });
  return wasm.cpu_features() as Record<string, boolean>;
}

const features = initWasm();
let model: wasm.Model | null = null;
let frameSize = 0;
/** Voice file -> index in `model`. */
const voices = new Map<string, number>();
const cancelled = new Set<number>();

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

async function handleLoad(req: Extract<WorkerRequest, { type: 'load' }>): Promise<LoadResult> {
  const t0 = performance.now();
  const [weights, tokenizer, config] = await Promise.all([req.weights, req.tokenizer, req.config].map((p) => readFile(p)));
  model = await wasm.Model.load(weights, tokenizer, config, req.quant, req.lang, req.rewrites, req.conditions, 'cpu');
  frameSize = model.frame_size();
  return {
    sampleRate: model.sample_rate(),
    frameSize,
    languages: model.languages(),
    features,
    loadMs: performance.now() - t0,
  };
}

async function voiceIndex(path: string): Promise<number> {
  let index = voices.get(path);
  if (index === undefined) {
    index = model!.add_voice(await readFile(path));
    await model!.flush();
    voices.set(path, index);
  }
  return index;
}

async function handleGenerate(req: Extract<WorkerRequest, { type: 'generate' }>): Promise<Omit<SpeechStats, 'loadMs'>> {
  if (!model) throw new Error('model not loaded');
  const { id } = req;
  const index = await voiceIndex(req.voicePath);
  const t0 = performance.now();
  const chunks = model.start_generation(index, req.text, req.temperature, BigInt(req.seed));

  const stats = {
    chunks,
    tokens: 0,
    frames: 0,
    samples: 0,
    promptMs: 0,
    stepMs: { avg: 0, min: 0, max: 0 },
    firstAudioMs: null as number | null,
    totalMs: 0,
    cancelled: false,
  };
  let stepMsTotal = 0;
  let stepMsMin = Infinity;
  try {
    outer: for (;;) {
      if (cancelled.has(id)) {
        stats.cancelled = true;
        break;
      }
      const p0 = performance.now();
      const tokens = model.next_chunk();
      if (tokens === undefined) break;
      stats.tokens += tokens;
      stats.promptMs += performance.now() - p0;

      for (;;) {
        if (cancelled.has(id)) {
          stats.cancelled = true;
          break outer;
        }
        const s0 = performance.now();
        const pcm: Float32Array | undefined = await model.generation_step();
        if (pcm === undefined) break;
        const frames = Math.max(1, Math.round(pcm.length / frameSize));
        const dt = (performance.now() - s0) / frames;
        stepMsTotal += dt * frames;
        stepMsMin = Math.min(stepMsMin, dt);
        stats.stepMs.max = Math.max(stats.stepMs.max, dt);
        stats.frames += frames;
        stats.samples += pcm.length;
        stats.firstAudioMs ??= performance.now() - t0;
        post({ type: 'chunk', id, pcm }, [pcm.buffer as ArrayBuffer]);
        // Lets a `cancel` message land between frames.
        await yieldToEventLoop();
      }
    }
  } finally {
    try {
      model.stop_generation();
    } catch {
      // After a wasm trap every call on `model` throws; keep the original error.
    }
    cancelled.delete(id);
  }
  if (stats.frames > 0) {
    stats.stepMs.avg = stepMsTotal / stats.frames;
    stats.stepMs.min = stepMsMin;
  }
  stats.totalMs = performance.now() - t0;
  return stats;
}

port.on('message', async (req: WorkerRequest) => {
  if (req.type === 'cancel') {
    cancelled.add(req.id);
    return;
  }
  try {
    const value = req.type === 'load' ? await handleLoad(req) : await handleGenerate(req);
    post({ type: 'result', id: req.id, value });
  } catch (e) {
    post({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
});
