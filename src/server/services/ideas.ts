import { z } from 'zod';
import type { ContentGoal, Difficulty, IdeaStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { aiProvider } from '../providers/registry';
import { scoreIdea } from '@/lib/scoring';
import { lexicalSimilarity } from '@/lib/similarity';
import { detectSafetyTopics } from '@/lib/safety';
import { buildIdeaPrompt, IDEA_SCHEMA_HINT, PROMPT_VERSIONS, SYSTEM_PROMPT } from './prompts';

// ─── Validation de la sortie du modèle ───────────────────────────────────────

const generatedIdeaSchema = z.object({
  title: z.string().min(3).max(200),
  hook: z.string().default(''),
  concept: z.string().default(''),
  summary: z.string().default(''),
  cta: z.string().default(''),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).default('BEGINNER'),
  estimatedCostCents: z.number().int().min(0).max(1_000_000).default(0),
  category: z.string().default('DIY'),
  subcategory: z.string().optional(),
  affiliateProducts: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
});

const ideaBatchSchema = z.object({ ideas: z.array(generatedIdeaSchema).min(1) });

export type GeneratedIdea = z.infer<typeof generatedIdeaSchema>;

export interface GenerateIdeasParams {
  workspaceId: string;
  niche: string;
  subNiche?: string;
  count: number;
  language: string;
  targetDurationSec: number;
  difficulty: Difficulty;
  budgetCents: number;
  goal: ContentGoal;
}

export interface GenerateIdeasOutcome {
  ideaIds: string[];
  provider: string;
  model: string;
  isLive: boolean;
  usage: { inputTokens: number; outputTokens: number; costCents: number };
}

