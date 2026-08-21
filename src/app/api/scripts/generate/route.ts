import { z } from 'zod';
import { requireWorkspace } from '@/server/auth/guard';
import { createAndEnqueue } from '@/server/services/jobs';
import { assertWithinBudget } from '@/server/services/costs';
import { apiError, ok } from '@/lib/api';

const schema = z.object({
  ideaId: z.string().min(1),
  targetDurationSec: z.number().int().min(10).max(300).default(45),
  platform: z
    .enum(['TIKTOK', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'SNAPCHAT_SPOTLIGHT'])
    .optional(),
  audience: z.string().optional(),
  technicalLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).optional(),
  language: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = schema.parse(await request.json());
    await assertWithinBudget(workspaceId);

    const jobId = await createAndEnqueue(
      { workspaceId, type: 'GENERATE_SCRIPT', entityType: 'idea', entityId: input.ideaId, input },
      input,
    );

    return ok({ jobId }, 202);
  } catch (error) {
    return apiError(error);
  }
}
