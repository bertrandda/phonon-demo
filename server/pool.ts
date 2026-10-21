// The loaded models: one worker thread per load configuration (model, quant, normalization
// language, rewrites, conditioners), since those are fixed when a checkpoint is loaded. The
// least recently used idle worker is stopped past `MAX_LOADED_MODELS`, which is the only way
// to give its wasm memory back. Requests on a worker run one at a time, in order.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Lang, ModelInfo, Progress, Quant, SpeechStats, SynthesisRequest } from '../shared/types.ts';
import { DEFAULT_SEED, DEFAULT_TEMPERATURE } from '../shared/types.ts';
import type { LoadResult, WorkerRequest, WorkerResponse } from './engine.worker.ts';
import { env } from './env.ts';
import { DEFAULT_VOICE_FILE, ensureFile, exists, resolveRepo, WEIGHTS } from './hub.ts';
import { findModel, HttpError } from './registry.ts';
import { ensureVoice } from './voices.ts';

const LANGS: Lang[] = ['en', 'fr', 'de', 'es', 'pt', 'none'];
const MAX_TEXT_LENGTH = 5000;

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onChunk?: (pcm: Float32Array) => void;
}

class Engine {
  readonly key: string;
  readonly modelId: string;
  readonly worker: Worker;
  readonly ready: Promise<LoadResult>;
  lastUsed = Date.now();
  busy = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: Promise<unknown>;
  private onExit: () => void;

  constructor(key: string, modelId: string, load: Omit<Extract<WorkerRequest, { type: 'load' }>, 'id' | 'type'>, onExit: () => void) {
    this.key = key;
    this.modelId = modelId;
    this.onExit = onExit;
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url));
    this.worker.on('message', (msg: WorkerResponse) => this.receive(msg));
    this.worker.on('error', (e) => this.fail(e instanceof Error ? e : new Error(String(e))));
    this.worker.on('exit', (code) => this.fail(new Error(`le moteur s'est arrêté (code ${code})`)));
    this.ready = this.call({ type: 'load', ...load });
    this.queue = this.ready;
  }

  private call<T>(req: Omit<Exclude<WorkerRequest, { type: 'cancel' }>, 'id'>, onChunk?: Pending['onChunk']): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onChunk });
      this.worker.postMessage({ ...req, id });
    });
  }

  private receive(msg: WorkerResponse) {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    if (msg.type === 'chunk') pending.onChunk?.(msg.pcm);
    else {
      this.pending.delete(msg.id);
      if (msg.type === 'result') pending.resolve(msg.value);
      else pending.reject(new Error(msg.message));
    }
  }

  private fail(error: Error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    this.onExit();
  }

  /** Queued behind the requests already made on this engine. Aborting stops it, queued or running. */
  generate(
    req: { text: string; voicePath: string; temperature: number; seed: string },
    onChunk: (pcm: Float32Array) => void,
    signal?: AbortSignal,
  ): Promise<Omit<SpeechStats, 'loadMs'>> {
    this.busy++;
    const run = async () => {
      signal?.throwIfAborted();
      const id = this.nextId; // the id `call` is about to use
      const abort = () => this.worker.postMessage({ type: 'cancel', id } satisfies WorkerRequest);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        return await this.call<Omit<SpeechStats, 'loadMs'>>({ type: 'generate', ...req }, onChunk);
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result.finally(() => {
      this.busy--;
      this.lastUsed = Date.now();
    });
  }

  terminate() {
    void this.worker.terminate();
  }
}

export interface SynthesisHandlers {
  onProgress?: (p: Progress) => void;
  /** The model is being loaded into a new worker. */
  onLoading?: () => void;
  onStart?: (sampleRate: number) => void;
  onChunk: (pcm: Float32Array) => void;
  signal?: AbortSignal;
}

interface Normalized {
  model: ModelInfo;
  text: string;
  lang: Lang;
  quant: Quant;
  rewrites: string;
  conditions: string[];
  voice: string;
  temperature: number;
  seed: string;
}

