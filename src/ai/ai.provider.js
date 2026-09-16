import { AI_CONFIG } from './ai.config.js';
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

export async function callLlmProvider({ systemPrompt, userPrompt, responseFormat = 'json' }) {
  const apiKey = AI_CONFIG.apiKey;

  if (!apiKey || apiKey.includes('your-') || apiKey === 'YOUR_AI_API_KEY') {
    logger.warn('AI API Call attempted without a valid AI_API_KEY configured');
    throw new AiConfigError('AI Provider is not configured. Please add AI_API_KEY to backend/.env.');
  }

  const endpoint = `${AI_CONFIG.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);

  const payload = {
    model: AI_CONFIG.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7
  };

  if (responseFormat === 'json') {
    payload.response_format = { type: 'json_object' };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      logger.error(`AI API Provider HTTP error ${res.status}:`, errText);
      
      if (res.status === 401 || res.status === 403) {
        throw new AiApiError('Invalid AI_API_KEY provided. Please check credentials in backend/.env.', res.status);
      } else if (res.status === 429) {
        throw new AiApiError('AI Provider rate limit exceeded. Please try again in a few moments.', res.status);
      } else {
        throw new AiApiError(`AI Provider error (${res.status}): Unable to complete enhancement.`, res.status);
      }
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new AiApiError('AI Provider returned an empty response.');
    }

    if (responseFormat === 'json') {
      try {
        return JSON.parse(content);
      } catch (parseErr) {
        logger.error('Failed to parse JSON response from AI provider', content);
        throw new AiApiError('AI Provider response was not valid JSON.');
      }
    }

    return content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new AiApiError('AI Request timed out. Please try again.');
    }
    if (err instanceof AiConfigError || err instanceof AiApiError) {
      throw err;
    }
    logger.error('Unexpected error calling AI Provider:', err);
    throw new AiApiError(err.message || 'Failed to connect to AI provider.');
  }
}
