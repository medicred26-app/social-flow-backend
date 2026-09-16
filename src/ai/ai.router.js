import express from 'express';
import { aiService } from './ai.service.js';
import { AiConfigError, AiApiError, proxyGeminiMedia } from './ai.provider.js';
import { AI_CONFIG } from './ai.config.js';
import { createVideoJob, getGeneratedMedia, getVideoJob, updateVideoJob } from './ai.jobs.js';

const router = express.Router();

function sendAiError(res, err) {
  const status = err instanceof AiConfigError ? 503 : err.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: err.message || 'AI request failed.',
  });
}

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    configured: Boolean(AI_CONFIG.apiKey),
    provider: AI_CONFIG.provider,
    model: AI_CONFIG.model,
    imageModel: AI_CONFIG.imageModel,
    videoModel: AI_CONFIG.videoModel,
  });
});

router.get('/media/proxy', async (req, res) => {
  try {
    const uri = req.query.uri;
    if (!uri) return res.status(400).json({ success: false, error: 'Missing media uri.' });
    const media = await proxyGeminiMedia(uri);
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(media.buffer);
  } catch (err) {
    return sendAiError(res, err);
  }
});

router.get('/media/:id', (req, res) => {
  const media = getGeneratedMedia(req.params.id);
  if (!media) return res.status(404).json({ success: false, error: 'Generated media expired. Generate again.' });
  res.setHeader('Content-Type', media.contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.send(media.buffer);
});

router.get('/video/jobs/:id', (req, res) => {
  const job = getVideoJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Video job not found. Generate again.' });
  if (job.status === 'error') {
    return res.json({ success: false, jobId: job.id, status: job.status, error: job.error });
  }
  if (job.status !== 'done') {
    return res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      stages: job.stages,
      message: job.message,
    });
  }
  return res.json({ success: true, jobId: job.id, status: 'done', ...job.result });
});

router.post('/enhance-post', async (req, res) => {
  try {
    const data = await aiService.enhancePost(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/video/generate', async (req, res) => {
  try {
    const jobId = createVideoJob();
    res.json({ success: true, jobId, status: 'queued' });
    setImmediate(async () => {
      try {
        updateVideoJob(jobId, { status: 'running', stage: 'input', message: 'Starting video pipeline...' });
        const data = await aiService.generateVideo(req.body || {}, (progress) => {
          updateVideoJob(jobId, {
            status: 'running',
            stage: progress.stage,
            stages: progress.stages,
            message: progress.message,
          });
        });
        updateVideoJob(jobId, { status: 'done', stage: 'publish', stages: data.pipeline?.stages, result: data });
      } catch (err) {
        updateVideoJob(jobId, { status: 'error', error: err.message || 'Video generation failed.' });
      }
    });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/captions/generate', async (req, res) => {
  try {
    const { topic, prompt, tone, platform } = req.body || {};
    const data = await aiService.generateCaption({
      topic: topic || prompt || 'Social media growth',
      platform: platform || 'instagram',
      tone: tone || 'friendly',
    });
    res.json({
      success: true,
      provider: AI_CONFIG.model,
      hook: data.hook,
      caption: data.caption,
      cta: data.cta,
      hashtags: data.hashtags,
    });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/thumbnail/generate', async (req, res) => {
  try {
    const data = await aiService.generateThumbnail(req.body || {});
    res.json({ success: true, ...data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/repurpose', async (req, res) => {
  try {
    const { contentText, text, sourceContent } = req.body || {};
    const data = await aiService.repurposeContent({
      sourceContent: sourceContent || contentText || text || '',
    });
    const rewritten = await aiService.platformRewrite({
      text: sourceContent || contentText || text || '',
    }).catch(() => ({}));
    res.json({
      success: true,
      provider: AI_CONFIG.model,
      versions: [
        { platform: 'instagram', format: '9:16 Reel', caption: rewritten.instagram || data.instagram_carousel_slides?.join(' · ') },
        { platform: 'youtube', format: '9:16 Short', caption: rewritten.youtube || data.short_video_script },
        { platform: 'linkedin', format: 'Article', caption: rewritten.linkedin || data.linkedin_article_summary },
        { platform: 'x', format: 'Thread', caption: rewritten.x || data.tweet_thread?.join(' ') },
        { platform: 'facebook', format: 'Feed post', caption: rewritten.facebook },
      ],
      pack: data,
    });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/score-post', async (req, res) => {
  try {
    const data = await aiService.scorePost(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/ideas', async (req, res) => {
  try {
    const data = await aiService.generateContentIdeas(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/generate-caption', async (req, res) => {
  try {
    const data = await aiService.generateCaption(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/platform-rewrite', async (req, res) => {
  try {
    const data = await aiService.platformRewrite(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/seo-assistant', async (req, res) => {
  try {
    const data = await aiService.seoAssistant(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/content-ideas', async (req, res) => {
  try {
    const data = await aiService.generateContentIdeas(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.post('/weekly-report', async (req, res) => {
  try {
    const data = await aiService.generateWeeklyReport(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

router.get('/best-times', async (req, res) => {
  try {
    const data = await aiService.calculateBestTimes(req.query || {});
    res.json({ success: true, data });
  } catch (err) {
    sendAiError(res, err);
  }
});

export default router;
