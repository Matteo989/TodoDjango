import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { storage } from '@/server/storage';
import { videoCost } from '@/server/services/costs';
import { apiError, ok } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const video = await prisma.video.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: {
        idea: true,
        script: { include: { blocks: { orderBy: { order: 'asc' } }, claims: true } },
        template: true,
        music: true,
        scenes: { orderBy: { order: 'asc' }, include: { asset: { include: { rightsRecord: true } } } },
        voiceTracks: { orderBy: { createdAt: 'desc' } },
        captionTracks: true,
        versions: true,
        qualityReports: { orderBy: { createdAt: 'desc' }, take: 1 },
        publications: true,
      },
    });
    if (!video) return ok({ error: 'Vidéo introuvable.' }, 404);

    const store = storage();
    return ok({
      ...video,
      masterUrl: video.masterKey ? await store.url(video.masterKey) : null,
      thumbnailUrl: video.thumbnailKey ? await store.url(video.thumbnailKey) : null,
      cost: await videoCost(workspaceId, video.id),
    });
  } catch (error) {
    return apiError(error);
  }
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  scriptId: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  musicId: z.string().nullable().optional(),
  targetDurationSec: z.number().int().min(5).max(600).optional(),
  fps: z.union([z.literal(30), z.literal(60)]).optional(),
  captionStyle: z.enum(['MINIMAL', 'BOLD', 'HIGHLIGHTED', 'KARAOKE', 'CENTERED']).optional(),
  monetizationReady: z.boolean().optional(),
  musicVolume: z.number().min(0).max(1).optional(),
  estimatedRevenueCents: z.number().int().min(0).optional(),
  status: z
    .enum([
      'DRAFT', 'STORYBOARD', 'VOICE', 'RENDERING', 'RENDERED', 'REVIEW',
      'READY', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'ARCHIVED',
    ])
    .optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const input = patchSchema.parse(await request.json());

    const updated = await prisma.video.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: input,
    });
    if (updated.count === 0) return ok({ error: 'Vidéo introuvable.' }, 404);

    return ok(await prisma.video.findUnique({ where: { id } }));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const updated = await prisma.video.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (updated.count === 0) return ok({ error: 'Vidéo introuvable.' }, 404);
    return ok({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
