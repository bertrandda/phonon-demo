// The voice catalog of `gradium/phonon-voices`: 102 ready-made voices, each a `.safetensors`
// speaker embedding, listed with their language and gender in `voices.jsonl`.

import { readFile } from 'node:fs/promises';
import type { Voice } from '../shared/types.ts';
import { ensureFile, resolveRepo, type RepoInfo } from './hub.ts';
import { HttpError } from './registry.ts';

export const VOICES_REPO = 'gradium/phonon-voices';

interface CatalogEntry {
  filename: string;
  name: string;
  voice_id: string;
  language: string;
  locale: string;
  gender: string;
  age: string;
  description: string;
}

let catalog: Promise<{ info: RepoInfo; entries: CatalogEntry[] }> | null = null;

function loadCatalog() {
  catalog ??= (async () => {
    const info = await resolveRepo(VOICES_REPO);
    const text = await readFile(await ensureFile(info, 'voices.jsonl'), 'utf8');
    const entries = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as CatalogEntry);
    return { info, entries };
  })().catch((e) => {
    catalog = null; // let a later call retry
    throw e;
  });
  return catalog;
}

/**
 * The URL of a sample of the voice, preferably as spoken by a model of `size` (`31m`, `40m`):
 * the catalog has `samples/<size>/<lang>/<locale>/<gender>/<n>_<name>_<id>/*.ogg` per size,
 * and one `samples/<lang>/<locale>/<gender>/<n>_<name>_<id>.ogg` per voice.
 */
function sampleUrl(info: RepoInfo, entry: CatalogEntry, size?: string): string | null {
  const files = [...info.files];
  const bySize = size
    ? files.filter((f) => f.startsWith(`samples/${size}/`) && f.includes(`_${entry.voice_id}/`) && f.endsWith('.ogg'))
    : [];
  const file =
    bySize.find((f) => f.endsWith('/happy_01.ogg')) ??
    bySize[0] ??
    files.find((f) => f.startsWith(`samples/${entry.language}/`) && f.endsWith(`_${entry.voice_id}.ogg`));
  return file ? `https://huggingface.co/${VOICES_REPO}/resolve/${info.sha}/${file}` : null;
}

export async function listVoices({ lang, size }: { lang?: string; size?: string }): Promise<Voice[]> {
  const { info, entries } = await loadCatalog();
  return entries
    .filter((e) => !lang || lang === 'none' || e.language === lang)
    .map((e) => ({
      id: e.voice_id,
      name: e.name,
      language: e.language,
      locale: e.locale,
      gender: e.gender,
      age: e.age,
      description: e.description,
      sampleUrl: sampleUrl(info, e, size),
    }));
}

/** The local path of a catalog voice's embedding, downloading it on first use. */
export async function ensureVoice(voiceId: string): Promise<string> {
  const { info, entries } = await loadCatalog();
  const entry = entries.find((e) => e.voice_id === voiceId);
  if (!entry) throw new HttpError(400, `voix inconnue '${voiceId}'`);
  return ensureFile(info, entry.filename);
}
