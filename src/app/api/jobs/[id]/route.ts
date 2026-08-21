import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { apiError, ok } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

/** Suivi de progression pour l'UI (§33). Interrogé toutes les 1,5 s côté client. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const job = await prisma.aIJob.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        error: true,
        result: true,
        provider: true,
        model: true,
        costCents: true,
        durationMs: true,
        createdAt: true,
        finishedAt: true,
      },
    });
    if (!job) return ok({ error: 'Job introuvable.' }, 404);

    return ok(job);
  } catch (error) {
    return apiError(error);
  }
}
