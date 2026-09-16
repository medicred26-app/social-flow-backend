import { callLlmProvider, AiConfigError, AiApiError } from './ai.provider.js';
import { supabase } from '../shared/utils/supabase.js';
import { createLogger } from '../middleware/logger.js';

const logger = createLogger('AIService');
const aiGenerationsDb = [];

export class AiService {
  /**
   * AI Post Enhancer
   */
  async enhancePost({ text, platform = 'instagram', tone = 'professional', goal = 'engagement', brandContext = {}, userId = 'demo-user' }) {
    if (!text || !text.trim()) {
      throw new Error('Post content is required for AI enhancement.');
    }

    const systemPrompt = `You are an expert social media copywriter specializing in high-performing content for ${platform}.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "improved_caption": "The full polished post text incorporating hook, body, and CTA tailored for ${platform}",
  "hook": "An attention-grabbing initial 1-2 sentence hook",
  "cta": "A strong call-to-action aligned with ${goal}",
  "hashtags": ["3 to 8 relevant hashtags"],
  "suggestions": ["2 specific strategy tips on why these improvements will boost ${goal}"]
}
Tone: ${tone} | Goal: ${goal}`;

    const userPrompt = `Raw post content to enhance:\n"${text}"`;
    const result = await callLlmProvider({ systemPrompt, userPrompt, responseFormat: 'json' });

    const formatted = {
      improved_caption: result.improved_caption || text,
      hook: result.hook || '',
      cta: result.cta || '',
      hashtags: Array.isArray(result.hashtags) ? result.hashtags : [],
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : []
    };

    this.recordGeneration({ userId, type: 'post_enhancer', platform, tone, goal, inputContent: text, outputContent: formatted })
      .catch(err => logger.warn('DB record error:', err.message));

    return formatted;
  }

  /**
   * AI Caption Generator
   */
  async generateCaption({ topic, platform = 'instagram', tone = 'friendly', goal = 'engagement', keywords = [] }) {
    const systemPrompt = `You are a viral social media content creator. Generate a complete, ready-to-publish post caption for ${platform}.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "caption": "Full viral caption with emojis and paragraph breaks",
  "hook": "Scroll-stopping first line",
  "cta": "Engaging closing call-to-action",
  "hashtags": ["5 to 10 trending hashtags"],
  "estimated_virality_score": 88
}`;

    const userPrompt = `Topic/Concept: ${topic}\nTarget Platform: ${platform}\nTone: ${tone}\nGoal: ${goal}\nKeywords: ${keywords.join(', ')}`;
    const result = await callLlmProvider({ systemPrompt, userPrompt, responseFormat: 'json' });

    this.recordGeneration({ userId: 'demo-user', type: 'caption_generator', platform, tone, goal, inputContent: topic, outputContent: result })
      .catch(err => logger.warn('DB record error:', err.message));

    return result;
  }

  /**
   * Platform-Specific Multi-Channel Rewriter
   */
  async platformRewrite({ text }) {
    const systemPrompt = `Rewrite the input text into optimized posts tailored for 5 major social networks.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "facebook": "Engaging Facebook post format with storytelling and link placement callout",
  "instagram": "Instagram aesthetic post with spacing, emojis, and hashtags",
  "x": "Punchy X/Twitter tweet under 280 characters with strong hook",
  "linkedin": "Professional LinkedIn thought-leadership post with line breaks",
  "youtube": "YouTube video description format with timestamp placeholders and keywords"
}`;

    const userPrompt = `Input Content:\n"${text}"`;
    const result = await callLlmProvider({ systemPrompt, userPrompt, responseFormat: 'json' });

    this.recordGeneration({ userId: 'demo-user', type: 'platform_rewrite', platform: 'all', tone: 'adaptive', goal: 'cross_posting', inputContent: text, outputContent: result })
      .catch(err => logger.warn('DB record error:', err.message));

    return result;
  }

  /**
   * AI Post Scoring & Quality Audit
   */
  async scorePost({ text, platform = 'instagram' }) {
    const systemPrompt = `Analyze the post for ${platform} and provide an objective quality audit score from 0 to 100.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "overall_score": 85,
  "hook_strength": 90,
  "readability": 80,
  "virality_potential": 85,
  "cta_effectiveness": 80,
  "strengths": ["Clear value prop", "Good emoji placement"],
  "improvements": ["Add a question to boost comments", "Shorten 2nd paragraph"]
}`;

    const userPrompt = `Post text to score:\n"${text}"`;
    return await callLlmProvider({ systemPrompt, userPrompt, responseFormat: 'json' });
  }

