import { AI_CONFIG } from './ai.config.js';
import { storeGeneratedMedia } from './ai.jobs.js';
import { createLogger } from '../middleware/logger.js';

const logger = createLogger('AIProvider');

export class AiConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiConfigError';
  }
}

export class AiApiError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AiApiError';
    this.statusCode = statusCode;
  }
}

function requireApiKey() {
  const apiKey = AI_CONFIG.apiKey;
  if (!apiKey || apiKey.includes('your-') || apiKey === 'YOUR_AI_API_KEY') {
    throw new AiConfigError('Gemini is not configured. Add GEMINI_API_KEY to backend/.env.');
  }
  return apiKey;
}

function parseJsonContent(content) {
  if (!content) throw new AiApiError('AI Provider returned an empty response.');
  if (typeof content === 'object') return content;
  const cleaned = String(content)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new AiApiError('AI Provider response was not valid JSON.');
  }
}

function geminiHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };
}

function geminiUrl(pathOrUrl) {
  const apiKey = requireApiKey();
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${AI_CONFIG.baseUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}key=${encodeURIComponent(apiKey)}`;
}

async function geminiFetch(pathOrUrl, options = {}) {
  const apiKey = requireApiKey();
  return fetch(geminiUrl(pathOrUrl), {
    ...options,
    headers: {
      ...geminiHeaders(apiKey),
      ...(options.headers || {}),
    },
  });
}

function readErrorMessage(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed.error?.message || parsed.message || raw;
  } catch {
    return raw;
  }
}

async function callGeminiContent({
  systemPrompt,
  userPrompt,
  responseFormat = 'json',
  model,
  extraParts = [],
  generationConfig = {},
}) {
  const models = model ? [model] : AI_CONFIG.textModels;
  let lastError;

  for (const nextModel of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt || 'You are a helpful social media assistant.' }] },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }, ...extraParts],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        ...generationConfig,
      },
    };

    if (responseFormat === 'json' && !body.generationConfig.responseMimeType) {
      body.generationConfig.responseMimeType = 'application/json';
    }

    try {
      const res = await geminiFetch(`/models/${nextModel}:generateContent`, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const raw = await res.text();
      if (!res.ok) {
        lastError = mapHttpError(res.status, raw);
        logger.warn(`Gemini ${nextModel} HTTP ${res.status}: ${raw.slice(0, 220)}`);
        if (res.status === 404 || res.status === 429) continue;
        throw lastError;
      }

      const data = JSON.parse(raw);
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('\n').trim();
      const images = parts
        .filter((p) => p.inlineData?.data)
        .map((p) => `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`);

      if (responseFormat === 'json') {
        return parseJsonContent(text);
      }
      return { text, images, raw: data, model: nextModel };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = wrapProviderError(err);
      if (err instanceof AiApiError && err.statusCode && ![404, 429].includes(err.statusCode)) {
        throw lastError;
      }
    }
  }

  throw lastError || new AiApiError('Gemini request failed.');
}

async function callOpenAiCompatible({ systemPrompt, userPrompt, responseFormat = 'json' }) {
  const apiKey = requireApiKey();
  const endpoint = `${AI_CONFIG.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);

  const payload = {
    model: AI_CONFIG.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
  };
  if (responseFormat === 'json') {
    payload.response_format = { type: 'json_object' };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      logger.error(`AI HTTP ${res.status}:`, errText.slice(0, 500));
      throw mapHttpError(res.status);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return responseFormat === 'json' ? parseJsonContent(content) : content;
  } catch (err) {
    clearTimeout(timeoutId);
    throw wrapProviderError(err);
  }
}

function mapHttpError(status, raw = '') {
  const detail = readErrorMessage(raw);
  if (status === 401 || status === 403) {
    return new AiApiError('Invalid GEMINI_API_KEY. Check the key in backend/.env.', status);
  }
  if (status === 429) {
    if (/limit: 0|free_tier/i.test(detail)) {
      return new AiApiError(
        'This Gemini key has no video/image quota. Enable billing in Google AI Studio, or wait and retry. Text models still work.',
        status
      );
    }
    return new AiApiError('Gemini rate limit exceeded. Try again in a moment.', status);
  }
  if (status === 404) {
    return new AiApiError('Gemini model was not found for this API key. Update AI_MODEL to gemini-3.6-flash.', status);
  }
  return new AiApiError(detail || `Gemini error (${status}): unable to complete the request.`, status);
}

function wrapProviderError(err) {
  if (err.name === 'AbortError') {
    return new AiApiError('AI request timed out. Please try again.');
  }
  if (err instanceof AiConfigError || err instanceof AiApiError) {
    return err;
  }
  logger.error('Unexpected AI provider error:', err);
  return new AiApiError(err.message || 'Failed to connect to Gemini.');
}

export async function callLlmProvider({ systemPrompt, userPrompt, responseFormat = 'json' }) {
  if (AI_CONFIG.provider === 'gemini') {
    return callGeminiContent({ systemPrompt, userPrompt, responseFormat });
  }
  return callOpenAiCompatible({ systemPrompt, userPrompt, responseFormat });
}

