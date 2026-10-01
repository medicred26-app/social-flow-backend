import { supabase } from '../shared/utils/supabase.js';
import { storeGeneratedMedia, getGeneratedMedia } from '../ai/ai.jobs.js';

const BUCKET = 'socialflow-videos';
const MAX_BYTES = 80 * 1024 * 1024;
const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/mpeg',
]);

const uploads = new Map();

export function validateUpload({ originalname, mimetype, size }) {
  const name = String(originalname || 'video.mp4');
  const type = String(mimetype || '');
  const bytes = Number(size || 0);
  const looksVideo = type.startsWith('video/') || VIDEO_TYPES.has(type) || /\.(mp4|mov|webm|m4v|mpeg)$/i.test(name);
  if (!looksVideo) return { ok: false, error: 'Upload a video file (mp4, mov, or webm).' };
  if (!bytes) return { ok: false, error: 'The video file is empty.' };
  if (bytes > MAX_BYTES) return { ok: false, error: 'Videos can be up to 80 MB.' };
  return { ok: true, name, type: type || 'video/mp4', bytes };
}

function publicMediaUrl(id) {
  return `/api/media/files/${encodeURIComponent(id)}`;
}

async function uploadToSupabase(buffer, fileName, contentType) {
  if (!supabase) return null;
  const path = `uploads/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  try {
    await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => null);
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) return null;
    return { url: data.publicUrl, storagePath: path, stored: true, backend: 'supabase' };
  } catch (err) {
    console.warn('[Media upload] Supabase storage unavailable, keeping the file on the API:', err.message);
    return null;
  }
}

export async function saveUploadedVideo({ buffer, originalname, mimetype, size }) {
  const parsed = validateUpload({ originalname, mimetype, size: size || buffer?.length });
  if (!parsed.ok) return parsed;

  const remote = await uploadToSupabase(buffer, parsed.name, parsed.type);
  const id = storeGeneratedMedia(buffer, parsed.type);
  const localUrl = publicMediaUrl(id);
  const record = {
    id,
    name: parsed.name,
    mimeType: parsed.type,
    sizeBytes: parsed.bytes,
    url: remote?.url || localUrl,
    streamUrl: localUrl,
    stored: true,
    source: 'direct_upload',
    backend: remote?.backend || 'api_memory',
    storagePath: remote?.storagePath || id,
    createdAt: new Date().toISOString(),
  };
  uploads.set(id, record);
  return { ok: true, item: record };
}

export function getUploadedVideo(id) {
  return uploads.get(id) || null;
}

export function listUploadedVideos() {
  return [...uploads.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function getUploadedFileBuffer(id) {
  return getGeneratedMedia(id);
}

export const MEDIA_LIMITS = { MAX_BYTES, VIDEO_TYPES };
