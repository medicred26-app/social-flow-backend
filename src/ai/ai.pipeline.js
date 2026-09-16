import { callLlmProvider, generateGeminiImage, generateGeminiSpeech, generateGeminiVideo } from './ai.provider.js';
import { createPipelineStages, setPipelineStage } from './ai.stages.js';
import { createLogger } from '../middleware/logger.js';

const logger = createLogger('VideoPipeline');

const SCENE_COLORS = ['#4f46e5', '#7c3aed', '#db2777', '#059669', '#ea580c'];

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function normalizeBrief(input = {}) {
  const script = String(input.script || input.prompt || '').trim();
  const platforms = Array.isArray(input.platforms) && input.platforms.length
    ? input.platforms.map((item) => String(item).toLowerCase())
    : ['youtube', 'instagram', 'facebook'];
  return {
    script,
    title: String(input.title || '').trim(),
    presenter: ['ai_avatar', 'screen', 'animation'].includes(input.presenter) ? input.presenter : 'animation',
    language: String(input.language || 'English').trim() || 'English',
    tone: String(input.tone || 'energetic').trim() || 'energetic',
    platforms,
    durationSeconds: clamp(input.durationSeconds, 8, 60),
    aspectRatio: ['9:16', '16:9', '1:1'].includes(input.aspectRatio) ? input.aspectRatio : '9:16',
    brandName: String(input.brandName || 'SocialFlow').trim() || 'SocialFlow',
    referenceNotes: String(input.referenceNotes || '').trim(),
  };
}

