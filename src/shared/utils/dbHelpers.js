// Shared persistence helper for users & connected social accounts
import { supabase } from './supabase.js';

async function withTimeout(promise, ms = 1500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), ms))
  ]);
}

const usersDb = [
  {
    id: 'user_1',
    email: 'demo@socialflow.app',
    name: 'Demo Creator',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80',
    provider: 'email'
  }
];

const connectedAccountsDb = new Map();

export function findUserByEmail(email) {
  if (!email) return null;
  return usersDb.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

export function saveUser(user) {
  const index = usersDb.findIndex(u => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase());
  if (index >= 0) {
    usersDb[index] = { ...usersDb[index], ...user };
    return usersDb[index];
  }
  usersDb.push(user);
  return user;
}

export async function saveConnectedAccount(platform, accountData) {
  const key = `${platform}_${accountData.id || accountData.handle}`;
  const record = {
    ...accountData,
    platform,
    updatedAt: new Date().toISOString()
  };

  connectedAccountsDb.set(key, record);

  try {
    if (supabase) {
      await supabase.from('social_accounts').upsert({
        account_key: key,
        platform,
        account_id: accountData.id || '',
        name: accountData.name || '',
        handle: accountData.handle || '',
        avatar: accountData.avatar || '',
        followers: accountData.followers || 0,
        access_token: accountData.accessToken || '',
        status: accountData.status || 'connected',
        updated_at: record.updatedAt
      }, { onConflict: 'account_key' });
    }
  } catch (err) {
    console.warn('[Supabase Sync] Warning: Could not persist social_accounts to Supabase table, using memory fallback:', err.message);
  }

  return record;
}

export function getConnectedAccounts(platform = null) {
  const accounts = Array.from(connectedAccountsDb.values());
  if (!platform) return accounts;
  return accounts.filter(a => a.platform === platform);
}

export async function getAccountCredentials(platform, accountId = null) {
  const memoryAccounts = Array.from(connectedAccountsDb.values())
    .filter(a => a.platform === platform && a.status === 'connected');
  
  let match = null;
  if (accountId) {
    match = memoryAccounts.find(a => a.id === accountId || a.handle === accountId);
  }
  if (!match && memoryAccounts.length > 0) {
    match = memoryAccounts[0];
  }

  if (match && match.accessToken) {
    return match;
  }

  try {
    if (supabase) {
      let query = supabase.from('social_accounts')
        .select('*')
        .eq('platform', platform)
        .eq('status', 'connected');
      
      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await withTimeout(query);
      if (!error && data && data.length > 0) {
        const record = data[0];
        return {
          id: record.account_id,
          name: record.name,
          handle: record.handle,
          avatar: record.avatar,
          followers: record.followers,
          accessToken: record.access_token,
          refreshToken: record.refresh_token || null,
          status: record.status
        };
      }
    }
  } catch (err) {
    console.warn('[Supabase Sync] Could not fetch account credentials from Supabase:', err.message);
  }

  return match || null;
}

export async function disconnectConnectedAccount(platform, accountId) {
  const keyPattern = accountId ? `${platform}_${accountId}` : null;
  for (const [key, acc] of connectedAccountsDb.entries()) {
    if (acc.platform === platform && (!keyPattern || key === keyPattern)) {
      connectedAccountsDb.set(key, {
        ...acc,
        status: 'disconnected',
        handle: '',
        name: '',
        avatar: '',
        followers: 0,
        updatedAt: new Date().toISOString()
      });
    }
  }

  try {
    if (supabase) {
      await supabase.from('social_accounts')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('platform', platform);
    }
  } catch (err) {
    console.warn('[Supabase Sync] Warning: Could not update disconnect status in Supabase:', err.message);
  }

  return { success: true };
}

export async function deleteConnectedAccount(platform, accountId) {
  const keyPattern = accountId ? `${platform}_${accountId}` : null;
  for (const [key, acc] of connectedAccountsDb.entries()) {
    if (acc.platform === platform && (!keyPattern || key === keyPattern)) {
      connectedAccountsDb.delete(key);
    }
  }

  try {
    if (supabase) {
      const query = supabase.from('social_accounts').delete().eq('platform', platform);
      if (accountId) query.eq('account_id', accountId);
      await query;
    }
  } catch (err) {
    console.warn('[Supabase Sync] Warning: Could not delete account credentials from Supabase:', err.message);
  }

  return { success: true };
}
