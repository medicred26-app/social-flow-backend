import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { createWriteStream } from 'fs';
import { DRIVE_CONFIG } from './drive.config.js';

const VIDEO_QUERY = "trashed = false and (mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.video')";
const FILE_FIELDS = 'id,name,mimeType,size,thumbnailLink,iconLink,webViewLink,createdTime,modifiedTime,videoMediaMetadata,md5Checksum';

export function toPointer(file, streamBaseUrl = '') {
  const fileId = file.id;
  const durationMs = Number(file.videoMediaMetadata?.durationMillis || 0);
  return {
    fileId,
    name: file.name || 'Untitled video',
    mimeType: file.mimeType || 'video/mp4',
    sizeBytes: Number(file.size || 0),
    durationSeconds: durationMs ? Math.round(durationMs / 1000) : null,
    thumbnailUrl: file.thumbnailLink || '',
    driveUrl: file.webViewLink || '',
    modifiedAt: file.modifiedTime || file.createdTime || null,
    stored: false,
    source: 'google_drive',
    streamUrl: streamBaseUrl ? `${streamBaseUrl}/api/platforms/drive/files/${encodeURIComponent(fileId)}/stream` : '',
  };
}

async function driveJson(url, accessToken, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error?.message || data.error_description || `Drive API failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function listDriveVideos(accessToken, { pageToken, pageSize = 40, query } = {}) {
  const params = new URLSearchParams({
    q: query || VIDEO_QUERY,
    pageSize: String(Math.min(100, Math.max(1, pageSize))),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (pageToken) params.set('pageToken', pageToken);
  return driveJson(`${DRIVE_CONFIG.filesUrl}?${params}`, accessToken);
}

export async function getDriveFileMetadata(accessToken, fileId) {
  const params = new URLSearchParams({
    fields: FILE_FIELDS,
    supportsAllDrives: 'true',
  });
  return driveJson(`${DRIVE_CONFIG.filesUrl}/${encodeURIComponent(fileId)}?${params}`, accessToken);
}

export async function assertDriveVideo(accessToken, fileId) {
  const meta = await getDriveFileMetadata(accessToken, fileId);
  const mime = String(meta.mimeType || '');
  const name = String(meta.name || '');
  const isVideo = mime.startsWith('video/') || mime === 'application/vnd.google-apps.video' || /\.(mp4|mov|webm|m4v|mkv)$/i.test(name);
  if (!isVideo) {
    const err = new Error(`${name || fileId} is not a video file.`);
    err.status = 400;
    throw err;
  }
  if (Number(meta.size || 0) > DRIVE_CONFIG.maxClipBytes) {
    const err = new Error(`${name} is larger than ${Math.round(DRIVE_CONFIG.maxClipBytes / (1024 * 1024))} MB.`);
    err.status = 400;
    throw err;
  }
  return meta;
}

export async function downloadDriveFileToPath(accessToken, fileId, destPath, maxBytes = DRIVE_CONFIG.maxClipBytes) {
  const res = await fetch(`${DRIVE_CONFIG.filesUrl}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Failed to download Drive file ${fileId}`);
  }

  const file = createWriteStream(destPath);
  let written = 0;
  const source = Readable.fromWeb(res.body);
  source.on('data', (chunk) => {
    written += chunk.length;
    if (written > maxBytes) {
      source.destroy(new Error('Drive file exceeded the download size limit.'));
    }
  });
  source.pipe(file);
  await finished(file);
  return written;
}

export async function pipeDriveFile(req, res, accessToken, fileId) {
  const meta = await getDriveFileMetadata(accessToken, fileId);
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (req.headers.range) headers.Range = req.headers.range;

  const google = await fetch(`${DRIVE_CONFIG.filesUrl}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers,
  });

  if (!google.ok && google.status !== 206) {
    const data = await google.json().catch(() => ({}));
    const err = new Error(data.error?.message || 'Could not stream this Drive file.');
    err.status = google.status;
    throw err;
  }

  res.status(google.status);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', google.headers.get('content-type') || meta.mimeType || 'video/mp4');
  const length = google.headers.get('content-length');
  const range = google.headers.get('content-range');
  if (length) res.setHeader('Content-Length', length);
  if (range) res.setHeader('Content-Range', range);
  res.setHeader('Content-Disposition', `inline; filename="${(meta.name || 'video.mp4').replace(/"/g, '')}"`);

  if (!google.body) {
    res.end();
    return;
  }
  Readable.fromWeb(google.body).pipe(res);
}

export async function findOrCreateSocialFlowFolder(accessToken) {
  const params = new URLSearchParams({
    q: `name = '${DRIVE_CONFIG.folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: '1',
  });
  const existing = await driveJson(`${DRIVE_CONFIG.filesUrl}?${params}`, accessToken);
  if (existing.files?.[0]?.id) return existing.files[0].id;

  const created = await driveJson(DRIVE_CONFIG.filesUrl, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_CONFIG.folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  return created.id;
}

export async function uploadDriveVideo(accessToken, { filePath, fileName, description, folderId }) {
  const { readFile } = await import('fs/promises');
  const bytes = await readFile(filePath);
  const metadata = {
    name: fileName,
    mimeType: 'video/mp4',
    description: description || 'Merged by SocialFlow. The original clips stay in your Drive; this is a new file.',
  };
  if (folderId) metadata.parents = [folderId];

  const start = await fetch(`${DRIVE_CONFIG.uploadUrl}?uploadType=resumable&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(bytes.length),
    },
    body: JSON.stringify(metadata),
  });

  if (!start.ok) {
    const data = await start.json().catch(() => ({}));
    throw new Error(data.error?.message || 'Could not start Drive upload for the merged video.');
  }

  const sessionUrl = start.headers.get('location');
  if (!sessionUrl) throw new Error('Drive did not return an upload session.');

  const put = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  });

  const uploaded = await put.json().catch(() => ({}));
  if (!put.ok) {
    throw new Error(uploaded.error?.message || 'Drive rejected the merged video upload.');
  }
  return getDriveFileMetadata(accessToken, uploaded.id);
}
