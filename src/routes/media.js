import { Router } from 'express';
import multer from 'multer';
import { MEDIA_LIMITS, getUploadedFileBuffer, listUploadedVideos, saveUploadedVideo } from '../media/media.store.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDIA_LIMITS.MAX_BYTES, files: 1 },
});

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    success: true,
    storedVideos: true,
    items: listUploadedVideos(),
  });
});

router.get('/files/:id', (req, res) => {
  const media = getUploadedFileBuffer(req.params.id);
  if (!media) return res.status(404).json({ success: false, error: 'Uploaded video expired or was not found.' });
  res.setHeader('Content-Type', media.contentType || 'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.send(media.buffer);
});

router.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Choose a video file to upload.' });
    }
    const result = await saveUploadedVideo(req.file);
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.status(201).json({
      success: true,
      storedVideos: true,
      message: 'Video saved in SocialFlow storage. You can preview, merge later, or publish it.',
      item: result.item,
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'Videos can be up to 80 MB.' });
    }
    return res.status(500).json({ success: false, error: err.message || 'Upload failed.' });
  }
});

export default router;
