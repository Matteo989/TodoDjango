import { requireWorkspace } from '@/server/auth/guard';
import { softDeleteAsset, trimAsset } from '@/server/services/assets';
import { apiError, ok } from '@/lib/api';
import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    await softDeleteAsset(workspaceId, id);
    return ok({ success: true });
  } catch (error) {
    return apiError(error);
  }
}

const trimSchema = z.object({
  action: z.literal('trim'),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const input = trimSchema.parse(await request.json());
    return ok(await trimAsset(workspaceId, id, input.startMs, input.endMs), 201);
  } catch (error) {
    return apiError(error);
  }
}
