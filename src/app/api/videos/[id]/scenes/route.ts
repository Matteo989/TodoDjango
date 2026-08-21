import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { reorderScenes, updateScene } from '@/server/services/storyboard';
import { apiError, ok } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const scenes = await prisma.scene.findMany({
      where: { videoId: id, video: { workspaceId } },
      include: { asset: { include: { rightsRecord: true } } },
      orderBy: { order: 'asc' },
    });
    return ok({ items: scenes });
  } catch (error) {
    return apiError(error);
  }
}

const patchSchema = z.union([
  z.object({
    action: z.literal('update'),
    sceneId: z.string().min(1),
    narration: z.string().optional(),
    visualPrompt: z.string().optional(),
    caption: z.string().optional(),
    durationMs: z.number().int().min(300).max(120_000).optional(),
    transition: z.enum(['cut', 'fade', 'wipeleft', 'slideup', 'circleopen']).optional(),
    zoom: z.number().min(1).max(2).optional(),
    assetId: z.string().nullable().optional(),
  }),
  z.object({ action: z.literal('reorder'), sceneIds: z.array(z.string()).min(1) }),
]);

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const input = patchSchema.parse(await request.json());

    if (input.action === 'reorder') {
      await reorderScenes(workspaceId, id, input.sceneIds);
      return ok({ success: true });
    }

    const { action, ...rest } = input;
    void action;
    return ok(await updateScene({ workspaceId, ...rest }));
  } catch (error) {
    return apiError(error);
  }
}