export async function generateIdeas(params: GenerateIdeasParams): Promise<GenerateIdeasOutcome> {
  const provider = aiProvider();

  const [trends, existing] = await Promise.all([
    prisma.trend.findMany({
      where: { workspaceId: params.workspaceId, deletedAt: null },
      orderBy: { weight: 'desc' },
      take: 30,
      select: { kind: true, value: true },
    }),
    prisma.idea.findMany({
      where: { workspaceId: params.workspaceId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { id: true, title: true, concept: true },
    }),
  ]);

  const prompt = buildIdeaPrompt({
    niche: params.niche,
    subNiche: params.subNiche,
    count: params.count,
    language: params.language,
    targetDurationSec: params.targetDurationSec,
    difficulty: params.difficulty,
    budgetCents: params.budgetCents,
    goal: params.goal,
    trends: trends.map((t) => `[${t.kind}] ${t.value}`),
    existingTitles: existing.map((i) => i.title),
  });

  const response = await provider.generateStructuredOutput<unknown>(
    prompt,
    'IdeaBatch',
    IDEA_SCHEMA_HINT,
    { system: SYSTEM_PROMPT, temperature: 0.9, promptVersion: PROMPT_VERSIONS.ideas },
  );

  const parsed = ideaBatchSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(
      `Le fournisseur ${response.provider} a renvoyé un lot d'idées invalide: ${parsed.error.issues
        .map((i) => i.path.join('.'))
        .join(', ')}`,
    );
  }

  const created: string[] = [];

  for (const idea of parsed.data.ideas.slice(0, params.count)) {
    // La similarité est calculée localement contre l'existant: le scoring
    // d'originalité doit être vrai même quand le modèle prétend le contraire.
    const candidateText = [idea.title, idea.concept, idea.summary].filter(Boolean).join('\n');
    const maxSimilarity = existing.reduce((max, other) => {
      const score = lexicalSimilarity(
        candidateText,
        [other.title, other.concept ?? ''].join('\n'),
      );
      return Math.max(max, score);
    }, 0);

    const scores = scoreIdea({
      title: idea.title,
      hook: idea.hook,
      concept: idea.concept,
      description: idea.summary,
      difficulty: idea.difficulty,
      estimatedCostCents: idea.estimatedCostCents,
      targetDurationSec: params.targetDurationSec,
      affiliateProductCount: idea.affiliateProducts.length,
      maxSimilarity,
    });

    const safety = detectSafetyTopics(candidateText);
    const notes =
      safety.length > 0
        ? `⚠️ Sujets à risque détectés: ${safety.map((s) => s.label).join(', ')}.\n\n` +
          safety.map((s) => `• ${s.warning}`).join('\n')
        : '';

    const record = await prisma.idea.create({
      data: {
        workspaceId: params.workspaceId,
        title: idea.title,
        description: idea.summary,
        hook: idea.hook,
        concept: idea.concept,
        summary: idea.summary,
        cta: idea.cta,
        category: idea.category,
        subcategory: idea.subcategory ?? null,
        difficulty: idea.difficulty,
        estimatedCostCents: idea.estimatedCostCents,
        goal: params.goal,
        targetDurationSec: params.targetDurationSec,
        language: params.language,
        sources: idea.sources,
        notes,
        ...scores,
      },
      select: { id: true },
    });

    created.push(record.id);
  }

  return {
    ideaIds: created,
    provider: response.provider,
    model: response.model,
    isLive: provider.isLive,
    usage: response.usage,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export interface ListIdeasParams {
  workspaceId: string;
  search?: string;
  status?: IdeaStatus;
  category?: string;
  difficulty?: Difficulty;
  includeArchived?: boolean;
  sort?: 'recent' | 'viral' | 'originality' | 'title' | 'production';
  take?: number;
  skip?: number;
}

const SORTS: Record<NonNullable<ListIdeasParams['sort']>, Prisma.IdeaOrderByWithRelationInput> = {
  recent: { createdAt: 'desc' },
  viral: { viralScore: 'desc' },
  originality: { originalityScore: 'desc' },
  production: { productionScore: 'desc' },
  title: { title: 'asc' },
};

export async function listIdeas(params: ListIdeasParams) {
  const where: Prisma.IdeaWhereInput = {
    workspaceId: params.workspaceId,
    deletedAt: null,
    ...(params.includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
    ...(params.status ? { status: params.status } : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.difficulty ? { difficulty: params.difficulty } : {}),
    ...(params.search
      ? {
          OR: [
            { title: { contains: params.search, mode: 'insensitive' } },
            { description: { contains: params.search, mode: 'insensitive' } },
            { concept: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.idea.findMany({
      where,
      orderBy: SORTS[params.sort ?? 'recent'],
      take: params.take ?? 50,
      skip: params.skip ?? 0,
      include: {
        tags: { include: { tag: true } },
        _count: { select: { scripts: true, videos: true } },
      },
    }),
    prisma.idea.count({ where }),
  ]);

  return { items, total };
}

export async function duplicateIdea(workspaceId: string, ideaId: string) {
  const source = await prisma.idea.findFirst({
    where: { id: ideaId, workspaceId, deletedAt: null },
  });
  if (!source) throw new Error('Idée introuvable.');

  const { id, createdAt, updatedAt, deletedAt, ...rest } = source;
  void id;
  void createdAt;
  void updatedAt;
  void deletedAt;

  return prisma.idea.create({
    data: {
      ...rest,
      title: `${source.title} (copie)`,
      status: 'IDEA',
      duplicatedFromId: source.id,
    },
  });
}

export async function archiveIdea(workspaceId: string, ideaId: string) {
  const updated = await prisma.idea.updateMany({
    where: { id: ideaId, workspaceId, deletedAt: null },
    data: { status: 'ARCHIVED' },
  });
  if (updated.count === 0) throw new Error('Idée introuvable.');
}

export async function softDeleteIdea(workspaceId: string, ideaId: string) {
  const updated = await prisma.idea.updateMany({
    where: { id: ideaId, workspaceId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (updated.count === 0) throw new Error('Idée introuvable.');
}
