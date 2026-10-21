// Types shared by the server and the web front.

export type Lang = 'en' | 'fr' | 'de' | 'es' | 'pt' | 'none';
export type Quant = 'q8' | 'f32';

export interface ModelInfo {
  id: string;
  repo: string;
  label: string;
  size: string;
  /** Languages the checkpoint was trained for. */
  languages: Exclude<Lang, 'none'>[];
  defaultLang: Exclude<Lang, 'none'>;
  license: string;
  gated: boolean;
}

export interface ModelStatus extends ModelInfo {
  /** The q8 weights are on disk. */
  downloaded: boolean;
  /** Number of workers currently holding this model. */
  loaded: number;
  /** Whether the server can download it: public, or gated with a token. */
  accessible: boolean;
}

export interface ModelsResponse {
  hasToken: boolean;
  models: ModelStatus[];
}

export type Conditioner =
  | { name: string; kind: 'enum'; values: string[]; default: string }
  | { name: string; kind: 'number'; min: number; max: number; step: number; default: number };

export interface ModelConfigResponse {
  id: string;
  sha: string;
  languages: string[];
  conditioners: Conditioner[];
  quants: Quant[];
}

export interface Voice {
  /** `default` for the checkpoint's own voice, else the catalog's voice id. */
  id: string;
  name: string;
  language: string | null;
  locale: string | null;
  gender: string | null;
  age: string | null;
  description: string | null;
  sampleUrl: string | null;
}

export interface SynthesisRequest {
  model: string;
  text: string;
  lang?: Lang;
  quant?: Quant;
  rewrites?: string;
  conditions?: Record<string, string | number>;
  voice?: string;
  temperature?: number;
  /** A decimal string, since seeds go past Number.MAX_SAFE_INTEGER. */
  seed?: string;
}

export interface SpeechStats {
  chunks: number;
  tokens: number;
  frames: number;
  samples: number;
  promptMs: number;
  stepMs: { avg: number; min: number; max: number };
  firstAudioMs: number | null;
  totalMs: number;
  /** Time to load the model when this request had to (cold start), else 0. */
  loadMs: number;
  cancelled: boolean;
}

export interface Progress {
  file: string;
  loaded: number;
  total: number | null;
}

/** Messages the client sends on the `/api/tts` WebSocket. */
export type ClientMessage = ({ type: 'synthesize' } & SynthesisRequest) | { type: 'cancel' };

/** JSON messages the server sends on `/api/tts`. PCM chunks go as binary Float32 frames. */
export type ServerMessage =
  | { type: 'progress'; progress: Progress }
  | { type: 'loading' }
  | { type: 'start'; sampleRate: number }
  | { type: 'done'; stats: SpeechStats }
  | { type: 'error'; message: string };

export const DEFAULT_SEED = '4242424242424242';
export const DEFAULT_TEMPERATURE = 0.3;