function fallbackPlan(brief) {
  const chunk = Math.max(3, Math.round(brief.durationSeconds / 4));
  const lines = brief.script
    .split(/[\n.!?]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
  const beats = lines.length ? lines : [
    brief.script.slice(0, 80) || 'Open with the hook',
    'Show the problem your product solves',
    'Reveal the payoff in one clear visual',
    'Close with a direct call to action',
  ];
  const headings = ['HOOK', 'PROBLEM', 'PAYOFF', 'CTA'];
  return {
    title: brief.title || `${brief.brandName} launch reel`,
    summary: brief.script.slice(0, 180),
    language: brief.language,
    presenterMode: brief.presenter,
    totalDurationSeconds: brief.durationSeconds,
    productionPlan: [
      'Break the script into timed scenes',
      'Generate visuals for each scene',
      'Add captions and a voiceover track',
      'Assemble 9:16, 16:9, and 1:1 cuts',
    ],
    voiceoverScript: brief.script,
    caption: brief.script.slice(0, 220),
    hook: beats[0],
    cta: 'Follow for the full walkthrough',
    hashtags: ['#SocialFlow', '#AIVideo', '#ContentStudio'],
    scenes: beats.map((line, index) => ({
      id: `s${index + 1}`,
      heading: headings[index] || `SCENE ${index + 1}`,
      startSeconds: index * chunk,
      endSeconds: (index + 1) * chunk,
      sceneType: brief.presenter === 'screen' ? 'screen' : brief.presenter === 'ai_avatar' ? 'presenter' : 'animation',
      line,
      visual: line,
      voiceover: line,
      presenterAction: brief.presenter === 'ai_avatar' ? 'Presenter speaks to camera' : 'Graphic motion fill',
      transition: index === 0 ? 'fade' : 'cut',
      color: SCENE_COLORS[index % SCENE_COLORS.length],
    })),
  };
}

async function planScenes(brief) {
  try {
    const result = await callLlmProvider({
      systemPrompt: `You are a social video director. Turn one script into a timed production plan.
STRICT JSON OUTPUT FORMAT ONLY:
{
  "title":"6 to 8 word title",
  "summary":"one sentence summary",
  "language":"${brief.language}",
  "presenterMode":"${brief.presenter}",
  "totalDurationSeconds":${brief.durationSeconds},
  "productionPlan":["step 1","step 2","step 3","step 4"],
  "voiceoverScript":"full spoken voiceover in ${brief.language}",
  "caption":"publish-ready caption",
  "hook":"first on-screen line",
  "cta":"closing call to action",
  "hashtags":["tag1","tag2","tag3"],
  "scenes":[
    {
      "id":"s1",
      "heading":"HOOK",
      "startSeconds":0,
      "endSeconds":4,
      "sceneType":"presenter|screen|animation",
      "line":"on-screen text",
      "visual":"what image or clip to generate",
      "voiceover":"spoken line",
      "presenterAction":"what the presenter or graphic does",
      "transition":"cut|fade|zoom",
      "color":"#4f46e5"
    }
  ]
}
Use 3 to 5 scenes. Scene times must add up to about ${brief.durationSeconds} seconds.`,
      userPrompt: `Brand: ${brief.brandName}
Presenter: ${brief.presenter}
Language: ${brief.language}
Tone: ${brief.tone}
Aspect: ${brief.aspectRatio}
Platforms: ${brief.platforms.join(', ')}
Duration: ${brief.durationSeconds}s
Reference notes: ${brief.referenceNotes || 'none'}
Script:
${brief.script}`,
    });
    if (!result || !Array.isArray(result.scenes) || !result.scenes.length) {
      return fallbackPlan(brief);
    }
    return {
      ...fallbackPlan(brief),
      ...result,
      scenes: result.scenes.slice(0, 5).map((scene, index) => ({
        id: scene.id || `s${index + 1}`,
        heading: scene.heading || `SCENE ${index + 1}`,
        startSeconds: Number(scene.startSeconds) || index * 4,
        endSeconds: Number(scene.endSeconds) || (index + 1) * 4,
        sceneType: scene.sceneType || (brief.presenter === 'ai_avatar' ? 'presenter' : 'animation'),
        line: scene.line || scene.voiceover || brief.script,
        visual: scene.visual || scene.line || brief.script,
        voiceover: scene.voiceover || scene.line || '',
        presenterAction: scene.presenterAction || '',
        transition: scene.transition || 'cut',
        color: scene.color || SCENE_COLORS[index % SCENE_COLORS.length],
      })),
    };
  } catch (err) {
    logger.warn('Scene planning fell back to a local breakdown:', err.message);
    return fallbackPlan(brief);
  }
}

async function generateSceneImages(plan, aspectRatio) {
  const scenes = plan.scenes.slice(0, 4);
  const images = await Promise.all(
    scenes.map(async (scene) => {
      try {
        const image = await generateGeminiImage({
          prompt: `${plan.title}. ${scene.visual}. ${scene.presenterAction || ''}`.trim(),
          aspectRatio,
        });
        return { id: scene.id, imageUrl: image.imageUrl, model: image.model };
      } catch (err) {
        logger.warn(`Scene image skipped (${scene.id}): ${err.message}`);
        return { id: scene.id, imageUrl: '', error: err.message };
      }
    })
  );
  return images;
}

export async function runVideoPipeline(input = {}, onProgress = () => {}) {
  const brief = normalizeBrief(input);
  if (!brief.script) {
    throw new Error('A script or video prompt is required.');
  }

  let stages = createPipelineStages();
  const progress = (id, message) => {
    stages = setPipelineStage(stages, id, 'running');
    onProgress({ stage: id, stages, message, status: 'running' });
  };
  const complete = (id, message) => {
    stages = setPipelineStage(stages, id, 'done');
    onProgress({ stage: id, stages, message, status: 'running' });
  };

  progress('input', 'Collecting script, presenter, language, and platforms...');
  complete('input', 'Brief locked. Planning scenes with Gemini...');

  progress('plan', 'Gemini is breaking the script into timed scenes...');
  const plan = await planScenes(brief);
  complete('plan', `Planned ${plan.scenes.length} scenes. Generating assets...`);

  progress('assets', 'Generating visuals, motion clip, and voiceover...');
  const [sceneImages, cinematic, speech] = await Promise.all([
    generateSceneImages(plan, brief.aspectRatio),
    generateGeminiVideo({
      prompt: `${plan.title}. ${plan.summary || brief.script}. Style: ${brief.presenter}, ${brief.tone}, ${brief.language}.`,
      aspectRatio: brief.aspectRatio === '1:1' ? '9:16' : brief.aspectRatio,
      durationSeconds: Math.min(8, brief.durationSeconds),
    }).catch((err) => {
      logger.warn('Cinematic clip unavailable:', err.message);
      return { error: err.message };
    }),
    generateGeminiSpeech({
      text: plan.voiceoverScript || plan.scenes.map((scene) => scene.voiceover).filter(Boolean).join('. '),
      language: brief.language,
    }).catch((err) => {
      logger.warn('Voiceover skipped:', err.message);
      return { error: err.message };
    }),
  ]);

  const scenes = plan.scenes.map((scene) => {
    const image = sceneImages.find((item) => item.id === scene.id);
    return {
      ...scene,
      imageUrl: image?.imageUrl || '',
    };
  });

  const assetNotes = [];
  if (cinematic?.videoUrl) assetNotes.push(`Motion clip: ${cinematic.model}`);
  else assetNotes.push('Motion clip: storyboard fallback (Veo/Omni quota unavailable)');
  if (speech?.audioUrl) assetNotes.push(`Voiceover: ${speech.model}`);
  else assetNotes.push('Voiceover: on-screen captions (TTS quota unavailable)');
  if (sceneImages.some((item) => item.imageUrl)) {
    assetNotes.push(`Scene stills: ${sceneImages.filter((item) => item.imageUrl).length}`);
  } else {
    assetNotes.push('Scene stills: color boards (image quota unavailable)');
  }
  complete('assets', assetNotes.join(' · '));

  progress('assemble', 'Building the edit list, captions, and output formats...');
  const assembly = {
    title: plan.title,
    brandName: brief.brandName,
    language: brief.language,
    presenter: brief.presenter,
    durationSeconds: plan.totalDurationSeconds || brief.durationSeconds,
    masterAspectRatio: brief.aspectRatio,
    formats: [
      { aspectRatio: '9:16', label: 'Reels / Shorts / TikTok' },
      { aspectRatio: '16:9', label: 'YouTube landscape' },
      { aspectRatio: '1:1', label: 'Feed / Facebook' },
    ],
    transitions: scenes.map((scene) => scene.transition || 'cut'),
    captions: scenes.map((scene) => ({
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      text: scene.line,
    })),
    clips: scenes.map((scene, index) => ({
      order: index + 1,
      heading: scene.heading,
      visual: scene.visual,
      imageUrl: scene.imageUrl,
      voiceover: scene.voiceover,
      color: scene.color,
    })),
  };
  complete('assemble', 'Edit list ready. Storing the review package...');

  progress('store', 'Saving the review package before publish...');
  const review = {
    status: 'pending_review',
    keepDays: 30,
    downloadable: true,
    approvedForPublish: false,
  };
  complete('store', 'Package stored. Preparing platform publish copies...');

  progress('publish', 'Writing YouTube, Instagram, Facebook, and TikTok packages...');
  const publishPackages = [
    {
      platform: 'youtube',
      format: '9:16 Short + 16:9',
      title: plan.title,
      caption: plan.caption,
      hashtags: plan.hashtags,
      ready: true,
    },
    {
      platform: 'instagram',
      format: '9:16 Reel',
      title: plan.title,
      caption: `${plan.hook || ''}\n\n${plan.caption || ''}`.trim(),
      hashtags: plan.hashtags,
      ready: true,
    },
    {
      platform: 'facebook',
      format: '1:1 or 16:9',
      title: plan.title,
      caption: plan.caption,
      hashtags: plan.hashtags,
      ready: true,
    },
    {
      platform: 'tiktok',
      format: '9:16',
      title: plan.title,
      caption: plan.caption,
      hashtags: plan.hashtags,
      ready: false,
      note: 'Caption is ready. TikTok connect is not enabled on this API yet.',
    },
  ].filter((item) => brief.platforms.includes(item.platform) || item.platform === 'tiktok');
  stages = setPipelineStage(stages, 'publish', 'done');

  const mediaType = cinematic?.videoUrl ? 'video' : scenes.some((scene) => scene.imageUrl) ? 'storyboard' : 'storyboard';
  const message = cinematic?.videoUrl
    ? `Pipeline finished with a ${cinematic.model} motion clip. Review, then send to Publisher.`
    : 'Pipeline finished with a Gemini scene plan and motion storyboard. Review, then send to Publisher.';

  return {
    provider: cinematic?.model || 'gemini-pipeline',
    mediaType,
    videoUrl: cinematic?.videoUrl || scenes.find((scene) => scene.imageUrl)?.imageUrl || '',
    sourceUri: cinematic?.sourceUri || '',
    thumbnailUrl: scenes.find((scene) => scene.imageUrl)?.imageUrl || '',
    audioUrl: speech?.audioUrl || '',
    aspectRatio: brief.aspectRatio,
    durationSeconds: assembly.durationSeconds,
    caption: plan.caption,
    hook: plan.hook,
    cta: plan.cta,
    hashtags: plan.hashtags,
    script: plan.voiceoverScript || brief.script,
    storyboard: {
      title: plan.title,
      scenes,
    },
    pipeline: {
      stages,
      brief,
      productionPlan: plan.productionPlan || [],
      assembly,
      review,
      publishPackages,
      assetNotes,
    },
    message,
  };
}
