import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
import messagingRouter from './messaging/messaging.router.js';

import libraryRoutes from './routes/library.js';
import servicesRoutes from './routes/services.js';
import projectsRoutes from './routes/projects.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'SocialFlow Backend API Server',
    version: '2.5.0 (Unified Content Studio, Library, Services & Publishing Platform)',
    timestamp: new Date().toISOString(),
    platforms: ['facebook', 'instagram', 'youtube', 'x', 'linkedin'],
    googleOauthConfigured: !!process.env.GOOGLE_CLIENT_ID
  });
});

// Generic Auth and API Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', aiRouter);
app.use('/api/library', libraryRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/messages', messagingRouter);


// Independent Platform Routes
app.use('/api/platforms/facebook', facebookRouter);
app.use('/api/platforms/instagram', instagramRouter);
app.use('/api/platforms/youtube', youtubeRouter);
app.use('/api/platforms/x', xRouter);
app.use('/api/platforms/linkedin', linkedinRouter);

// Direct Root Auth Callbacks (e.g. /auth/youtube/callback)
app.get('/auth/youtube', (req, res) => res.redirect('/api/platforms/youtube/oauth'));
app.get('/auth/youtube/callback', (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  res.redirect(`/api/platforms/youtube/oauth/callback?${query}`);
});

// Fallback 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found on SocialFlow backend API server.' });
});

// Start listening
app.listen(PORT, () => {
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

