import type { Lang } from '../../../shared/types.ts';

export const SAMPLES: Record<Exclude<Lang, 'none'>, { label: string; text: string }[]> = {
  fr: [
    { label: 'Accueil', text: "Bonjour et bienvenue ! Je suis une voix de synthèse qui tourne entièrement sur ce serveur, sans carte graphique." },
    {
      label: 'Normalisation',
      text: 'Votre rendez-vous est confirmé le 21/10/2026 à 14h30, au 12 rue de la Paix. Le total s\'élève à 1 299,99 €. Une question ? Écrivez à contact@exemple.fr ou appelez le 01 23 45 67 89.',
    },
    {
      label: 'Récit',
      text: "Il était une fois, au bord d'un lac immobile, un vieux phare qui ne s'allumait plus. Chaque soir, les pêcheurs levaient les yeux vers lui, par habitude. Puis un matin d'automne, une petite lumière se mit à clignoter, timide d'abord, puis de plus en plus fort.",
    },
  ],
  en: [
    { label: 'Welcome', text: 'Hello and welcome! I am a synthetic voice running entirely on this server, with no GPU.' },
    {
      label: 'Normalization',
      text: 'Your appointment is confirmed for 10/21/2026 at 2:30 PM, at 221B Baker Street. The total is $1,299.99. Questions? Email help@example.com or call 555-0134.',
    },
  ],
  de: [
    { label: 'Willkommen', text: 'Hallo und herzlich willkommen! Ich bin eine synthetische Stimme, die komplett auf diesem Server läuft.' },
    {
      label: 'Normalisierung',
      text: 'Ihr Termin ist am 21.10.2026 um 14:30 Uhr bestätigt. Der Gesamtbetrag beträgt 1.299,99 €. Fragen? Schreiben Sie an info@beispiel.de.',
    },
  ],
  es: [
    { label: 'Bienvenida', text: '¡Hola y bienvenidos! Soy una voz sintética que funciona por completo en este servidor.' },
    {
      label: 'Normalización',
      text: 'Su cita está confirmada para el 21/10/2026 a las 14:30. El total es de 1.299,99 €. ¿Preguntas? Escriba a ayuda@ejemplo.es.',
    },
  ],
  pt: [
    { label: 'Boas-vindas', text: 'Olá e bem-vindos! Eu sou uma voz sintética que roda inteiramente neste servidor.' },
    {
      label: 'Normalização',
      text: 'Sua consulta está confirmada para 21/10/2026 às 14h30. O total é de R$ 1.299,99. Dúvidas? Escreva para contato@exemplo.com.br.',
    },
  ],
};

interface Props {
  text: string;
  lang: Exclude<Lang, 'none'>;
  onChange: (text: string) => void;
}

export function TextInput({ text, lang, onChange }: Props) {
  return (
    <section className="panel">
      <h2>Texte</h2>
      <div className="chips">
        {SAMPLES[lang].map((s) => (
          <button key={s.label} className="chip" onClick={() => onChange(s.text)}>
            {s.label}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => onChange(e.target.value)} rows={6} maxLength={5000} />
      <small className="meta">{text.length} / 5000</small>
    </section>
  );
}
