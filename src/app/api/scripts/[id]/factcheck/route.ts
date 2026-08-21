import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { createAndEnqueue } from '@/server/services/jobs';
import { apiError, ok } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const jobId = await createAndEnqueue(
      { workspaceId, type: 'FACT_CHECK', entityType: 'script', entityId: id },
      { scriptId: id },
    );

    return ok({ jobId }, 202);
  } catch (error) {
    return apiError(error);
  }
}

const patchSchema = z.object({
  claimId: z.string().min(1),
  status: z.enum(['VERIFIED', 'UNVERIFIED', 'OPINION', 'SAFETY_WARNING']),
  sourceUrl: z.string().url().optional().or(z.literal('')),
});

/**
 * Validation humaine d'une affirmation. Le statut VERIFIED n'est atteignable
 * que par ici — l'IA ne peut jamais le poser elle-même (§9).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const input = patchSchema.parse(await request.json());

    const claim = await prisma.factClaim.findFirst({
      where: { id: input.claimId, scriptId: id, script: { workspaceId } },
    });
    if (!claim) return ok({ error: 'Affirmation introuvable.' }, 404);

    return ok(
      await prisma.factClaim.update({
        where: { id: claim.id },
        data: {
          status: input.status,
          sourceUrl: input.sourceUrl || null,
          humanReviewed: true,
        },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
