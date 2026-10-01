import { saveConnectedAccount, deleteConnectedAccount } from '../../shared/utils/dbHelpers.js';
import { getAppUrl } from '../../shared/utils/publicUrls.js';
import { buildDriveAuthUrl, exchangeDriveCode, fetchDriveProfile } from './drive.oauth.js';
import { clearDriveTokenExpiry, getDriveAccessToken, getDriveAccount, markDriveTokenExpiry } from './drive.tokens.js';
import { getDriveFileMetadata, listDriveVideos, pipeDriveFile, toPointer } from './drive.client.js';
import { mergeDriveVideos, validateMergeInput } from './drive.merge.js';

function streamBase() {
  return getAppUrl();
}

export function getDriveAuthUrl(req) {
  return buildDriveAuthUrl(req?.oauthState);
}

export async function handleDriveOAuthCallback(code) {
  const tokens = await exchangeDriveCode(code);
  const profile = await fetchDriveProfile(tokens.accessToken);
  markDriveTokenExpiry(tokens.expiresIn);
  const account = {
    id: profile.id,
    name: profile.name,
    handle: profile.email || 'Google Drive',
    avatar: profile.avatar,
    followers: 0,
    status: 'connected',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
  await saveConnectedAccount('drive', account);
  return { success: true, account };
}

export async function getDriveStatus() {
  const account = await getDriveAccount();
  const connected = Boolean(account?.accessToken && account.status !== 'disconnected');
  return {
    success: true,
    connected,
    storedVideos: false,
    mode: 'pointer_only',
    account: connected
      ? {
          id: account.id,
          name: account.name,
          email: account.handle,
          avatar: account.avatar,
        }
      : null,
  };
}

export async function listPointers({ pageToken, pageSize, q } = {}) {
  const token = await getDriveAccessToken();
  const extra = q
    ? `trashed = false and mimeType contains 'video/' and name contains '${String(q).replace(/'/g, "\\'")}'`
    : undefined;
  const data = await listDriveVideos(token, { pageToken, pageSize, query: extra });
  return {
    success: true,
    storedVideos: false,
    nextPageToken: data.nextPageToken || null,
    items: (data.files || []).map((file) => toPointer(file, streamBase())),
  };
}

export async function importPointers(fileIds = []) {
  const ids = [...new Set((fileIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) {
    return { success: false, error: 'Select at least one Drive video.' };
  }
  const token = await getDriveAccessToken();
  const items = [];
  for (const fileId of ids) {
    const meta = await getDriveFileMetadata(token, fileId);
    items.push(toPointer(meta, streamBase()));
  }
  return {
    success: true,
    storedVideos: false,
    message: 'Saved Drive addresses only. The videos stay in your Drive.',
    items,
  };
}

export async function streamPointer(req, res, fileId) {
  const token = await getDriveAccessToken();
  await pipeDriveFile(req, res, token, fileId);
}

export async function mergePointers(body) {
  const parsed = validateMergeInput(body);
  if (!parsed.ok) {
    return { success: false, error: parsed.error };
  }
  const token = await getDriveAccessToken();
  const result = await mergeDriveVideos(token, parsed, streamBase());
  return {
    success: true,
    storedVideos: false,
    message: `Merged ${result.clipCount} Drive clips into one longer video. The result was saved back to your Drive/SocialFlow folder.`,
    item: result.pointer,
    sources: result.sources,
  };
}

export async function disconnectDrive() {
  clearDriveTokenExpiry();
  await deleteConnectedAccount('drive');
  return { success: true, connected: false };
}
