import { env } from './env.ts';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { ClientMessage, ModelsResponse, ServerMessage, SynthesisRequest } from '../shared/types.ts';
import { getModelConfig } from './hub.ts';
import { isDownloaded, pool } from './pool.ts';
import { findModel, MODELS } from './registry.ts';
import { listVoices } from './voices.ts';
import { encodeWav } from './wav.ts';

const app = Fastify({ logger: { level: env.production ? 'info' : 'warn' } });
await app.register(fastifyWebsocket);

app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
  const status = error.statusCode ?? 500;
  if (status >= 500) app.log.error(error);
  reply.code(status).send({ error: error.message });
});

app.get('/api/models', async (): Promise<ModelsResponse> => ({
  hasToken: env.hfToken !== null,
  models: await Promise.all(
    MODELS.map(async (m) => ({
      ...m,
      downloaded: await isDownloaded(m),
      loaded: pool.loadedCount(m.id),
      accessible: !m.gated || env.hfToken !== null,
    })),
  ),
}));

app.get<{ Params: { id: string } }>('/api/models/:id/config', async (req) => getModelConfig(findModel(req.params.id)));

app.get<{ Querystring: { lang?: string; size?: string } }>('/api/voices', async (req) =>
  listVoices({ lang: req.query.lang, size: req.query.size }),
);

app.post<{ Body: SynthesisRequest }>('/api/synthesize', async (req, reply) => {
  const controller = new AbortController();
  // The client went away before the audio was sent.
  reply.raw.on('close', () => reply.raw.writableFinished || controller.abort());
  const chunks: Float32Array[] = [];
  let sampleRate = 24000;
  const stats = await pool.synthesize(req.body, {
    onStart: (rate) => (sampleRate = rate),
    onChunk: (pcm) => chunks.push(pcm),
    signal: controller.signal,
  });
  reply
    .header('content-type', 'audio/wav')
    .header('x-phonon-stats', JSON.stringify(stats))
    .header('content-disposition', `inline; filename="phonon-${req.body.model}.wav"`);
  return encodeWav(chunks, sampleRate);
});

app.get('/api/tts', { websocket: true }, (socket) => {
  let current: AbortController | null = null;
  const send = (msg: ServerMessage) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(msg));

  socket.on('message', async (data, isBinary) => {
    if (isBinary) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return send({ type: 'error', message: 'message JSON invalide' });
    }
    current?.abort();
    current = null;
    if (msg.type !== 'synthesize') return;

    const controller = new AbortController();
    current = controller;
    const { type: _, ...request } = msg;
    try {
      const stats = await pool.synthesize(request, {
        onProgress: (progress) => send({ type: 'progress', progress }),
        onLoading: () => send({ type: 'loading' }),
        onStart: (sampleRate) => send({ type: 'start', sampleRate }),
        onChunk: (pcm) => {
          if (!controller.signal.aborted && socket.readyState === socket.OPEN) {
            socket.send(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
          }
        },
        signal: controller.signal,
      });
      send({ type: 'done', stats });
    } catch (e) {
      if (!controller.signal.aborted) send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (current === controller) current = null;
    }
  });
  socket.on('close', () => current?.abort());
});

const dist = fileURLToPath(new URL('../web/dist', import.meta.url));
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    pool.close();
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: env.port, host: env.host });
console.log(`Phonon demo : http://${env.host}:${env.port}  (HF_TOKEN ${env.hfToken ? 'défini' : 'absent'}, modèles dans ${env.modelsDir})`);

