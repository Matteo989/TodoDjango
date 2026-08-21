import { z } from 'zod';
import { requireWorkspace } from '@/server/auth/guard';
import { updateRights } from '@/server/services/rights';
import { apiError, ok } from '@/lib/api';

const schema = z.object({
  owner: z.string().optional(),
  license: z.string().optional(),
  proofUrl: z.string().url().optional().or(z.literal('')),
  expiresAt: z.string().datetime().optional().or(z.literal('')),
  commercialUse: z.enum(['ALLOWED', 'DENIED', 'UNKNOWN']).optional(),
  territory: z.string().optional(),
  restrictions: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { session, workspaceId } = await requireWorkspace();
    const { id } = await params;
    const input = schema.parse(await request.json());

    const result = await updateRights({
      workspaceId,
      assetId: id,
      owner: input.owner,
      license: input.license,
      proofUrl: input.proofUrl || null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      commercialUse: input.commercialUse,
      territory: input.territory,
      restrictions: input.restrictions,
      reviewedBy: session.email,
    });

    return ok(result);
  } catch (error) {
    return apiError(error);
  }
}
