import { createPipelineStages } from './ai.stages.js';

const jobs = new Map();
const media = new Map();
const MAX_JOBS = 40;
const MAX_MEDIA = 20;

function evict(map, limit) {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

export function createVideoJob() {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(id, {
    id,
    status: 'queued',
    stage: 'queued',
    stages: createPipelineStages(),
    message: 'Queued for the video pipeline.',
    createdAt: Date.now(),
    result: null,
    error: null,
  });
  evict(jobs, MAX_JOBS);
  return id;
}

export function updateVideoJob(id, patch) {
  const current = jobs.get(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: Date.now() };
  jobs.set(id, next);
  return next;
}

export function getVideoJob(id) {
  return jobs.get(id) || null;
}

export function storeGeneratedMedia(buffer, contentType = 'video/mp4') {
  const id = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  media.set(id, { buffer, contentType, createdAt: Date.now() });
  evict(media, MAX_MEDIA);
  return id;
}

export function getGeneratedMedia(id) {
  return media.get(id) || null;
}
