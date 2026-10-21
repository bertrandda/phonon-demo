# Phonon demo

A demo of [Gradium's Phonon](https://huggingface.co/gradium) text-to-speech models. Inference runs **server-side in Node.js** (WebAssembly, CPU). A React front end lets you pick the model, the generation settings and the voice, then listen to the audio as it streams.

| Model | Repo | License |
|---|---|---|
| French (default) | `gradium/phonon-40m-fr` | CC BY-NC 4.0, gated |
| English / German / Spanish / Portuguese | `gradium/phonon-40m-{en,de,es,pt}` | CC BY-NC 4.0, gated |
| Multilingual | `gradium/phonon-40m-multilingual` | CC BY-NC 4.0, gated |
| English 31m | `gradium/phonon-31m-en` | Apache 2.0, public |
| Voices (102, en/fr/de/es/pt) | `gradium/phonon-voices` | Apache 2.0 |

## Getting started

Requires Node ≥ 22.18, which runs `.ts` files directly.

```bash
npm install
cp .env.example .env     # then set HF_TOKEN
```

Then, in two terminals:

```bash
npm run dev:server       # terminal 1: API + inference on :3000, restarts on changes to server/ or shared/
npm run dev:web          # terminal 2: Vite front end (HMR) on http://localhost:5173, proxies /api → :3000
```

For production:

```bash
npm run build && npm start   # everything served on http://127.0.0.1:3000
```

### Access to the 40m models

The 40m models are gated on Hugging Face:

1. Open each model page (fr, en, de, es, pt, multilingual) and accept the terms.
2. Create a **read** token at https://huggingface.co/settings/tokens.
3. Put it in `.env` (`HF_TOKEN=hf_…`), then restart the server.

Without a token, only `phonon-31m-en` works. The other models return an error explaining these steps.

Files are downloaded on first use into `MODELS_DIR` (`.models/` by default), with a progress bar in the UI.

## How it works

- `phonon-tts` is a browser library. The server only uses its WASM core (`phonon-tts/raw`), loaded with `initSync` inside a `worker_threads` worker. The generation loop follows the one in `phonon-tts/worker.js`.
- There is **one worker per load configuration**: model, `q8`/`f32`, normalization language, rewrites and conditioners, since these are fixed when the checkpoint is loaded. At most `MAX_LOADED_MODELS` workers stay in memory; past that, the least recently used one is stopped (LRU).
- Voice, temperature and seed can change on every request.
- Audio is streamed as Float32 PCM, in 80 ms frames at 24 kHz, over the `/api/tts` WebSocket. The browser plays it as it arrives and can export it as WAV.

## API

| Route | |
|---|---|
| `GET /api/models` | models, their status (downloaded, loaded, accessible), whether a token is set |
| `GET /api/models/:id/config` | languages, conditioners (`num_speakers`, `duration_delta`…), available quantizations |
| `GET /api/voices?lang=fr&size=40m` | catalog voices, each with an `.ogg` sample |
| `WS /api/tts` | `{type:'synthesize', model, text, lang, quant, rewrites, conditions, voice, temperature, seed}` / `{type:'cancel'}` |
| `POST /api/synthesize` | same fields as JSON → `audio/wav` (stats in the `x-phonon-stats` header) |

```bash
curl -X POST localhost:3000/api/synthesize -H 'content-type: application/json' \
  -d '{"model":"31m-en","text":"Hello from Node.","voice":"NbpkqMVS3CJeq2j8"}' -o hello.wav
```
