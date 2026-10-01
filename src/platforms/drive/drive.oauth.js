import { DRIVE_CONFIG } from './drive.config.js';

export function buildDriveAuthUrl(state) {
  if (!DRIVE_CONFIG.clientId) {
    throw new Error('GOOGLE_CLIENT_ID environment variable is missing.');
  }
  const params = new URLSearchParams({
    client_id: DRIVE_CONFIG.clientId,
    redirect_uri: DRIVE_CONFIG.redirectUri,
    response_type: 'code',
    scope: DRIVE_CONFIG.defaultScope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  if (state) params.set('state', state);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeDriveCode(code) {
  const params = new URLSearchParams({
    code,
    client_id: DRIVE_CONFIG.clientId,
    client_secret: DRIVE_CONFIG.clientSecret,
    redirect_uri: DRIVE_CONFIG.redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Failed to exchange Drive authorization code.');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

export async function refreshDriveAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('Google Drive is not connected. Connect Drive again.');
  }
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: DRIVE_CONFIG.clientId,
    client_secret: DRIVE_CONFIG.clientSecret,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Drive token refresh failed. Reconnect Google Drive.');
  }
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

export async function fetchDriveProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      id: `drive_${Date.now()}`,
      name: 'Google Drive',
      email: '',
      avatar: '',
    };
  }
  return {
    id: data.id || `drive_${Date.now()}`,
    name: data.name || data.email || 'Google Drive',
    email: data.email || '',
    avatar: data.picture || '',
  };
}
