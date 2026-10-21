import type { ModelStatus } from '../../../shared/types.ts';

const FLAGS: Record<string, string> = { fr: '🇫🇷', en: '🇬🇧', de: '🇩🇪', es: '🇪🇸', pt: '🇧🇷', multilingual: '🌍', '31m-en': '🇺🇸' };

interface Props {
  models: ModelStatus[];
  hasToken: boolean;
  selected: string;
  onSelect: (id: string) => void;
}

export function ModelPicker({ models, hasToken, selected, onSelect }: Props) {
  return (
    <section className="panel">
      <h2>Modèle</h2>
      {!hasToken && (
        <p className="notice">
          Les modèles <b>40m</b> sont à accès restreint. Accepte leurs conditions sur Hugging Face (
          {models
            .filter((m) => m.gated)
            .map((m, i) => (
              <span key={m.id}>
                {i > 0 && ', '}
                <a href={`https://huggingface.co/${m.repo}`} target="_blank" rel="noreferrer">
                  {m.id}
                </a>
              </span>
            ))}
          ), puis renseigne <code>HF_TOKEN</code> dans <code>.env</code> et relance le serveur. En attendant, <b>31m · English</b> fonctionne sans token.
        </p>
      )}
      <div className="model-grid">
        {models.map((m) => (
          <button
            key={m.id}
            className={`model-card${m.id === selected ? ' selected' : ''}${m.accessible ? '' : ' locked'}`}
            onClick={() => onSelect(m.id)}
            title={m.repo}
          >
            <span className="flag">{FLAGS[m.id] ?? '🔊'}</span>
            <span className="model-label">{m.label}</span>
            <span className="badges">
              <span className={`badge ${m.license.includes('NC') ? 'nc' : 'open'}`}>{m.license}</span>
              {m.loaded > 0 ? (
                <span className="badge ok">en mémoire</span>
              ) : m.downloaded ? (
                <span className="badge ok">téléchargé</span>
              ) : !m.accessible ? (
                <span className="badge warn">🔒 token requis</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
