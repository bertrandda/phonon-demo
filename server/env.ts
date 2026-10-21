import 'dotenv/config';
import { resolve } from 'node:path';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  hfToken: process.env.HF_TOKEN?.trim() || null,
  modelsDir: resolve(process.env.MODELS_DIR ?? '.models'),
  maxLoadedModels: Math.max(1, Number(process.env.MAX_LOADED_MODELS ?? 3)),
  production: process.env.NODE_ENV === 'production',
};