  /**
   * Automatic Content Ideas Generator
   */
  async generateContentIdeas({ niche = 'Technology & Marketing', targetAudience = 'Creators & Businesses', count = 5 }) {
    const systemPrompt = `Generate ${count} high-performing viral content ideas for social media.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "ideas": [
    {
      "title": "Content Idea Title",
      "format": "Reels / Carousel / Thread / Short",
      "hook_angle": "Exact hook sentence to use",
      "key_takeaway": "What value it delivers"
    }
  ]
}`;

    const userPrompt = `Niche: ${niche}\nTarget Audience: ${targetAudience}`;
    return await callLlmProvider({ systemPrompt, userPrompt, responseFormat: 'json' });
  }

  /**
   * AI SEO & Keyword Assistant
   */
  async seoAssistant({ topic, platform = 'youtube' }) {
    const systemPrompt = `Perform social SEO keyword research and optimization for ${platform}.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "seo_title": "Search-optimized title",
  "meta_description": "Search intent description",
  "primary_keywords": ["keyword 1", "keyword 2"],
  "longtail_keywords": ["longtail 1", "longtail 2"],
  "ranking_hashtags": ["#tag1", "#tag2"],
  "seo_tips": ["Tip 1", "Tip 2"]
}`;

    const userPrompt = `Topic/Keyword Focus: ${topic}\nTarget Platform: ${platform}`;
    return await callLlmProvider({ systemPrompt, userPrompt, responseFormat: 'json' });
  }

  /**
   * AI Content Repurposer
   */
  async repurposeContent({ sourceContent, sourceType = 'article' }) {
    const systemPrompt = `Repurpose the input ${sourceType} into a multi-channel social media pack.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "tweet_thread": ["Tweet 1 hook", "Tweet 2 core point", "Tweet 3 takeaway/CTA"],
  "linkedin_article_summary": "Professional LinkedIn summary",
  "instagram_carousel_slides": ["Slide 1 Title", "Slide 2 Main Point", "Slide 3 CTA"],
  "short_video_script": "30-second video script with visual cues"
}`;

    const userPrompt = `Source Content:\n"${sourceContent}"`;
    return await callLlmProvider({ systemPrompt, userPrompt, responseFormat: 'json' });
  }

  /**
   * Weekly AI Marketing Report
   */
  async generateWeeklyReport({ performanceSummary = 'High engagement on Instagram and LinkedIn this week.' }) {
    const systemPrompt = `Generate an executive weekly AI marketing report.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "executive_summary": "Overall social performance summary for the week",
  "key_wins": ["15% increase in follower reach", "Top post gained 400+ shares"],
  "areas_to_improve": ["Video posts needed on YouTube", "Post timing adjustment"],
  "next_week_strategy": ["Publish 3 Reels on Tuesday/Thursday", "Run Q&A session on LinkedIn"],
  "recommended_topics": ["Industry trends 2026", "Behind the scenes tutorial"]
}`;

    const userPrompt = `Performance context:\n"${performanceSummary}"`;
    return await callLlmProvider({ systemPrompt, userPrompt, responseFormat: 'json' });
  }

  /**
   * Best Posting Time Calculator
   */
  async calculateBestTimes({ timezone = 'UTC' }) {
    return {
      facebook: { best_days: ['Wednesday', 'Friday'], optimal_time: '1:00 PM', engagement_lift: '+24%' },
      instagram: { best_days: ['Monday', 'Wednesday', 'Thursday'], optimal_time: '11:00 AM & 7:00 PM', engagement_lift: '+38%' },
      youtube: { best_days: ['Thursday', 'Friday', 'Saturday'], optimal_time: '3:00 PM', engagement_lift: '+31%' },
      x: { best_days: ['Tuesday', 'Wednesday'], optimal_time: '9:00 AM', engagement_lift: '+18%' },
      linkedin: { best_days: ['Tuesday', 'Wednesday', 'Thursday'], optimal_time: '8:00 AM & 12:00 PM', engagement_lift: '+42%' }
    };
  }

  async recordGeneration({ userId, type, platform, tone, goal, inputContent, outputContent }) {
    const record = {
      id: `aigen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      user_id: userId,
      type,
      platform,
      tone,
      goal,
      input_content: inputContent,
      output_content: JSON.stringify(outputContent),
      created_at: new Date().toISOString()
    };

    aiGenerationsDb.unshift(record);

    try {
      if (supabase) {
        await supabase.from('ai_generations').insert({
          id: record.id,
          user_id: userId,
          type,
          platform,
          input_content: inputContent,
          output_content: outputContent,
          created_at: record.created_at
        });
      }
    } catch (err) {
      logger.warn('[Supabase AI Sync] Note: Table ai_generations error:', err.message);
    }

    return record;
  }
}

export const aiService = new AiService();
