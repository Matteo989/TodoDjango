import { requireWorkspace } from '@/server/auth/guard';
import { createAndEnqueue } from '@/server/services/jobs';
import { assertWithinBudget } from '@/server/services/costs';
import { apiError, ok } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

/** Étape relançable indépendamment (§27). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    await assertWithinBudget(workspaceId);

    const body = await request.json().catch(() => ({}));
    const payload = { videoId: id, ...(body as Record<string, unknown>) };

    const jobId = await createAndEnqueue(
      { workspaceId, type: 'GENERATE_VOICE', entityType: 'video', entityId: id, input: payload },
      payload,
    );

    return ok({ jobId }, 202);
  } catch (error) {
    return apiError(error);
  }
}
