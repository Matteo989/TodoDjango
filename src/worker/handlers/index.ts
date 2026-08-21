import type { JobType } from '@prisma/client';
import { generateIdeas } from '@/server/services/ideas';
import { generateScripts, runFactCheck } from '@/server/services/scripts';
import { generateStoryboard } from '@/server/services/storyboard';
import { generateVoice } from '@/server/services/voice';
import { generateCaptions } from '@/server/services/captions';
import { generateSceneVideos, renderVideo } from '@/server/services/render';
import { runQualityControl } from '@/server/services/quality';
import { publishVideo } from '@/server/services/publishing';
import { fetchAnalytics } from '@/server/services/analytics';
import { updateProgress, type JobCompletion } from '@/server/services/jobs';

export interface HandlerContext {
  jobId: string;
  workspaceId: string;
  payload: Record<string, unknown>;
  reportProgress: (percent: number) => Promise<void>;
}

export type Handler = (ctx: HandlerContext) => Promise<JobCompletion>;

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`Paramètre manquant dans le job: ${key}`);
  }
  return value;
}

function optionalNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' ? value : undefined;
}

export const HANDLERS: Record<JobType, Handler> = {
  GENERATE_IDEAS: async (ctx) => {
    const result = await generateIdeas({
      workspaceId: ctx.workspaceId,
      niche: (ctx.payload['niche'] as string) ?? 'DIY / bricolage / maison',
      subNiche: ctx.payload['subNiche'] as string | undefined,
      count: optionalNumber(ctx.payload, 'count') ?? 5,
      language: (ctx.payload['language'] as string) ?? 'fr',
      targetDurationSec: optionalNumber(ctx.payload, 'targetDurationSec') ?? 45,
      difficulty: (ctx.payload['difficulty'] as never) ?? 'BEGINNER',
      budgetCents: optionalNumber(ctx.payload, 'budgetCents') ?? 5000,
      goal: (ctx.payload['goal'] as never) ?? 'VIRALITY',
    });
    return {
      provider: result.provider,
      model: result.model,
      promptVersion: 'ideas-v2',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents: result.usage.costCents,
      result: { ideaIds: result.ideaIds, isLive: result.isLive },
    };
  },

  GENERATE_SCRIPT: async (ctx) => {
    const result = await generateScripts({
      workspaceId: ctx.workspaceId,
      ideaId: requireString(ctx.payload, 'ideaId'),
      targetDurationSec: optionalNumber(ctx.payload, 'targetDurationSec') ?? 45,
      platform: ctx.payload['platform'] as never,
      audience: ctx.payload['audience'] as string | undefined,
      technicalLevel: ctx.payload['technicalLevel'] as never,
      language: ctx.payload['language'] as string | undefined,
    });
    return {
      provider: result.provider,
      model: result.model,
      promptVersion: 'script-v2',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents: result.usage.costCents,
      result: {
        scriptIds: result.scriptIds,
        isLive: result.isLive,
        safetyTopics: result.safetyTopics,
      },
    };
  },

  GENERATE_STORYBOARD: async (ctx) => {
    const result = await generateStoryboard({
      workspaceId: ctx.workspaceId,
      videoId: requireString(ctx.payload, 'videoId'),
    });
    return {
      provider: result.provider,
      model: result.model,
      promptVersion: 'storyboard-v1',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents: result.usage.costCents,
      result: { sceneCount: result.sceneCount, totalDurationMs: result.totalDurationMs },
    };
  },

  FACT_CHECK: async (ctx) => {
    const result = await runFactCheck(ctx.workspaceId, requireString(ctx.payload, 'scriptId'));
    return {
      provider: result.provider,
      model: result.model,
      promptVersion: 'factcheck-v1',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents: result.usage.costCents,
      result: { claimCount: result.claims.length },
    };
  },

  GENERATE_VOICE: async (ctx) => {
    const result = await generateVoice({
      workspaceId: ctx.workspaceId,
      videoId: requireString(ctx.payload, 'videoId'),
      voiceId: ctx.payload['voiceId'] as string | undefined,
      language: ctx.payload['language'] as string | undefined,
      speed: optionalNumber(ctx.payload, 'speed'),
      stability: optionalNumber(ctx.payload, 'stability'),
      tone: ctx.payload['tone'] as string | undefined,
      format: (ctx.payload['format'] as 'mp3' | 'wav' | undefined) ?? 'mp3',
    });
    return {
      provider: result.provider,
      costCents: result.costCents,
      result: {
        voiceTrackId: result.voiceTrackId,
        durationMs: result.durationMs,
        isLive: result.isLive,
      },
    };
  },

  GENERATE_CAPTIONS: async (ctx) => {
    const result = await generateCaptions({
      workspaceId: ctx.workspaceId,
      videoId: requireString(ctx.payload, 'videoId'),
      style: ctx.payload['style'] as never,
    });
    return { result: { cueCount: result.cueCount, method: result.method, keys: result.keys } };
  },

  GENERATE_VIDEO: async (ctx) => {
    const result = await generateSceneVideos({
      workspaceId: ctx.workspaceId,
      videoId: requireString(ctx.payload, 'videoId'),
      onProgress: (p) => void ctx.reportProgress(p),
    });
    return {
      provider: result.provider,
      costCents: result.costCents,
      result: { generated: result.generated, isLive: result.isLive },
    };
  },

  RENDER_VIDEO: async (ctx) => {
    const result = await renderVideo({
      workspaceId: ctx.workspaceId,
      videoId: requireString(ctx.payload, 'videoId'),
      preset: (ctx.payload['preset'] as 'draft' | 'final' | undefined) ?? 'final',
      onProgress: (p) => void ctx.reportProgress(p),
    });
    return { provider: 'ffmpeg', result: { ...result } };
  },

  ANALYZE_VIDEO: async (ctx) => {
    const result = await runQualityControl(ctx.workspaceId, requireString(ctx.payload, 'videoId'));
    return { result: { score: result.score, passed: result.passed } };
  },

  PUBLISH_VIDEO: async (ctx) => {
    const result = await publishVideo({
      workspaceId: ctx.workspaceId,
      publicationId: requireString(ctx.payload, 'publicationId'),
    });
    return { provider: result.provider, result: { ...result } };
  },

  FETCH_ANALYTICS: async (ctx) => {
    const result = await fetchAnalytics({
      workspaceId: ctx.workspaceId,
      publicationId: ctx.payload['publicationId'] as string | undefined,
    });
    return { result: { ...result } };
  },
};

export { updateProgress };
