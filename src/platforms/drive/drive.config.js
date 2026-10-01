import { resolveRedirectUri } from '../../shared/utils/publicUrls.js';

export const DRIVE_CONFIG = {
  platformId: 'drive',
  displayName: 'Google Drive',
  filesUrl: 'https://www.googleapis.com/drive/v3/files',
  uploadUrl: 'https://www.googleapis.com/upload/drive/v3/files',
  folderName: 'SocialFlow',
  maxClips: 8,
  maxClipBytes: 80 * 1024 * 1024,
  mergeTimeoutMs: 180000,
  get clientId() { return process.env.GOOGLE_CLIENT_ID || ''; },
  get clientSecret() { return process.env.GOOGLE_CLIENT_SECRET || ''; },
  get redirectUri() {
    return resolveRedirectUri(process.env.DRIVE_REDIRECT_URI, '/auth/drive/callback');
  },
  defaultScope: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' '),
};
