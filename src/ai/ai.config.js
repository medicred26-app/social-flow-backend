import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.AI_API_KEY);
}

export const AI_CONFIG = {
  get apiKey() {
    return (
      process.env.GEMINI_API_KEY ||
      process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      ''
    );
  },
  get provider() {
    if (process.env.AI_PROVIDER) return process.env.AI_PROVIDER.toLowerCase();
    return hasGeminiKey() ? 'gemini' : 'openai';
  },
  get model() {
    return process.env.AI_MODEL || (this.provider === 'gemini' ? 'gemini-3.6-flash' : 'gpt-4o-mini');
  },
  get textModels() {
    return [...new Set([
      this.model,
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
    ])];
  },
  get imageModel() {
    return process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  },
  get videoModel() {
    return process.env.GEMINI_VIDEO_MODEL || 'gemini-omni-1.1-flash';
  },
  get baseUrl() {
    if (process.env.AI_BASE_URL) return process.env.AI_BASE_URL;
    if (this.provider === 'openrouter') return 'https://openrouter.ai/api/v1';
    if (this.provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta';
    return 'https://api.openai.com/v1';
  },
  timeoutMs: 25000,
  videoTimeoutMs: 15000,
  get mediaEnabled() {
    return String(process.env.GEMINI_MEDIA_ENABLED || '').toLowerCase() === 'true';
  },
};
