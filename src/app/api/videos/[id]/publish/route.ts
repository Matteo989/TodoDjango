import { z } from 'zod';
import { requireWorkspace } from '@/server/auth/guard';
import { buildManualExport, schedulePublication } from '@/server/services/publishing';
import { createAndEnqueue } from '@/server/services/jobs';
import { apiError, ok } from '@/lib/api';

const scheduleSchema = z.object({
  action: z.literal('schedule'),
  platform: z.enum(['TIKTOK', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'SNAPCHAT_SPOTLIGHT']),
  socialAccountId: z.string().optional(),
  scheduledAt: z.string().datetime(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
});

const publishSchema = z.object({
  action: z.literal('publish'),
  publicationId: z.string().min(1),
});

const manualSchema = z.object({
  action: z.literal('manual'),
  publicationId: z.string().min(1),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const body = z.union([scheduleSchema, publishSchema, manualSchema]).parse(await request.json());

    if (body.action === 'schedule') {
      return ok(
        await schedulePublication({
          workspaceId,
          videoId: id,
          platform: body.platform,
          socialAccountId: body.socialAccountId,
          scheduledAt: new Date(body.scheduledAt),
          caption: body.caption,
          hashtags: body.hashtags,
        }),
        201,
      );
    }

    if (body.action === 'manual') {
      return ok(await buildManualExport(workspaceId, body.publicationId));
    }

    const jobId = await createAndEnqueue(
      { workspaceId, type: 'PUBLISH_VIDEO', entityType: 'video', entityId: id },
      { publicationId: body.publicationId },
    );
    return ok({ jobId }, 202);
  } catch (error) {
    return apiError(error);
  }
}
