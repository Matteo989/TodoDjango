import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { providerStatus } from '@/lib/env';
import { checkFFmpegAvailable } from '@/server/render/ffmpeg';
import { apiError, ok } from '@/lib/api';

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();

    const [workspace, accounts, ffmpeg] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId } }),
      prisma.socialAccount.findMany({
        where: { workspaceId, deletedAt: null },
        // oauthPayload est un secret: il ne sort jamais de l'API.
        select: {
          id: true,
          platform: true,
          handle: true,
          locale: true,
          audience: true,
          tone: true,
          defaultHashtags: true,
          requireMinDuration: true,
          minDurationSec: true,
          oauthPayload: false,
        },
      }),
      checkFFmpegAvailable(),
    ]);

    return ok({ workspace, accounts, providers: providerStatus(), ffmpeg });
  } catch (error) {
    return apiError(error);
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  locale: z.string().min(2).max(5).optional(),
  niche: z.string().max(200).optional(),
  aiBudgetCentsMonthly: z.number().int().min(0).optional(),
});

export async function PATCH(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = patchSchema.parse(await request.json());
    return ok(await prisma.workspace.update({ where: { id: workspaceId }, data: input }));
  } catch (error) {
    return apiError(error);
  }
}
