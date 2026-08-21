import { prisma } from '../db';

/**
 * Coût de production et ROI (§35), alimentés par les coûts réels enregistrés
 * sur chaque AIJob et chaque VoiceTrack — jamais par une estimation affichée.
 */

export interface VideoCostBreakdown {
  voiceCents: number;
  videoAiCents: number;
  llmCents: number;
  storageCents: number;
  totalCents: number;
  estimatedRevenueCents: number;
  /** Retour sur investissement en pourcentage; null si aucun coût enregistré. */
  roiPercent: number | null;
}

export async function videoCost(workspaceId: string, videoId: string): Promise<VideoCostBreakdown> {
  const video = await prisma.video.findFirst({
    where: { id: videoId, workspaceId },
    select: {
      costVoiceCents: true,
      costVideoAiCents: true,
      costStorageCents: true,
      estimatedRevenueCents: true,
      scriptId: true,
      ideaId: true,
    },
  });
  if (!video) throw new Error('Vidéo introuvable.');

  // Les coûts LLM sont rattachés à l'entité que le job a traitée: on agrège la
  // vidéo, son script et son idée pour obtenir le coût réel de la production.
  const entityIds = [videoId, video.scriptId, video.ideaId].filter((id): id is string => Boolean(id));
  const llm = await prisma.aIJob.aggregate({
    where: { workspaceId, entityId: { in: entityIds }, status: 'SUCCEEDED' },
    _sum: { costCents: true },
  });

  const llmCents = llm._sum.costCents ?? 0;
  const totalCents =
    video.costVoiceCents + video.costVideoAiCents + video.costStorageCents + llmCents;

  return {
    voiceCents: video.costVoiceCents,
    videoAiCents: video.costVideoAiCents,
    llmCents,
    storageCents: video.costStorageCents,
    totalCents,
    estimatedRevenueCents: video.estimatedRevenueCents,
    roiPercent:
      totalCents > 0
        ? Math.round(((video.estimatedRevenueCents - totalCents) / totalCents) * 100)
        : null,
  };
}

export interface CostSummary {
  monthCents: number;
  totalCents: number;
  videoCount: number;
  averagePerVideoCents: number;
  byProvider: Array<{ provider: string; costCents: number; jobs: number }>;
  byType: Array<{ type: string; costCents: number; jobs: number }>;
}

export async function workspaceCostSummary(workspaceId: string): Promise<CostSummary> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [month, total, videoAggregate, byProvider, byType] = await Promise.all([
    prisma.aIJob.aggregate({
      where: { workspaceId, createdAt: { gte: monthStart }, status: 'SUCCEEDED' },
      _sum: { costCents: true },
    }),
    prisma.aIJob.aggregate({
      where: { workspaceId, status: 'SUCCEEDED' },
      _sum: { costCents: true },
    }),
    prisma.video.aggregate({
      where: { workspaceId, deletedAt: null },
      _count: { id: true },
      _sum: { costVoiceCents: true, costVideoAiCents: true, costStorageCents: true },
    }),
    prisma.aIJob.groupBy({
      by: ['provider'],
      where: { workspaceId, status: 'SUCCEEDED', provider: { not: null } },
      _sum: { costCents: true },
      _count: { id: true },
    }),
    prisma.aIJob.groupBy({
      by: ['type'],
      where: { workspaceId, status: 'SUCCEEDED' },
      _sum: { costCents: true },
      _count: { id: true },
    }),
  ]);

  const videoCount = videoAggregate._count.id;
  const productionCents =
    (videoAggregate._sum.costVoiceCents ?? 0) +
    (videoAggregate._sum.costVideoAiCents ?? 0) +
    (videoAggregate._sum.costStorageCents ?? 0);
  const totalCents = (total._sum.costCents ?? 0) + productionCents;

  return {
    monthCents: month._sum.costCents ?? 0,
    totalCents,
    videoCount,
    averagePerVideoCents: videoCount > 0 ? Math.round(totalCents / videoCount) : 0,
    byProvider: byProvider.map((row) => ({
      provider: row.provider ?? 'inconnu',
      costCents: row._sum.costCents ?? 0,
      jobs: row._count.id,
    })),
    byType: byType.map((row) => ({
      type: row.type,
      costCents: row._sum.costCents ?? 0,
      jobs: row._count.id,
    })),
  };
}

/**
 * Plafond de dépense mensuel (risque R2): une boucle d'apprentissage qui
 * régénère en continu ne doit pas pouvoir brûler un budget sans limite.
 */
export async function assertWithinBudget(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiBudgetCentsMonthly: true },
  });
  if (!workspace || workspace.aiBudgetCentsMonthly <= 0) return;

  const summary = await workspaceCostSummary(workspaceId);
  if (summary.monthCents >= workspace.aiBudgetCentsMonthly) {
    throw new Error(
      `Plafond IA mensuel atteint (${(summary.monthCents / 100).toFixed(2)} € / ` +
        `${(workspace.aiBudgetCentsMonthly / 100).toFixed(2)} €). ` +
        `Relevez le plafond dans Settings pour continuer.`,
    );
  }
}
