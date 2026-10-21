import type { Lang, ModelConfigResponse, ModelStatus, Quant } from '../../../shared/types.ts';
import { DEFAULT_SEED, DEFAULT_TEMPERATURE } from '../../../shared/types.ts';

export interface Settings {
  lang: Lang;
  quant: Quant;
  rewrites: string;
  conditions: Record<string, string | number>;
  voice: string;
  temperature: number;
  seed: string;
}

const LANG_NAMES: Record<Lang, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  none: 'Aucune (texte brut)',
};

const REWRITES = [
  { value: 'default', label: 'default : nombres, devises, e-mails, URLs, abréviations' },
  { value: 'all', label: 'all : + téléphones, heures, dates' },
  { value: 'none', label: 'none : normalisation de base seulement' },
];
/** The rules the engine knows, as its error for an unknown one lists them. */
const RULES = ['numbers', 'currency', 'dashed-digits', 'emails', 'urls', 'abbreviations', 'elongations', 'phones', 'times', 'dates'];

interface Props {
  model: ModelStatus;
  config: ModelConfigResponse | null;
  configError: string | null;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

export function ConfigPanel({ model, config, configError, settings, onChange }: Props) {
  const langs: Lang[] = [...model.languages, 'none'];
  const customRewrites = !REWRITES.some((r) => r.value === settings.rewrites);
  const randomSeed = () => {
    const words = crypto.getRandomValues(new Uint32Array(2));
    onChange({ seed: ((BigInt(words[0]) << 32n) | BigInt(words[1])).toString() });
  };

  return (
    <section className="panel">
      <h2>Configuration</h2>
      <p className="hint">
        Les réglages marqués <span className="tag">chargement</span> sont fixés au chargement du modèle : en changer
        charge une nouvelle instance côté serveur.
      </p>

      <label className="field">
        <span>
          Langue de normalisation <span className="tag">chargement</span>
        </span>
        <select value={settings.lang} onChange={(e) => onChange({ lang: e.target.value as Lang })}>
          {langs.map((l) => (
            <option key={l} value={l}>
              {LANG_NAMES[l]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>
          Poids <span className="tag">chargement</span>
        </span>
        <div className="segmented">
          {(config?.quants ?? ['q8', 'f32']).map((q) => (
            <button key={q} className={settings.quant === q ? 'active' : ''} onClick={() => onChange({ quant: q })}>
              {q === 'q8' ? 'q8 · rapide' : 'f32 · pleine précision'}
            </button>
          ))}
        </div>
      </label>

      <label className="field">
        <span>
          Réécritures <span className="tag">chargement</span>
        </span>
        <select
          value={customRewrites ? 'custom' : settings.rewrites}
          onChange={(e) => onChange({ rewrites: e.target.value === 'custom' ? 'numbers,currency' : e.target.value })}
        >
          {REWRITES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
          <option value="custom">liste personnalisée…</option>
        </select>
        {customRewrites && (
          <div className="chips">
            {RULES.map((rule) => {
              const active = settings.rewrites.split(',').includes(rule);
              const toggle = () => {
                const rules = RULES.filter((r) => (r === rule ? !active : settings.rewrites.split(',').includes(r)));
                // An empty list would read as `none` only once spelled out.
                onChange({ rewrites: rules.length ? rules.join(',') : 'none' });
              };
              return (
                <button key={rule} className={`chip${active ? ' active' : ''}`} onClick={toggle}>
                  {rule}
                </button>
              );
            })}
          </div>
        )}
      </label>

      {configError && <p className="error">{configError}</p>}
      {config?.conditioners.map((c) => (
        <label className="field" key={c.name}>
          <span>
            {c.name} <span className="tag">chargement</span>
            {c.kind === 'number' && <output>{Number(settings.conditions[c.name] ?? c.default).toFixed(2)}</output>}
          </span>
          {c.kind === 'enum' ? (
            <select
              value={String(settings.conditions[c.name] ?? c.default)}
              onChange={(e) => onChange({ conditions: { ...settings.conditions, [c.name]: e.target.value } })}
            >
              {c.values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="range"
              min={c.min}
              max={c.max}
              step={c.step}
              value={Number(settings.conditions[c.name] ?? c.default)}
              onChange={(e) => onChange({ conditions: { ...settings.conditions, [c.name]: Number(e.target.value) } })}
            />
          )}
          {c.name === 'duration_delta' && <small>Négatif : débit plus rapide · positif : plus lent.</small>}
        </label>
      ))}

      <label className="field">
        <span>
          Température <output>{settings.temperature.toFixed(2)}</output>
        </span>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={settings.temperature}
          onChange={(e) => onChange({ temperature: Number(e.target.value) })}
        />
        <small>
          Défaut {DEFAULT_TEMPERATURE}. Plus haut : plus expressif et variable. 0 : déterministe.
        </small>
      </label>

      <label className="field">
        <span>Seed</span>
        <div className="row">
          <input
            type="text"
            inputMode="numeric"
            value={settings.seed}
            onChange={(e) => onChange({ seed: e.target.value.replace(/\D/g, '') })}
          />
          <button className="icon" onClick={randomSeed} title="Seed aléatoire">
            🎲
          </button>
          <button className="icon" onClick={() => onChange({ seed: DEFAULT_SEED })} title="Seed par défaut">
            ↺
          </button>
        </div>
        <small>Même texte, voix, température et seed : même audio.</small>
      </label>
    </section>
  );
}