function persistVideoBuffer(buffer, mimeType = 'video/mp4') {
  const id = storeGeneratedMedia(buffer, mimeType);
  return `/api/ai/media/${id}`;
}

function extractInteractionVideo(data) {
  if (data?.output_video) return data.output_video;
  for (const step of data?.steps || []) {
    for (const part of step.content || []) {
      if (part.type === 'video' || String(part.mime_type || '').startsWith('video/')) {
        return part;
      }
    }
  }
  return null;
}

async function downloadGeminiFile(uriOrId) {
  const raw = String(uriOrId || '');
  const fileId = raw.match(/files\/([^/:?]+)/)?.[1] || raw.replace(/^files\//, '');
  if (!fileId) throw new AiApiError('Generated video did not include a file id.');

  const deadline = Date.now() + AI_CONFIG.videoTimeoutMs;
  while (Date.now() < deadline) {
    const infoRes = await geminiFetch(`/files/${fileId}`);
    const info = await infoRes.json().catch(() => ({}));
    const state = info.state || info.file?.state;
    if (state === 'FAILED') throw new AiApiError(info.error?.message || 'Gemini video file failed.');
    if (state === 'ACTIVE' || infoRes.ok === false) break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  const download = await geminiFetch(`/files/${fileId}:download?alt=media`);
  if (!download.ok) {
    throw mapHttpError(download.status, await download.text());
  }
  return Buffer.from(await download.arrayBuffer());
}

async function generateOmniVideo({ prompt, aspectRatio, durationSeconds }) {
  const ratio = aspectRatio === '16:9' ? '16:9' : '9:16';
  const seconds = Math.min(10, Math.max(3, Number(durationSeconds) || 6));
  const models = [...new Set([AI_CONFIG.videoModel, 'gemini-omni-1.1-flash', 'gemini-omni-flash-preview'])]
    .filter((name) => /omni/i.test(name));
  let lastError;

  for (const model of models) {
    try {
      const start = await geminiFetch('/interactions', {
        method: 'POST',
        body: JSON.stringify({
          model,
          input: prompt,
          background: true,
          store: true,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: ratio,
            resolution: '720p',
            duration: `${seconds}s`,
            delivery: 'uri',
          },
          generation_config: {
            video_config: { task: 'text_to_video' },
          },
        }),
      });
      const startText = await start.text();
      if (!start.ok) {
        lastError = mapHttpError(start.status, startText);
        logger.warn(`Omni ${model} failed: ${startText.slice(0, 240)}`);
        if (start.status === 429) throw lastError;
        continue;
      }

      let data = JSON.parse(startText);
      const interactionId = data.id;
      const deadline = Date.now() + AI_CONFIG.videoTimeoutMs;
      while (data.status && !['completed', 'failed', 'cancelled'].includes(data.status) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const poll = await geminiFetch(`/interactions/${encodeURIComponent(interactionId)}`);
        const pollText = await poll.text();
        if (!poll.ok) {
          if (poll.status === 429) {
            await new Promise((r) => setTimeout(r, 8000));
            continue;
          }
          lastError = mapHttpError(poll.status, pollText);
          break;
        }
        data = JSON.parse(pollText);
      }

      if (data.status === 'failed' || data.status === 'cancelled') {
        lastError = new AiApiError(data.error?.message || 'Gemini Omni video failed.');
        continue;
      }

      const video = extractInteractionVideo(data);
      if (video?.data) {
        return {
          videoUrl: persistVideoBuffer(Buffer.from(video.data, 'base64'), video.mime_type || 'video/mp4'),
          model,
          prompt,
          aspectRatio: ratio,
          durationSeconds: seconds,
          mediaType: 'video',
        };
      }
      if (video?.uri) {
        const buffer = await downloadGeminiFile(video.uri);
        return {
          videoUrl: persistVideoBuffer(buffer, video.mime_type || 'video/mp4'),
          sourceUri: video.uri,
          model,
          prompt,
          aspectRatio: ratio,
          durationSeconds: seconds,
          mediaType: 'video',
        };
      }
      lastError = new AiApiError('Gemini Omni finished but returned no video file.');
    } catch (err) {
      lastError = wrapProviderError(err);
    }
  }

  throw lastError || new AiApiError('Gemini Omni video is not available for this API key.');
}

async function generateVeoVideo({ prompt, aspectRatio, durationSeconds }) {
  const models = [
    'veo-3.1-lite-generate-preview',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-generate-preview',
  ];
  const seconds = [4, 6, 8].includes(Number(durationSeconds)) ? Number(durationSeconds) : 8;
  const ratio = aspectRatio === '16:9' ? '16:9' : '9:16';
  let lastError;

  for (const model of models) {
    try {
      const start = await geminiFetch(`/models/${model}:predictLongRunning`, {
        method: 'POST',
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            aspectRatio: ratio,
            durationSeconds: seconds,
            sampleCount: 1,
          },
        }),
      });
      const startText = await start.text();
      if (!start.ok) {
        lastError = mapHttpError(start.status, startText);
        logger.warn(`Veo model ${model} failed: ${startText.slice(0, 240)}`);
        if (start.status === 429) throw lastError;
        continue;
      }

      const started = JSON.parse(startText);
      const operationName = started.name;
      if (!operationName) {
        lastError = new AiApiError('Gemini video start did not return an operation.');
        continue;
      }

      const deadline = Date.now() + AI_CONFIG.videoTimeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const poll = await geminiFetch(`/${operationName}`);
        const pollData = await poll.json();
        if (pollData.error) {
          throw new AiApiError(pollData.error.message || 'Gemini video generation failed.');
        }
        if (!pollData.done) continue;

        const sample =
          pollData.response?.generateVideoResponse?.generatedSamples?.[0] ||
          pollData.response?.generatedSamples?.[0];
        const uri = sample?.video?.uri || sample?.video?.url;
        const b64 = sample?.video?.bytesBase64Encoded;

        if (b64) {
          return {
            videoUrl: persistVideoBuffer(Buffer.from(b64, 'base64')),
            model,
            prompt,
            aspectRatio: ratio,
            durationSeconds: seconds,
            mediaType: 'video',
          };
        }
        if (uri) {
          return {
            videoUrl: persistVideoBuffer(await downloadGeminiFile(uri)),
            sourceUri: uri,
            model,
            prompt,
            aspectRatio: ratio,
            durationSeconds: seconds,
            mediaType: 'video',
          };
        }
        throw new AiApiError('Gemini finished video generation but returned no file.');
      }
      throw new AiApiError('Gemini video generation timed out. Try a shorter prompt.');
    } catch (err) {
      lastError = wrapProviderError(err);
    }
  }

  throw lastError || new AiApiError('Gemini Veo video is not enabled for this API key.');
}

