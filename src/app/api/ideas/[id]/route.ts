import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { archiveIdea, duplicateIdea, softDeleteIdea } from '@/server/services/ideas';
import { apiError, ok } from '@/lib/api';

const patchSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().optional(),
  hook: z.string().optional(),
  concept: z.string().optional(),
  summary: z.string().optional(),
  cta: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).optional(),
  estimatedCostCents: z.number().int().min(0).optional(),
  goal: z.enum(['VIRALITY', 'AFFILIATE', 'EDUCATION', 'ENTERTAINMENT', 'CONVERSION']).optional(),
  status: z
    .enum([
      'IDEA', 'RESEARCH', 'SCRIPT', 'ASSETS', 'VOICE', 'EDITING',
      'REVIEW', 'READY', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED',
    ])
    .optional(),
  targetDurationSec: z.number().int().min(5).max(600).optional(),
  notes: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const idea = await prisma.idea.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: {
        scripts: { orderBy: { createdAt: 'desc' } },
        videos: { orderBy: { createdAt: 'desc' } },
        tags: { include: { tag: true } },
      },
    });
    if (!idea) return ok({ error: 'Idée introuvable.' }, 404);

    return ok(idea);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const input = patchSchema.parse(await request.json());

    const updated = await prisma.idea.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: input,
    });
    if (updated.count === 0) return ok({ error: 'Idée introuvable.' }, 404);

    return ok(await prisma.idea.findUnique({ where: { id } }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const { action } = z
      .object({ action: z.enum(['duplicate', 'archive']) })
      .parse(await request.json());

    if (action === 'duplicate') return ok(await duplicateIdea(workspaceId, id), 201);
    await archiveIdea(workspaceId, id);
    return ok({ success: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    await softDeleteIdea(workspaceId, id);
    return ok({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
