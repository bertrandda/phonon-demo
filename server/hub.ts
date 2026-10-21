// Hugging Face Hub access for the server: resolves a repo to a commit, downloads its files to
// disk with the token from `.env`, and reads a checkpoint's config. The file picking follows
// `phonon-tts/hub.js`, which follows the native frontends.

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Conditioner, ModelConfigResponse, ModelInfo, Progress, Quant } from '../shared/types.ts';
import { env } from './env.ts';
import { HttpError } from './registry.ts';

const HUB = 'https://huggingface.co';
/** How long a branch keeps resolving to the commit it was last seen at. */
const RESOLVE_TTL_MS = 10 * 60 * 1000;

export const WEIGHTS: Record<Quant, string> = { q8: 'model.q8.gguf', f32: 'model.safetensors' };
export const DEFAULT_VOICE_FILE = 'default-voice.safetensors';

export interface RepoInfo {
  repo: string;
  sha: string;
  gated: boolean;
  files: Set<string>;
}

const resolved = new Map<string, { info: RepoInfo; at: number }>();
const downloads = new Map<string, { promise: Promise<string>; listeners: Set<(p: Progress) => void> }>();

function authHeaders(): Record<string, string> {
  return env.hfToken ? { authorization: `Bearer ${env.hfToken}` } : {};
}

function gatedMessage(repo: string): string {
  const page = `${HUB}/${repo}`;
  return env.hfToken
    ? `Accès refusé à ${repo} : accepte les conditions d'utilisation sur ${page} avec le compte du HF_TOKEN.`
    : `${repo} est un modèle à accès restreint : accepte ses conditions sur ${page}, puis définis HF_TOKEN dans .env et relance le serveur.`;
}

/** The commit `revision` of `repo` points at, and its files. Falls back to the last answer on disk when the Hub is unreachable. */
export async function resolveRepo(repo: string, revision = 'main'): Promise<RepoInfo> {
  const key = `${repo}@${revision}`;
  const hit = resolved.get(key);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.info;

  const cacheFile = join(env.modelsDir, repo, `revision-${revision}.json`);
  let raw: { sha: string; gated?: boolean | string; siblings?: { rfilename: string }[] };
  try {
    const response = await fetch(`${HUB}/api/models/${repo}/revision/${encodeURIComponent(revision)}`, {
      headers: authHeaders(),
    });
    if (response.status === 401 || response.status === 403) throw new HttpError(403, gatedMessage(repo));
    if (response.status === 404) throw new HttpError(404, `${repo}@${revision} est introuvable sur le Hub`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = await response.json();
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(raw));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    try {
      raw = JSON.parse(await readFile(cacheFile, 'utf8'));
    } catch {
      throw new HttpError(502, `impossible de joindre le Hub pour ${repo} : ${e instanceof Error ? e.message : e}`);
    }
  }
  const info: RepoInfo = {
    repo,
    sha: raw.sha,
    gated: Boolean(raw.gated),
    files: new Set((raw.siblings ?? []).map((s) => s.rfilename)),
  };
  resolved.set(key, { info, at: Date.now() });
  return info;
}

export function localPath(info: Pick<RepoInfo, 'repo' | 'sha'>, file: string): string {
  return join(env.modelsDir, info.repo, info.sha, file);
}

export async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

/**
 * The local path of `file` from the repo at `info.sha`, downloading it first if needed.
 * Concurrent calls for one file share a download.
 */
export async function ensureFile(info: RepoInfo, file: string, onProgress?: (p: Progress) => void): Promise<string> {
  if (!info.files.has(file)) throw new HttpError(404, `${info.repo} n'a pas de fichier ${file}`);
  const path = localPath(info, file);
  if (await exists(path)) return path;

  let entry = downloads.get(path);
  if (!entry) {
    const listeners = new Set<(p: Progress) => void>();
    const url = `${HUB}/${info.repo}/resolve/${info.sha}/${file.split('/').map(encodeURIComponent).join('/')}`;
    const promise = download(url, path, info.repo, (p) => listeners.forEach((l) => l({ file, ...p }))).finally(() =>
      downloads.delete(path),
    );
    entry = { promise, listeners };
    downloads.set(path, entry);
  }
  if (onProgress) entry.listeners.add(onProgress);
  try {
    return await entry.promise;
  } finally {
    if (onProgress) entry.listeners.delete(onProgress);
  }
}

async function download(url: string, path: string, repo: string, onProgress: (p: Omit<Progress, 'file'>) => void) {
  const response = await fetch(url, { headers: authHeaders() });
  if (response.status === 401 || response.status === 403) throw new HttpError(403, gatedMessage(repo));
  if (!response.ok || !response.body) throw new HttpError(502, `téléchargement de ${url} : HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length')) || null;
  let loaded = 0;
  let last = 0;
  const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  async function* counted(source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      loaded += chunk.length;
      const now = Date.now();
      if (now - last > 100) {
        last = now;
        onProgress({ loaded, total });
      }
      yield chunk;
    }
  }

  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.${process.pid}.part`;
  try {
    await pipeline(body, counted, createWriteStream(part));
    await rename(part, path);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
  onProgress({ loaded, total: total ?? loaded });
  return path;
}

/** The checkpoint's languages and conditioners, read from its `config.json`. */
export async function getModelConfig(model: ModelInfo): Promise<ModelConfigResponse> {
  const info = await resolveRepo(model.repo);
  const config = JSON.parse(await readFile(await ensureFile(info, 'config.json'), 'utf8'));
  const conditioners: Conditioner[] = [];
  for (const c of config.conditioners ?? []) {
    if (c.type === 'lut') {
      const values: string[] = c.lut?.possible_values ?? [];
      const fallback = config[c.name] !== undefined ? String(config[c.name]) : values[0];
      conditioners.push({ name: c.name, kind: 'enum', values, default: values.includes(fallback) ? fallback : values[0] });
    } else if (c.type === 'continuous') {
      const value = typeof config[c.name] === 'number' ? config[c.name] : 0;
      conditioners.push({ name: c.name, kind: 'number', min: -1, max: 1, step: 0.05, default: value });
    }
  }
  return {
    id: model.id,
    sha: info.sha,
    languages: config.languages ?? model.languages,
    conditioners,
    quants: (Object.keys(WEIGHTS) as Quant[]).filter((q) => info.files.has(WEIGHTS[q])),
  };
}
