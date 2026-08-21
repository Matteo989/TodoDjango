import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { apiError, ok } from '@/lib/api';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  ideaId: z.string().optional(),
  scriptId: z.string().optional(),
  templateId: z.string().optional(),
  musicId: z.string().optional(),
  targetDurationSec: z.number().int().min(5).max(600).default(45),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  captionStyle: z.enum(['MINIMAL', 'BOLD', 'HIGHLIGHTED', 'KARAOKE', 'CENTERED']).default('BOLD'),
  monetizationReady: z.boolean().default(false),
});

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const videos = await prisma.video.findMany({
      where: { workspaceId, deletedAt: null, ...(status ? { status: status as never } : {}) },
      include: {
        idea: { select: { id: true, title: true } },
        _count: { select: { scenes: true, versions: true } },
        qualityReports: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: Number(url.searchParams.get('take') ?? 60),
    });

    return ok({ items: videos, total: videos.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = createSchema.parse(await request.json());

    // Un template pré-remplit la durée et le style de sous-titres (§16).
    let targetDurationSec = input.targetDurationSec;
    let captionStyle = input.captionStyle;
    if (input.templateId) {
      const template = await prisma.template.findFirst({
        where: { id: input.templateId, workspaceId, deletedAt: null },
      });
      if (!template) return ok({ error: 'Template introuvable.' }, 404);
      targetDurationSec = template.targetDurationSec;
      captionStyle = template.captionStyle;
    }

    const video = await prisma.video.create({
      data: { ...input, workspaceId, targetDurationSec, captionStyle },
    });

    if (input.ideaId) {
      await prisma.idea.updateMany({
        where: { id: input.ideaId, workspaceId, status: { in: ['IDEA', 'RESEARCH', 'SCRIPT'] } },
        data: { status: 'ASSETS' },
      });
    }

    return ok(video, 201);
  } catch (error) {
    return apiError(error);
  }
}
