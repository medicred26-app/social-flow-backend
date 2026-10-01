import { spawn } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';
import { DRIVE_CONFIG } from './drive.config.js';
import {
  assertDriveVideo,
  downloadDriveFileToPath,
  findOrCreateSocialFlowFolder,
  toPointer,
  uploadDriveVideo,
} from './drive.client.js';

const require = createRequire(import.meta.url);

export function validateMergeInput(body = {}) {
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const unique = [...new Set(fileIds)];
  if (unique.length < 2) {
    return { ok: false, error: 'Select at least two Drive videos to merge.' };
  }
  if (unique.length > DRIVE_CONFIG.maxClips) {
    return { ok: false, error: `You can merge at most ${DRIVE_CONFIG.maxClips} clips at a time.` };
  }
  const title = String(body.title || '').trim().slice(0, 120);
  return { ok: true, fileIds: unique, title };
}

export function escapeConcatPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

export function resolveFfmpegPath() {
  try {
    return require('ffmpeg-static');
  } catch {
    return process.env.FFMPEG_PATH || 'ffmpeg';
  }
}

export function runFfmpeg(args, timeoutMs = DRIVE_CONFIG.mergeTimeoutMs) {
  const bin = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Video merge timed out. Use shorter 15–30s clips.'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg failed to start: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ code, stderr });
      else reject(new Error(`ffmpeg exited ${code}. ${stderr.slice(-400)}`));
    });
  });
}

export async function mergeLocalVideos(inputPaths, outputPath) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
    throw new Error('Need at least two local video files to merge.');
  }
  const listPath = `${outputPath}.txt`;
  const list = inputPaths.map((item) => `file '${escapeConcatPath(item)}'`).join('\n');
  await writeFile(listPath, list, 'utf8');
  try {
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ]);
  } finally {
    await rm(listPath, { force: true });
  }
  return outputPath;
}

export async function mergeDriveVideos(accessToken, { fileIds, title }, streamBaseUrl = '') {
  const workDir = await mkdtemp(path.join(tmpdir(), 'sf-drive-merge-'));
  const clipPaths = [];
  const sources = [];

  try {
    for (const [index, fileId] of fileIds.entries()) {
      const meta = await assertDriveVideo(accessToken, fileId);
      sources.push(toPointer(meta, streamBaseUrl));
      const clipPath = path.join(workDir, `clip-${String(index + 1).padStart(2, '0')}.mp4`);
      await downloadDriveFileToPath(accessToken, fileId, clipPath);
      clipPaths.push(clipPath);
    }

    const outputPath = path.join(workDir, 'merged.mp4');
    await mergeLocalVideos(clipPaths, outputPath);

    const folderId = await findOrCreateSocialFlowFolder(accessToken);
    const fileName = `${title || 'SocialFlow-merged'}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
    const uploaded = await uploadDriveVideo(accessToken, {
      filePath: outputPath,
      fileName,
      folderId,
      description: `Merged by SocialFlow from Drive file IDs: ${fileIds.join(', ')}. Original clips were not copied into SocialFlow.`,
    });

    return {
      pointer: toPointer(uploaded, streamBaseUrl),
      sources,
      clipCount: fileIds.length,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
