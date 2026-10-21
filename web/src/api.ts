import type {
  ClientMessage,
  ModelConfigResponse,
  ModelsResponse,
  Progress,
  ServerMessage,
  SpeechStats,
  SynthesisRequest,
  Voice,
} from '../../shared/types.ts';

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body as T;
}

export const api = {
  models: () => getJson<ModelsResponse>('/api/models'),
  config: (id: string) => getJson<ModelConfigResponse>(`/api/models/${encodeURIComponent(id)}/config`),
  voices: (lang: string, size: string) =>
    getJson<Voice[]>(`/api/voices?${new URLSearchParams({ lang, size })}`),
};

export interface SynthesisHandlers {
  onProgress: (p: Progress) => void;
  onLoading: () => void;
  onStart: (sampleRate: number) => void;
  onChunk: (pcm: Float32Array) => void;
  onDone: (stats: SpeechStats) => void;
  onError: (message: string) => void;
}

/**
 * The `/api/tts` WebSocket. One synthesis at a time: starting one, or cancelling, ends the
 * one in progress.
 */
export class TtsClient {
  private socket: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private handlers: SynthesisHandlers | null = null;

  private connect(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    this.opening ??= new Promise((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/tts`;
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        this.socket = socket;
        this.opening = null;
        resolve(socket);
      };
      socket.onerror = () => {
        this.opening = null;
        reject(new Error('connexion WebSocket impossible'));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        this.handlers?.onError('connexion au serveur perdue');
        this.handlers = null;
      };
      socket.onmessage = (event) => this.receive(event.data);
    });
    return this.opening;
  }

  private receive(data: ArrayBuffer | string) {
    const h = this.handlers;
    if (!h) return;
    if (typeof data !== 'string') return h.onChunk(new Float32Array(data));
    const msg = JSON.parse(data) as ServerMessage;
    if (msg.type === 'progress') h.onProgress(msg.progress);
    else if (msg.type === 'loading') h.onLoading();
    else if (msg.type === 'start') h.onStart(msg.sampleRate);
    else if (msg.type === 'done') {
      this.handlers = null;
      h.onDone(msg.stats);
    } else if (msg.type === 'error') {
      this.handlers = null;
      h.onError(msg.message);
    }
  }

  async synthesize(request: SynthesisRequest, handlers: SynthesisHandlers) {
    const socket = await this.connect();
    this.handlers = handlers;
    socket.send(JSON.stringify({ type: 'synthesize', ...request } satisfies ClientMessage));
  }

  /** Stops the synthesis in progress. Its `onDone` still comes, with `stats.cancelled`. */
  cancel() {
    this.socket?.send(JSON.stringify({ type: 'cancel' } satisfies ClientMessage));
  }
}
