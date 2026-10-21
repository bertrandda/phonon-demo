import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lang, ModelConfigResponse, ModelsResponse, SpeechStats, Voice } from '../../shared/types.ts';
import { DEFAULT_SEED, DEFAULT_TEMPERATURE } from '../../shared/types.ts';
import { api, TtsClient } from './api.ts';
import { encodeWav, StreamPlayer } from './audio/StreamPlayer.ts';
import { ConfigPanel, type Settings } from './components/ConfigPanel.tsx';
import { History, type HistoryEntry } from './components/History.tsx';
import { ModelPicker } from './components/ModelPicker.tsx';
import { PlayerPanel, type Status } from './components/PlayerPanel.tsx';
import { SAMPLES, TextInput } from './components/TextInput.tsx';
import { VoicePicker } from './components/VoicePicker.tsx';

const SAMPLE_RATE = 24000;
const tts = new TtsClient();
const player = new StreamPlayer();

function initialSettings(lang: Lang): Settings {
  return { lang, quant: 'q8', rewrites: 'default', conditions: {}, voice: 'default', temperature: DEFAULT_TEMPERATURE, seed: DEFAULT_SEED };
}

export function App() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelId, setModelId] = useState('fr');
  const [config, setConfig] = useState<ModelConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings('fr'));
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesState, setVoicesState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [text, setText] = useState(SAMPLES.fr[0].text);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [peaks, setPeaks] = useState<number[]>([]);
  const [stats, setStats] = useState<SpeechStats | null>(null);
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const chunks = useRef<Float32Array[]>([]);
  const nextHistoryId = useRef(1);

  const refreshModels = useCallback(
    () =>
      api.models().then(
        (m) => {
          setModels(m);
          setModelsError(null);
        },
        (e) => setModelsError(e.message),
      ),
    [],
  );
  useEffect(() => void refreshModels(), [refreshModels]);

  const model = models?.models.find((m) => m.id === modelId) ?? null;
  const textLang = (settings.lang === 'none' ? (model?.defaultLang ?? 'fr') : settings.lang) as Exclude<Lang, 'none'>;

  // The checkpoint's conditioners, which differ per model.
  useEffect(() => {
    if (!model) return;
    setConfig(null);
    setConfigError(null);
    let live = true;
    api.config(model.id).then(
      (c) => {
        if (!live) return;
        setConfig(c);
        setSettings((s) => ({ ...s, conditions: Object.fromEntries(c.conditioners.map((k) => [k.name, k.default])) }));
      },
      (e) => live && setConfigError(e.message),
    );
    return () => {
      live = false;
    };
  }, [model?.id]);

  useEffect(() => {
    if (!model) return;
    setVoicesState({ loading: true, error: null });
    let live = true;
    api.voices(textLang, model.size).then(
      (v) => {
        if (!live) return;
        setVoices(v);
        setVoicesState({ loading: false, error: null });
      },
      (e) => live && setVoicesState({ loading: false, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [model?.id, textLang]);

  const selectModel = (id: string) => {
    const next = models?.models.find((m) => m.id === id);
    if (!next || id === modelId) return;
    setModelId(id);
    setSettings((s) => ({ ...initialSettings(next.defaultLang), temperature: s.temperature, seed: s.seed }));
    if (!next.languages.includes(textLang as never)) setText(SAMPLES[next.defaultLang][0].text);
  };

  const changeSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      // A catalog voice is per language: back to the default one when the language changes.
      if (patch.lang && patch.lang !== s.lang && s.voice !== 'default') next.voice = 'default';
      return next;
    });
  };

  const generate = () => {
    if (!model) return;
    // Started here, in the click, so the browser lets it play.
    player.start(SAMPLE_RATE);
    chunks.current = [];
    setPeaks([]);
    setStats(null);
    if (wavUrl) setWavUrl(null);
    setStatus({ kind: 'connecting' });
    const request = { model: model.id, text, ...settings };
    const voiceName = settings.voice === 'default' ? 'défaut' : (voices.find((v) => v.id === settings.voice)?.name ?? settings.voice);

    tts
      .synthesize(request, {
        onProgress: (p) =>
          setStatus((s) => ({ kind: 'downloading', files: { ...(s.kind === 'downloading' ? s.files : {}), [p.file]: p } })),
        onLoading: () => setStatus({ kind: 'loading' }),
        onStart: () => setStatus({ kind: 'streaming' }),
        onChunk: (pcm) => {
          chunks.current.push(pcm);
          player.push(pcm);
          let peak = 0;
          for (const s of pcm) peak = Math.max(peak, Math.abs(s));
          setPeaks((p) => [...p, peak]);
        },
        onDone: (st) => {
          setStats(st);
          setStatus({ kind: 'done' });
          if (chunks.current.length > 0) {
            const url = URL.createObjectURL(encodeWav(chunks.current, SAMPLE_RATE));
            setWavUrl(url);
            const summary = `${settings.lang} · ${settings.quant} · T=${settings.temperature} · seed ${settings.seed}${
              Object.keys(settings.conditions).length
                ? ' · ' + Object.entries(settings.conditions).map(([k, v]) => `${k}=${v}`).join(' ')
                : ''
            }`;
            setHistory((h) => [{ id: nextHistoryId.current++, url, text, model: model.label, voice: voiceName, summary }, ...h].slice(0, 20));
          }
          void refreshModels();
        },
        onError: (message) => {
          player.stop();
          setStatus({ kind: 'error', message });
          void refreshModels();
        },
      })
      .catch((e) => setStatus({ kind: 'error', message: e.message }));
  };

  const stop = () => {
    tts.cancel();
    player.stop();
  };

  const clearHistory = () => {
    history.forEach((h) => URL.revokeObjectURL(h.url));
    setHistory([]);
    setWavUrl(null);
  };

  const canGenerate = useMemo(() => Boolean(model && text.trim() && /^\d+$/.test(settings.seed)), [model, text, settings.seed]);

  return (
    <div className="app">
      <header>
        <h1>
          Phonon <span>TTS demo</span>
        </h1>
        <p>
          Modèles <a href="https://huggingface.co/gradium" target="_blank" rel="noreferrer">Gradium Phonon</a> exécutés côté
          serveur en Node.js (WebAssembly, CPU) via <code>phonon-tts</code>.
        </p>
      </header>

      {modelsError && <p className="error">Serveur injoignable : {modelsError}</p>}
      {models && <ModelPicker models={models.models} hasToken={models.hasToken} selected={modelId} onSelect={selectModel} />}

      {model && (
        <main className="layout">
          <aside>
            <ConfigPanel model={model} config={config} configError={configError} settings={settings} onChange={changeSettings} />
          </aside>
          <div className="content">
            <TextInput text={text} lang={textLang} onChange={setText} />
            <PlayerPanel
              status={status}
              peaks={peaks}
              stats={stats}
              sampleRate={SAMPLE_RATE}
              canGenerate={canGenerate}
              onGenerate={generate}
              onStop={stop}
              wavUrl={wavUrl}
            />
            <VoicePicker
              voices={voices}
              loading={voicesState.loading}
              error={voicesState.error}
              selected={settings.voice}
              onSelect={(voice) => changeSettings({ voice })}
            />
            <History entries={history} onClear={clearHistory} />
          </div>
        </main>
      )}
      <footer>
        Phonon 40m : licence CC BY-NC 4.0 (usage non commercial) · Phonon 31m et voix : Apache 2.0
      </footer>
    </div>
  );
}
