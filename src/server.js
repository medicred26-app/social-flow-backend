import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getAppUrl, getFrontendUrl } from './shared/utils/publicUrls.js';
import { getXRedirectUri } from './platforms/x/x.oauth.js';
import { getLinkedInRedirectUri } from './platforms/linkedin/linkedin.oauth.js';
import { FACEBOOK_CONFIG } from './platforms/facebook/facebook.config.js';
import { INSTAGRAM_CONFIG } from './platforms/instagram/instagram.config.js';
import { YOUTUBE_CONFIG } from './platforms/youtube/youtube.config.js';
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import accountsRoutes from './routes/accounts.js';
import analyticsRoutes from './routes/analytics.js';
import facebookRouter from './platforms/facebook/facebook.router.js';
import instagramRouter from './platforms/instagram/instagram.router.js';
import youtubeRouter from './platforms/youtube/youtube.router.js';
import xRouter from './platforms/x/x.router.js';
import linkedinRouter from './platforms/linkedin/linkedin.router.js';
import aiRouter from './ai/ai.router.js';
import marketplaceRouter from './marketplace/marketplace.router.js';

import libraryRoutes from './routes/library.js';
import servicesRoutes from './routes/services.js';
import projectsRoutes from './routes/projects.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: '*', // Allow connections from Next.js frontend
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`[SocialFlow Backend] ${new Date().toISOString()} | ${req.method} ${req.url}`);
  next();
});

app.get('/', (_req, res) => {
  res.json({ status: 'online', service: 'socialflow-api' });
});

app.get('/api/health', (req, res) => {
  const payload = {
    status: 'online',
    service: 'SocialFlow Backend API Server',
    version: '2.6.0 (Script-to-publish video pipeline)',
    timestamp: new Date().toISOString(),
    platforms: ['facebook', 'instagram', 'youtube', 'x', 'linkedin'],
    googleOauthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.AI_API_KEY),
  };

  try {
    payload.oauth = {
      appUrl: getAppUrl(),
      frontendUrl: getFrontendUrl(),
      facebookRedirect: FACEBOOK_CONFIG.redirectUri,
      instagramRedirect: INSTAGRAM_CONFIG.redirectUri,
      youtubeRedirect: YOUTUBE_CONFIG.redirectUri,
      xRedirect: getXRedirectUri(),
      linkedinRedirect: getLinkedInRedirectUri(),
      metaAppId: Boolean(FACEBOOK_CONFIG.appId),
      instagramAppId: Boolean(INSTAGRAM_CONFIG.appId),
    };
  } catch (err) {
    payload.oauth = { error: err.message };
  }

  res.status(200).json(payload);
});

// Generic Auth and API Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', (req, res, next) => {
  req.setTimeout(190000);
  res.setTimeout(190000);
  next();
}, aiRouter);
app.use('/api/library', libraryRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/marketplace', marketplaceRouter);


// Independent Platform Routes
app.use('/api/platforms/facebook', facebookRouter);
app.use('/api/platforms/instagram', instagramRouter);
app.use('/api/platforms/youtube', youtubeRouter);
app.use('/api/platforms/x', xRouter);
app.use('/api/platforms/linkedin', linkedinRouter);

// Direct Root Auth Callbacks (e.g. /auth/youtube/callback)
function forwardQuery(req, path) {
  const query = new URLSearchParams(req.query).toString();
  return query ? `${path}?${query}` : path;
}

app.get('/auth/youtube', (req, res) => res.redirect(forwardQuery(req, '/api/platforms/youtube/oauth')));
app.get('/auth/youtube/callback', (req, res) => {
  res.redirect(forwardQuery(req, '/api/platforms/youtube/oauth/callback'));
});
app.get('/auth/facebook', (req, res) => res.redirect(forwardQuery(req, '/api/platforms/facebook/oauth')));
app.get('/auth/facebook/callback', (req, res) => {
  res.redirect(forwardQuery(req, '/api/platforms/facebook/oauth/callback'));
});
app.get('/api/auth/facebook/callback', (req, res) => {
  res.redirect(forwardQuery(req, '/api/platforms/facebook/oauth/callback'));
});
app.get('/api/oauth/facebook/callback', (req, res) => {
  res.redirect(forwardQuery(req, '/api/platforms/facebook/oauth/callback'));
});
app.get('/auth/instagram', (req, res) => res.redirect(forwardQuery(req, '/api/platforms/instagram/oauth')));
app.get('/auth/instagram/callback', (req, res) => {
  res.redirect(forwardQuery(req, '/api/platforms/instagram/oauth/callback'));
});
app.get('/api/oauth/youtube/callback', (req, res) => {
  res.redirect(forwardQuery(req, '/api/platforms/youtube/oauth/callback'));
});
app.get('/api/oauth/instagram/callback', (req, res) => {
  res.redirect(forwardQuery(req, '/api/platforms/instagram/oauth/callback'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found on SocialFlow backend API server.' });
});

app.use((err, _req, res, next) => {
  console.error('[SocialFlow Backend] Unhandled error:', err?.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 SocialFlow Express Backend Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔑 Google Client ID: ${process.env.GOOGLE_CLIENT_ID ? 'Configured' : 'Not configured (set in backend/.env)'}`);
  console.log(`====================================================`);

  // Background queue monitor worker
  setInterval(() => {
    // Background queue polling pulse
  }, 30000);
});