export async function generateGeminiImage({ prompt, aspectRatio = '1:1' }) {
  const models = [
    AI_CONFIG.imageModel,
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-lite-image',
    'gemini-2.5-flash-image',
  ];
  let lastError;
  for (const model of [...new Set(models)]) {
    try {
      const result = await callGeminiContent({
        systemPrompt:
          'You generate a single high-quality social media image. Prefer photorealistic marketing visuals. Do not include watermarks.',
        userPrompt: `Create a social media ${aspectRatio} image for: ${prompt}`,
        responseFormat: 'text',
        model,
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio },
        },
      });
      if (result.images?.[0]) {
        return { imageUrl: result.images[0], model, prompt };
      }
    } catch (err) {
      lastError = err;
      logger.warn(`Image model ${model} failed: ${err.message}`);
      if (/no video\/image quota|limit: 0|429/i.test(err.message || '')) break;
    }
  }
  throw lastError || new AiApiError('Gemini image generation is not available for this API key.');
}

export async function generateGeminiSpeech({ text, language = 'English' }) {
  const spoken = String(text || '').trim();
  if (!spoken) {
    throw new AiApiError('Voiceover text is required.');
  }
  const models = [
    process.env.GEMINI_TTS_MODEL,
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
  ].filter(Boolean);
  let lastError;
  for (const model of [...new Set(models)]) {
    try {
      const result = await callGeminiContent({
        systemPrompt: `Speak the user's script clearly in ${language}. Do not add extra words.`,
        userPrompt: spoken.slice(0, 1200),
        responseFormat: 'text',
        model,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
      const audioPart = result.raw?.candidates?.[0]?.content?.parts?.find(
        (part) => part.inlineData?.data && String(part.inlineData.mimeType || '').startsWith('audio')
      );
      if (audioPart?.inlineData?.data) {
        const mimeType = audioPart.inlineData.mimeType || 'audio/mp3';
        return {
          audioUrl: persistVideoBuffer(Buffer.from(audioPart.inlineData.data, 'base64'), mimeType),
          model,
          mimeType,
        };
      }
      lastError = new AiApiError('Gemini TTS returned no audio.');
    } catch (err) {
      lastError = err;
      logger.warn(`TTS model ${model} failed: ${err.message}`);
      if (/no video\/image quota|limit: 0|429/i.test(err.message || '')) break;
    }
  }
  throw lastError || new AiApiError('Gemini speech is not available for this API key.');
}

export async function generateGeminiVideo({ prompt, aspectRatio = '9:16', durationSeconds = 8 }) {
  let lastError;
  try {
    return await generateOmniVideo({ prompt, aspectRatio, durationSeconds });
  } catch (err) {
    lastError = err;
    logger.warn(`Omni video unavailable: ${err.message}`);
    if (/no video\/image quota|limit: 0/i.test(err.message || '')) {
      throw lastError;
    }
  }
  try {
    return await generateVeoVideo({ prompt, aspectRatio, durationSeconds });
  } catch (err) {
    lastError = err;
    logger.warn(`Veo video unavailable: ${err.message}`);
  }
  throw lastError || new AiApiError('Gemini video is not enabled for this API key.');
}

export async function proxyGeminiMedia(uri) {
  const res = await geminiFetch(uri);
  if (!res.ok) {
    throw new AiApiError('Could not download generated Gemini media.', res.status);
  }
  const contentType = res.headers.get('content-type') || 'video/mp4';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { contentType, buffer };
}
