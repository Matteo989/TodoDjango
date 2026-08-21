import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { listIdeas } from '@/server/services/ideas';
import { scoreIdea } from '@/lib/scoring';
import { apiError, ok } from '@/lib/api';

const createSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().default(''),
  hook: z.string().optional(),
  concept: z.string().optional(),
  cta: z.string().optional(),
  category: z.string().default('DIY'),
  subcategory: z.string().optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).default('BEGINNER'),
  estimatedCostCents: z.number().int().min(0).default(0),
  goal: z.enum(['VIRALITY', 'AFFILIATE', 'EDUCATION', 'ENTERTAINMENT', 'CONVERSION']).default('VIRALITY'),
  targetDurationSec: z.number().int().min(5).max(600).default(45),
  notes: z.string().default(''),
  sources: z.array(z.string()).default([]),
});

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const url = new URL(request.url);

    const result = await listIdeas({
      workspaceId,
      search: url.searchParams.get('search') ?? undefined,
      status: (url.searchParams.get('status') as never) ?? undefined,
      category: url.searchParams.get('category') ?? undefined,
      difficulty: (url.searchParams.get('difficulty') as never) ?? undefined,
      includeArchived: url.searchParams.get('includeArchived') === 'true',
      sort: (url.searchParams.get('sort') as never) ?? 'recent',
      take: Number(url.searchParams.get('take') ?? 50),
    });

    return ok(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = createSchema.parse(await request.json());

    const scores = scoreIdea({
      title: input.title,
      hook: input.hook,
      concept: input.concept,
      description: input.description,
      difficulty: input.difficulty,
      estimatedCostCents: input.estimatedCostCents,
      targetDurationSec: input.targetDurationSec,
      affiliateProductCount: 0,
      maxSimilarity: 0,
    });

    const idea = await prisma.idea.create({
      data: { ...input, workspaceId, ...scores },
    });

    return ok(idea, 201);
  } catch (error) {
    return apiError(error);
  }
}
