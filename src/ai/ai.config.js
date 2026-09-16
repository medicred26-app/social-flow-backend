import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const AI_CONFIG = {
  get apiKey() {
    return process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || '';
  },
  get provider() {
    return (process.env.AI_PROVIDER || 'openai').toLowerCase();
  },
  get model() {
    return process.env.AI_MODEL || 'gpt-4o-mini';
  },
  get baseUrl() {
    if (process.env.AI_BASE_URL) return process.env.AI_BASE_URL;
    if (this.provider === 'openrouter') return 'https://openrouter.ai/api/v1';
    if (this.provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta';
    return 'https://api.openai.com/v1';
  },
  timeoutMs: 25000
};
