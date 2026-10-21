import type { ModelInfo } from '../shared/types.ts';

const NC = 'CC BY-NC 4.0';

export const MODELS: ModelInfo[] = [
  { id: 'fr', repo: 'gradium/phonon-40m-fr', label: 'Phonon 40m · Français', size: '40m', languages: ['fr'], defaultLang: 'fr', license: NC, gated: true },
  { id: 'en', repo: 'gradium/phonon-40m-en', label: 'Phonon 40m · English', size: '40m', languages: ['en'], defaultLang: 'en', license: NC, gated: true },
  { id: 'de', repo: 'gradium/phonon-40m-de', label: 'Phonon 40m · Deutsch', size: '40m', languages: ['de'], defaultLang: 'de', license: NC, gated: true },
  { id: 'es', repo: 'gradium/phonon-40m-es', label: 'Phonon 40m · Español', size: '40m', languages: ['es'], defaultLang: 'es', license: NC, gated: true },
  { id: 'pt', repo: 'gradium/phonon-40m-pt', label: 'Phonon 40m · Português', size: '40m', languages: ['pt'], defaultLang: 'pt', license: NC, gated: true },
  {
    id: 'multilingual',
    repo: 'gradium/phonon-40m-multilingual',
    label: 'Phonon 40m · Multilingual',
    size: '40m',
    languages: ['en', 'fr', 'de', 'es', 'pt'],
    defaultLang: 'fr',
    license: NC,
    gated: true,
  },
  { id: '31m-en', repo: 'gradium/phonon-31m-en', label: 'Phonon 31m · English', size: '31m', languages: ['en'], defaultLang: 'en', license: 'Apache 2.0', gated: false },
];

export function findModel(id: string): ModelInfo {
  const model = MODELS.find((m) => m.id === id);
  if (!model) throw new HttpError(404, `unknown model '${id}'; known: ${MODELS.map((m) => m.id).join(', ')}`);
  return model;
}

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
