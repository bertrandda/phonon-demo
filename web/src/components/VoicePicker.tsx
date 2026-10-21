import { useMemo, useRef, useState } from 'react';
import type { Voice } from '../../../shared/types.ts';

interface Props {
  voices: Voice[];
  loading: boolean;
  error: string | null;
  selected: string;
  onSelect: (id: string) => void;
}

export function VoicePicker({ voices, loading, error, selected, onSelect }: Props) {
  const [gender, setGender] = useState('');
  const [locale, setLocale] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const locales = useMemo(() => [...new Set(voices.map((v) => v.locale).filter(Boolean))] as string[], [voices]);
  const shown = voices.filter((v) => (!gender || v.gender === gender) && (!locale || v.locale === locale));

  const preview = (voice: Voice) => {
    audio.current?.pause();
    if (playing === voice.id || !voice.sampleUrl) return setPlaying(null);
    const el = new Audio(voice.sampleUrl);
    el.onended = () => setPlaying(null);
    void el.play();
    audio.current = el;
    setPlaying(voice.id);
  };

  return (
    <section className="panel">
      <h2>
        Voix <small className="count">{voices.length + 1}</small>
      </h2>
      <div className="row filters">
        <select value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Tous genres</option>
          <option value="female">Féminin</option>
          <option value="male">Masculin</option>
        </select>
        {locales.length > 1 && (
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="">Toutes locales</option>
            {locales.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <ul className="voice-list">
        <li className={selected === 'default' ? 'selected' : ''} onClick={() => onSelect('default')}>
          <div className="voice-main">
            <b>Voix par défaut</b>
            <span className="meta">celle du checkpoint</span>
          </div>
        </li>
        {loading && <li className="meta">Chargement du catalogue…</li>}
        {shown.map((v) => (
          <li key={v.id} className={selected === v.id ? 'selected' : ''} onClick={() => onSelect(v.id)} title={v.description ?? ''}>
            <div className="voice-main">
              <b>{v.name}</b>
              <span className="meta">
                {v.gender === 'female' ? '♀' : v.gender === 'male' ? '♂' : '·'} {v.locale} · {v.age}
              </span>
            </div>
            {v.sampleUrl && (
              <button
                className="icon"
                title="Écouter un exemple"
                onClick={(e) => {
                  e.stopPropagation();
                  preview(v);
                }}
              >
                {playing === v.id ? '■' : '▶'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
