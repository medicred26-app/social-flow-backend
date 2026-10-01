import { AsyncLocalStorage } from 'node:async_hooks';
import { supabase } from '../shared/utils/supabase.js';
import { decryptToken, encryptToken } from '../shared/utils/encryption.js';

const store = new AsyncLocalStorage();
const KEY_ID = 'workspace_default';

let memoryKey = '';

export function validateClientApiKey(raw) {
  const apiKey = String(raw || '').trim();
  if (!apiKey) return { ok: false, error: 'Paste a Gemini API key from Google AI Studio.' };
  if (apiKey.length < 20) return { ok: false, error: 'That API key looks too short.' };
  if (/\s/.test(apiKey)) return { ok: false, error: 'Remove spaces from the API key.' };
  return { ok: true, apiKey };
}

export function validateVideoPrompt(raw) {
  const prompt = String(raw || '').trim();
  if (prompt.length < 8) return { ok: false, error: 'Write a prompt of at least a few words.' };
  return { ok: true, prompt: prompt.slice(0, 2000) };
}

export function maskApiKey(apiKey) {
  const value = String(apiKey || '');
  if (value.length < 8) return '';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function getRequestApiKey() {
  return store.getStore()?.apiKey || '';
}

export function getVideoTimeoutMs(fallbackMs) {
  return store.getStore()?.videoTimeoutMs || fallbackMs;
}

export function runWithClientKey(apiKey, fn, extras = {}) {
  return store.run({ apiKey, videoTimeoutMs: extras.videoTimeoutMs || 180000 }, fn);
}

export function getStoredClientKey() {
  return memoryKey;
}

export async function saveClientApiKey(raw) {
  const parsed = validateClientApiKey(raw);
  if (!parsed.ok) return parsed;
  memoryKey = parsed.apiKey;
  try {
    if (supabase) {
      await supabase.from('ai_client_keys').upsert({
        id: KEY_ID,
        encrypted_key: encryptToken(parsed.apiKey),
        last4: parsed.apiKey.slice(-4),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }
  } catch (err) {
    console.warn('[AI keys] Could not persist to Supabase, keeping the key in memory:', err.message);
  }
  return { ok: true, masked: maskApiKey(parsed.apiKey) };
}

export async function loadClientApiKey() {
  if (memoryKey) return memoryKey;
  try {
    if (supabase) {
      const { data, error } = await supabase.from('ai_client_keys').select('encrypted_key').eq('id', KEY_ID).maybeSingle();
      if (!error && data?.encrypted_key) {
        memoryKey = decryptToken(data.encrypted_key);
      }
    }
  } catch (err) {
    console.warn('[AI keys] Could not load client key from Supabase:', err.message);
  }
  return memoryKey;
}

export async function getClientKeyStatus() {
  const key = await loadClientApiKey();
  return {
    configured: Boolean(key),
    masked: key ? maskApiKey(key) : '',
    stored: Boolean(key),
  };
}

export async function clearClientApiKey() {
  memoryKey = '';
  try {
    if (supabase) {
      await supabase.from('ai_client_keys').delete().eq('id', KEY_ID);
    }
  } catch (err) {
    console.warn('[AI keys] Could not delete client key from Supabase:', err.message);
  }
  return { configured: false };
}

export async function resolveClientApiKey(override) {
  if (override) {
    const parsed = validateClientApiKey(override);
    if (!parsed.ok) throw new Error(parsed.error);
    await saveClientApiKey(parsed.apiKey);
    return parsed.apiKey;
  }
  const stored = await loadClientApiKey();
  if (!stored) {
    throw new Error('Add your Gemini API key first. SocialFlow will use that key to generate the video.');
  }
  return stored;
}
