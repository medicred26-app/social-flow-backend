import { Router } from 'express';
import { supabase } from '../shared/utils/supabase.js';

const router = Router();

// Helper for resilient Supabase queries with 1.5s timeout
async function withTimeout(promise, ms = 1500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), ms))
  ]);
}

// In-memory user store (fallback when Supabase unavailable)
const usersDb = [
  {
    id: 'user_1',
    email: 'demo@socialflow.app',
    name: 'Demo Creator',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80',
    provider: 'email',
    role: 'customer'
  }
];

/**
 * Look up a user by email from Supabase. Returns null if not found or Supabase unavailable.
 */
async function findUserByEmail(email) {
  try {
    if (supabase) {
      const { data, error } = await withTimeout(
        supabase
          .from('users')
          .select('*')
          .eq('email', email.toLowerCase())
          .maybeSingle()
      );
      if (!error && data) return data;
    }
  } catch (_) {}
  return usersDb.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

/**
 * Upsert (create or update) a user in Supabase + memory store.
 */
async function upsertUser({ id, email, name, avatar, provider, role }) {
  const userData = {
    id,
    email: email.toLowerCase(),
    name: name || email.split('@')[0],
    avatar: avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`,
    provider: provider || 'email',
    role: role || 'customer',
    updated_at: new Date().toISOString()
  };

  // Upsert to Supabase (by id)
  try {
    if (supabase) {
      await supabase.from('users').upsert(
        { ...userData, created_at: new Date().toISOString() },
        { onConflict: 'id', ignoreDuplicates: false }
      );
    }
  } catch (err) {
    console.warn('[Auth] Could not upsert user to Supabase:', err.message);
  }

  // Sync memory store
  const idx = usersDb.findIndex(u => u.id === id || u.email.toLowerCase() === email.toLowerCase());
  if (idx >= 0) {
    usersDb[idx] = { ...usersDb[idx], ...userData };
    return usersDb[idx];
  }
  usersDb.push(userData);
  return userData;
}

// GET Google Auth Config
router.get('/google-config', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  res.json({
    configured: !!clientId && !clientId.includes('your-google-client-id'),
    clientId: clientId || null,
    message: clientId ? 'Google OAuth Client ID is loaded' : 'Google OAuth Client ID not set in backend .env'
  });
});

// POST Login Endpoint
router.post('/login', async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  // Look up user by email (Supabase first, then memory fallback)
  let user = await findUserByEmail(email);

  if (!user) {
    // Auto-create account on first login
    const newId = `user_${Date.now()}`;
    user = await upsertUser({
      id: newId,
      email,
      name: email.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' '),
      provider: 'email',
      role: role || 'customer'
    });
  }

  // If role is provided and differs, update it
  if (role && user.role !== role) {
    user = await upsertUser({ ...user, role });
  }

  const token = `sf_jwt_token_${user.id}_${Date.now()}`;
  return res.json({ success: true, message: 'Login successful', token, user });
});

// POST Signup Endpoint
router.post('/signup', async (req, res) => {
  const { email, password, name, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  // Check for existing user
  const existing = await findUserByEmail(email);
  if (existing) {
    // Treat as login if already exists (idempotent signup)
    const token = `sf_jwt_token_${existing.id}_${Date.now()}`;
    return res.json({ success: true, message: 'Account already exists, logged in.', token, user: existing });
  }

  const newUser = await upsertUser({
    id: `user_${Date.now()}`,
    email,
    name: name || email.split('@')[0],
    provider: 'email',
    role: role || 'customer'
  });

  const token = `sf_jwt_token_${newUser.id}_${Date.now()}`;
  return res.status(201).json({ success: true, message: 'Account created successfully', token, user: newUser });
});

// POST Send OTP via EmailJS Endpoint
router.post('/send-otp', async (req, res) => {
  const { email, name, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP code are required.' });
  }

  const serviceId = process.env.EMAILJS_SERVICE_ID || 'service_ju07k4r';
  const templateId = process.env.EMAILJS_TEMPLATE_ID || 'template_scew9gb';
  const publicKey = process.env.EMAILJS_PUBLIC_KEY || 'otVTMOVNTqwtD8-kl';

  try {
    const payload = {
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: {
        to_email: email,
        to_name: name || email.split('@')[0],
        user_name: name || email.split('@')[0],
        email: email,
        user_email: email,
        otp: otp,
        passcode: otp,
        code: otp,
        verification_code: otp,
        otp_code: otp
      }
    };

    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return res.json({ success: true, message: `OTP verification email sent to ${email}` });
    }

    const errorText = await response.text();
    console.error('[EmailJS Backend] Error from EmailJS API:', errorText);
    return res.status(500).json({ success: false, message: errorText || 'Failed to send OTP email.' });
  } catch (err) {
    console.error('[EmailJS Backend] Exception sending OTP:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST Google OAuth Login / Verify Endpoint
router.post('/google', async (req, res) => {
  const { credential, clientId, user: googleUser } = req.body;

  if (!credential && !googleUser && !clientId) {
    return res.status(400).json({ success: false, message: 'Google authentication credential or user payload required.' });
  }

  let email = googleUser?.email;
  let name = googleUser?.name;
  let avatar = googleUser?.picture;
  let googleId = googleUser?.id;

  // If JWT credential passed from Google Identity Services:
  if (credential && typeof credential === 'string') {
    try {
      const base64Url = credential.split('.')[1];
      if (base64Url) {
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
        );
        const payload = JSON.parse(jsonPayload);
        email = payload.email || email;
        name = payload.name || name;
        avatar = payload.picture || avatar;
        googleId = payload.sub || googleId;
      }
    } catch (e) {
      console.warn('Failed to parse Google JWT payload:', e);
    }
  }

  if (!email) email = `google_user_${Date.now()}@socialflow.app`;

  // Look up existing user by email
  let user = await findUserByEmail(email);

  if (!user) {
    user = await upsertUser({
      id: googleId || `google_user_${Date.now()}`,
      email,
      name: name || 'Google User',
      avatar: avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`,
      provider: 'google',
      role: 'customer'
    });
  } else {
    // Update Google profile fields
    user = await upsertUser({ ...user, name: name || user.name, avatar: avatar || user.avatar, provider: 'google' });
  }

  const token = `sf_google_token_${user.id}_${Date.now()}`;
  return res.json({ success: true, message: 'Google Sign-In successful', token, user });
});

// GET Initiates Facebook OAuth 2.0 Login (Forward to independent Facebook platform router)
router.get('/facebook', (req, res) => {
  res.redirect('/api/platforms/facebook/oauth');
});

router.get('/facebook/callback', (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  res.redirect(`/api/platforms/facebook/oauth/callback?${query}`);
});

// GET Initiates YouTube OAuth 2.0 Login (Forward to independent YouTube platform router)
router.get('/youtube', (req, res) => {
  res.redirect('/api/platforms/youtube/oauth');
});

router.get('/youtube/callback', (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  res.redirect(`/api/platforms/youtube/oauth/callback?${query}`);
});

// GET Initiates Instagram OAuth Login
router.get('/instagram', (req, res) => {
  res.redirect('/api/platforms/instagram/oauth');
});

// GET Initiates X (Twitter) OAuth Login
router.get('/x', (req, res) => {
  res.redirect('/api/platforms/x/oauth');
});

// GET Initiates LinkedIn OAuth Login
router.get('/linkedin', (req, res) => {
  res.redirect('/api/platforms/linkedin/oauth');
});

export default router;

