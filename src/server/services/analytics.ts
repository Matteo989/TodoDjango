import type { Platform } from '@prisma/client';
import { prisma } from '../db';
import { completionRate, contentScore, engagementRate } from '@/lib/scoring';
import { aiProvider } from '../providers/registry';
import { ANALYSIS_SCHEMA_HINT, PROMPT_VERSIONS, SYSTEM_PROMPT } from './prompts';
import { z } from 'zod';

/**
 * Analytics (§21) et boucle d'apprentissage (§22).
 *
 * Aucune donnée n'est inventée: tant qu'aucune API n'est connectée, les mesures
 * sont saisies ou importées par l'utilisateur, et leur `source` le dit.
 */

export interface RecordAnalyticsInput {
  workspaceId: string;
  videoId: string;
  publicationId?: string;
  platform: Platform;
  measuredOn: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  followersGained: number;
  avgWatchMs: number;
  revenueCents?: number;
  source?: string;
}

export async function recordAnalytics(input: RecordAnalyticsInput) {
  const video = await prisma.video.findFirst({
    where: { id: input.videoId, workspaceId: input.workspaceId, deletedAt: null },
    select: { id: true, renderedDurationMs: true, targetDurationSec: true },
  });
  if (!video) throw new Error('Vidéo introuvable.');

  const durationMs = video.renderedDurationMs ?? video.targetDurationSec * 1000;

  const computed = {
    completionRate: completionRate(input.avgWatchMs, durationMs),
    engagementRate: engagementRate(input),
    contentScore: contentScore({ ...input, durationMs }),
  };

  const day = new Date(
    Date.UTC(
      input.measuredOn.getUTCFullYear(),
      input.measuredOn.getUTCMonth(),
      input.measuredOn.getUTCDate(),
    ),
  );

  const data = {
    videoId: video.id,
    publicationId: input.publicationId ?? null,
    platform: input.platform,
    measuredOn: day,
    views: input.views,
    likes: input.likes,
    comments: input.comments,
    shares: input.shares,
    followersGained: input.followersGained,
    avgWatchMs: input.avgWatchMs,
    revenueCents: input.revenueCents ?? 0,
    source: input.source ?? 'manual',
    ...computed,
  };

  // La contrainte d'unicité porte sur (publicationId, measuredOn); sans
  // publication rattachée, on crée une ligne autonome.
  if (input.publicationId) {
    return prisma.analytics.upsert({
      where: { publicationId_measuredOn: { publicationId: input.publicationId, measuredOn: day } },
      create: data,
      update: data,
    });
  }
  return prisma.analytics.create({ data });
}

/**
 * Aucune API d'analytics n'est configurée en phase 1: cette fonction le dit
 * explicitement plutôt que de renvoyer des chiffres fabriqués.
 */
export async function fetchAnalytics(params: {
  workspaceId: string;
  publicationId?: string;
}): Promise<{ imported: number; manualRequired: boolean; reason: string }> {
  void params;
  return {
    imported: 0,
    manualRequired: true,
    reason:
      "Aucune API d'analytics connectée. Saisissez les chiffres dans Analytics, ou importez un export CSV de la plateforme.",
  };
}

export interface DashboardStats {
  ideaCount: number;
  inProduction: number;
  finished: number;
  published: number;
  scheduled: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  followersGained: number;
  revenueCents: number;
  successRate: number;
}

const IN_PRODUCTION = ['STORYBOARD', 'VOICE', 'RENDERING'] as const;
const FINISHED = ['RENDERED', 'REVIEW', 'READY'] as const;

export async function dashboardStats(workspaceId: string): Promise<DashboardStats> {
  const [ideaCount, statusCounts, totals, scoredCount, goodCount] = await Promise.all([
    prisma.idea.count({ where: { workspaceId, deletedAt: null, status: { not: 'ARCHIVED' } } }),
    prisma.video.groupBy({
      by: ['status'],
      where: { workspaceId, deletedAt: null },
      _count: { id: true },
    }),
    prisma.analytics.aggregate({
      where: { video: { workspaceId } },
      _sum: {
        views: true,
        likes: true,
        comments: true,
        shares: true,
        followersGained: true,
        revenueCents: true,
      },
    }),
    prisma.analytics.count({ where: { video: { workspaceId } } }),
    prisma.analytics.count({ where: { video: { workspaceId }, contentScore: { gte: 60 } } }),
  ]);

  const byStatus = new Map(statusCounts.map((row) => [row.status, row._count.id]));
  const sumOf = (statuses: readonly string[]) =>
    statuses.reduce((sum, s) => sum + (byStatus.get(s as never) ?? 0), 0);

  return {
    ideaCount,
    inProduction: sumOf(IN_PRODUCTION),
    finished: sumOf(FINISHED),
    published: byStatus.get('PUBLISHED') ?? 0,
    scheduled: byStatus.get('SCHEDULED') ?? 0,
    views: totals._sum.views ?? 0,
    likes: totals._sum.likes ?? 0,
    comments: totals._sum.comments ?? 0,
    shares: totals._sum.shares ?? 0,
    followersGained: totals._sum.followersGained ?? 0,
    revenueCents: totals._sum.revenueCents ?? 0,
    // Taux de réussite: part des mesures dont le CONTENT_SCORE atteint 60.
    successRate: scoredCount > 0 ? Math.round((goodCount / scoredCount) * 100) : 0,
  };
}

export async function viewsPerDay(workspaceId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.analytics.groupBy({
    by: ['measuredOn'],
    where: { video: { workspaceId }, measuredOn: { gte: since } },
    _sum: { views: true, likes: true },
    orderBy: { measuredOn: 'asc' },
  });
  return rows.map((row) => ({
    date: row.measuredOn.toISOString().slice(0, 10),
    views: row._sum.views ?? 0,
    likes: row._sum.likes ?? 0,
  }));
}

