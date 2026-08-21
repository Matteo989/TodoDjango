import { z } from 'zod';
import { requireWorkspace } from '@/server/auth/guard';
import { createAndEnqueue } from '@/server/services/jobs';
import { assertWithinBudget } from '@/server/services/costs';
import { apiError, ok } from '@/lib/api';

const schema = z.object({
  niche: z.string().default('DIY / bricolage / maison'),
  subNiche: z.string().optional(),
  count: z.number().int().min(1).max(30).default(5),
  language: z.string().default('fr'),
  targetDurationSec: z.number().int().min(10).max(300).default(45),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).default('BEGINNER'),
  budgetCents: z.number().int().min(0).default(5000),
  goal: z.enum(['VIRALITY', 'AFFILIATE', 'EDUCATION', 'ENTERTAINMENT', 'CONVERSION']).default('VIRALITY'),
});

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = schema.parse(await request.json());

    await assertWithinBudget(workspaceId);

    const jobId = await createAndEnqueue(
      { workspaceId, type: 'GENERATE_IDEAS', entityType: 'workspace', entityId: workspaceId, input },
      input,
    );

    return ok({ jobId }, 202);
  } catch (error) {
    return apiError(error);
  }
}
