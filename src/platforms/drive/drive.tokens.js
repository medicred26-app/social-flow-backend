import { getAccountCredentials, saveConnectedAccount } from '../../shared/utils/dbHelpers.js';
import { refreshDriveAccessToken } from './drive.oauth.js';

let memoryExpiry = 0;

export async function getDriveAccount() {
  return getAccountCredentials('drive');
}

export async function getDriveAccessToken() {
  const account = await getDriveAccount();
  if (!account || !account.accessToken) {
    throw new Error('Google Drive is not connected. Connect Drive first.');
  }

  const stillFresh = memoryExpiry && Date.now() < memoryExpiry && account.accessToken;
  if (stillFresh) return account.accessToken;

  if (account.refreshToken) {
    try {
      const refreshed = await refreshDriveAccessToken(account.refreshToken);
      memoryExpiry = Date.now() + Math.max(30, (refreshed.expiresIn || 3600) - 90) * 1000;
      const next = {
        ...account,
        accessToken: refreshed.accessToken,
        refreshToken: account.refreshToken,
        status: 'connected',
      };
      await saveConnectedAccount('drive', next);
      return refreshed.accessToken;
    } catch (err) {
      if (Date.now() < memoryExpiry) return account.accessToken;
      throw err;
    }
  }

  return account.accessToken;
}

export function markDriveTokenExpiry(expiresIn) {
  memoryExpiry = Date.now() + Math.max(30, (expiresIn || 3600) - 90) * 1000;
}

export function clearDriveTokenExpiry() {
  memoryExpiry = 0;
}
