import { Router } from 'express';
import { encodeOAuthState, frontendDriveUrl } from '../../shared/utils/publicUrls.js';
import {
  disconnectDrive,
  getDriveAuthUrl,
  getDriveStatus,
  handleDriveOAuthCallback,
  importPointers,
  listPointers,
  mergePointers,
  streamPointer,
} from './drive.service.js';

const router = Router();

router.get('/oauth', (req, res) => {
  try {
    req.oauthState = encodeOAuthState(req, { returnTo: '/drive' });
    res.redirect(getDriveAuthUrl(req));
  } catch (err) {
    res.redirect(frontendDriveUrl(req, { error: err.message }));
  }
});

router.get('/oauth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) {
    return res.redirect(frontendDriveUrl(req, { error: error_description || error }));
  }
  if (!code) {
    return res.redirect(frontendDriveUrl(req, { error: 'No authorization code received from Google Drive' }));
  }
  try {
    const result = await handleDriveOAuthCallback(code);
    return res.redirect(
      frontendDriveUrl(req, {
        drive_connected: 'true',
        name: result.account.name || 'Google Drive',
        email: result.account.handle || '',
      })
    );
  } catch (err) {
    return res.redirect(frontendDriveUrl(req, { error: err.message || 'Google Drive connection failed' }));
  }
});

router.get('/status', async (_req, res) => {
  try {
    res.json(await getDriveStatus());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/files', async (req, res) => {
  try {
    const result = await listPointers({
      pageToken: req.query.pageToken,
      pageSize: Number(req.query.pageSize || 40),
      q: req.query.q,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const result = await importPointers(req.body?.fileIds || req.body?.ids);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

router.get('/files/:fileId/stream', async (req, res) => {
  try {
    await streamPointer(req, res, req.params.fileId);
  } catch (err) {
    if (res.headersSent) return;
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

router.post('/merge', async (req, res) => {
  req.setTimeout(190000);
  res.setTimeout(190000);
  try {
    const result = await mergePointers(req.body || {});
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.post('/disconnect', async (_req, res) => {
  try {
    res.json(await disconnectDrive());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