function normalize(req: SynthesisRequest): Normalized {
  const model = findModel(req.model);
  const text = (req.text ?? '').trim();
  if (!text) throw new HttpError(400, 'le texte est vide');
  if (text.length > MAX_TEXT_LENGTH) throw new HttpError(400, `le texte dépasse ${MAX_TEXT_LENGTH} caractères`);
  const lang = req.lang ?? model.defaultLang;
  if (!LANGS.includes(lang)) throw new HttpError(400, `langue inconnue '${lang}'`);
  const quant = req.quant ?? 'q8';
  if (!(quant in WEIGHTS)) throw new HttpError(400, `quantization inconnue '${quant}'`);
  const temperature = req.temperature ?? DEFAULT_TEMPERATURE;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new HttpError(400, 'température hors de [0, 2]');
  const seed = String(req.seed ?? DEFAULT_SEED).trim();
  if (!/^\d{1,20}$/.test(seed) || BigInt(seed) >= 2n ** 64n) throw new HttpError(400, 'seed : entier entre 0 et 2^64-1');
  const conditions = Object.entries(req.conditions ?? {})
    .map(([name, value]) => {
      if (!/^\w+$/.test(name)) throw new HttpError(400, `conditioner invalide '${name}'`);
      return `${name}=${value}`;
    })
    .sort();
  return {
    model,
    text,
    lang,
    quant,
    rewrites: (req.rewrites ?? 'default').trim() || 'default',
    conditions,
    voice: req.voice?.trim() || 'default',
    temperature,
    seed,
  };
}

class ModelPool {
  private engines = new Map<string, Promise<Engine>>();
  private live = new Map<string, Engine>();

  private evict() {
    const idle = [...this.live.values()].filter((e) => e.busy === 0).sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.live.size >= env.maxLoadedModels && idle.length > 0) {
      const engine = idle.shift()!;
      this.live.delete(engine.key);
      this.engines.delete(engine.key);
      engine.terminate();
    }
  }

  private async engineFor(n: Normalized, handlers: SynthesisHandlers): Promise<{ engine: Engine; loadMs: number }> {
    const key = [n.model.id, n.quant, n.lang, n.rewrites, ...n.conditions].join('|');
    let entry = this.engines.get(key);
    let loadMs = 0;
    if (!entry) {
      entry = (async () => {
        const info = await resolveRepo(n.model.repo);
        const [weights, tokenizer, config] = await Promise.all([
          ensureFile(info, WEIGHTS[n.quant], handlers.onProgress),
          ensureFile(info, 'tokenizer.json', handlers.onProgress),
          ensureFile(info, 'config.json', handlers.onProgress),
        ]);
        handlers.onLoading?.();
        this.evict();
        const engine = new Engine(
          key,
          n.model.id,
          { weights, tokenizer, config, quant: n.quant, lang: n.lang, rewrites: n.rewrites, conditions: n.conditions },
          () => {
            if (this.live.get(key) === engine) this.live.delete(key);
            if (this.engines.get(key) === entry) this.engines.delete(key);
          },
        );
        this.live.set(key, engine);
        loadMs = (await engine.ready).loadMs;
        return engine;
      })();
      this.engines.set(key, entry);
      entry.catch(() => {
        if (this.engines.get(key) === entry) this.engines.delete(key);
      });
    }
    return { engine: await entry, loadMs };
  }

  async synthesize(req: SynthesisRequest, handlers: SynthesisHandlers): Promise<SpeechStats> {
    const n = normalize(req);
    const voicePath =
      n.voice === 'default'
        ? ensureFile(await resolveRepo(n.model.repo), DEFAULT_VOICE_FILE, handlers.onProgress)
        : ensureVoice(n.voice);
    voicePath.catch(() => {}); // awaited below, after the model; keeps an early failure from going unhandled
    const { engine, loadMs } = await this.engineFor(n, handlers);
    handlers.signal?.throwIfAborted();
    const { sampleRate } = await engine.ready;
    handlers.onStart?.(sampleRate);
    const stats = await engine.generate(
      { text: n.text, voicePath: await voicePath, temperature: n.temperature, seed: n.seed },
      handlers.onChunk,
      handlers.signal,
    );
    return { ...stats, loadMs };
  }

  loadedCount(modelId: string): number {
    return [...this.live.values()].filter((e) => e.modelId === modelId).length;
  }

  close() {
    for (const engine of this.live.values()) engine.terminate();
  }
}

export const pool = new ModelPool();

/** Whether the q8 weights of `model` are on disk, at any commit. */
export async function isDownloaded(model: ModelInfo): Promise<boolean> {
  const dir = join(env.modelsDir, model.repo);
  const shas = await readdir(dir).catch(() => [] as string[]);
  for (const sha of shas) if (await exists(join(dir, sha, WEIGHTS.q8))) return true;
  return false;
}