export async function viewsPerPlatform(workspaceId: string) {
  const rows = await prisma.analytics.groupBy({
    by: ['platform'],
    where: { video: { workspaceId } },
    _sum: { views: true },
  });
  return rows.map((row) => ({ platform: row.platform, views: row._sum.views ?? 0 }));
}

export async function topVideos(workspaceId: string, take = 10) {
  const rows = await prisma.analytics.groupBy({
    by: ['videoId'],
    where: { video: { workspaceId } },
    _sum: { views: true },
    _max: { contentScore: true },
    orderBy: { _sum: { views: 'desc' } },
    take,
  });

  const videos = await prisma.video.findMany({
    where: { id: { in: rows.map((r) => r.videoId) } },
    select: { id: true, title: true, thumbnailKey: true, renderedDurationMs: true },
  });
  const byId = new Map(videos.map((v) => [v.id, v]));

  return rows.map((row) => ({
    videoId: row.videoId,
    title: byId.get(row.videoId)?.title ?? 'Vidéo supprimée',
    views: row._sum.views ?? 0,
    contentScore: row._max.contentScore ?? 0,
    durationMs: byId.get(row.videoId)?.renderedDurationMs ?? null,
  }));
}

// ─── Boucle d'apprentissage (§22) ────────────────────────────────────────────

const analysisSchema = z.object({
  summary: z.string().default(''),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  nextIdeas: z
    .array(z.object({ title: z.string(), hook: z.string().default(''), rationale: z.string().default('') }))
    .default([]),
});

export interface LearningInsight {
  /** Comparaisons chiffrées calculées en base, indépendamment de tout modèle. */
  patterns: Array<{ dimension: string; winner: string; multiplier: number; sampleSize: number }>;
  analysis: z.infer<typeof analysisSchema> | null;
  provider: string;
  isLive: boolean;
}

/**
 * Identifie ce qui fonctionne, puis demande de nouvelles idées fondées dessus.
 *
 * Les motifs sont calculés en SQL sur les mesures réelles: c'est la partie
 * fiable. Le modèle n'intervient qu'ensuite, pour proposer des angles.
 */
export async function learningInsights(workspaceId: string): Promise<LearningInsight> {
  const rows = await prisma.analytics.findMany({
    where: { video: { workspaceId } },
    select: {
      views: true,
      contentScore: true,
      video: {
        select: {
          id: true,
          renderedDurationMs: true,
          idea: { select: { category: true, subcategory: true, goal: true } },
          script: { select: { style: true } },
        },
      },
    },
  });

  const patterns: LearningInsight['patterns'] = [];

  const dimensions: Array<{ name: string; key: (row: (typeof rows)[number]) => string | null }> = [
    { name: 'Sous-catégorie', key: (r) => r.video.idea?.subcategory ?? null },
    { name: 'Style de script', key: (r) => r.video.script?.style ?? null },
    { name: 'Objectif', key: (r) => r.video.idea?.goal ?? null },
    {
      name: 'Durée',
      key: (r) => {
        const ms = r.video.renderedDurationMs;
        if (!ms) return null;
        if (ms < 20_000) return '< 20 s';
        if (ms < 45_000) return '20–45 s';
        if (ms < 70_000) return '45–70 s';
        return '> 70 s';
      },
    },
  ];

  for (const dimension of dimensions) {
    const buckets = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      const key = dimension.key(row);
      if (!key) continue;
      const bucket = buckets.get(key) ?? { total: 0, count: 0 };
      bucket.total += row.views;
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    // Deux groupes minimum: sans point de comparaison, un « gagnant » n'a
    // aucun sens et serait trompeur.
    if (buckets.size < 2) continue;

    const averages = [...buckets.entries()]
      .map(([key, b]) => ({ key, average: b.total / b.count, count: b.count }))
      .sort((a, b) => b.average - a.average);

    const best = averages[0];
    const rest = averages.slice(1);
    const restAverage = rest.reduce((sum, r) => sum + r.average, 0) / rest.length;

    if (best && restAverage > 0) {
      patterns.push({
        dimension: dimension.name,
        winner: best.key,
        multiplier: Math.round((best.average / restAverage) * 10) / 10,
        sampleSize: best.count,
      });
    }
  }

  const provider = aiProvider();
  if (patterns.length === 0) {
    return { patterns, analysis: null, provider: provider.id, isLive: provider.isLive };
  }

  const prompt = [
    "Voici les écarts de performance mesurés sur mes vidéos verticales DIY.",
    '',
    ...patterns.map(
      (p) =>
        `- ${p.dimension}: « ${p.winner} » obtient ${p.multiplier}× plus de vues que la moyenne ` +
        `des autres (${p.sampleSize} vidéos mesurées).`,
    ),
    '',
    "Explique pourquoi ces formats fonctionnent, puis propose 10 nouveaux sujets qui exploitent",
    "ces constats. Chaque sujet doit être un angle NEUF, pas une redite d'une vidéo existante.",
  ].join('\n');

  const response = await provider.generateStructuredOutput<unknown>(
    prompt,
    'PerformanceAnalysis',
    ANALYSIS_SCHEMA_HINT,
    { system: SYSTEM_PROMPT, temperature: 0.8, promptVersion: PROMPT_VERSIONS.analysis },
  );

  const parsed = analysisSchema.safeParse(response.data);

  return {
    patterns,
    analysis: parsed.success ? parsed.data : null,
    provider: response.provider,
    isLive: provider.isLive,
  };
}
