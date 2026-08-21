import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { trendProvider } from '@/server/providers/registry';
import { apiError, ok } from '@/lib/api';

const KINDS = ['TOPIC', 'KEYWORD', 'HASHTAG', 'TITLE', 'FORMAT', 'QUESTION', 'SEASONAL'] as const;

const createSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(KINDS),
        value: z.string().min(1).max(300),
        platform: z
          .enum(['TIKTOK', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'SNAPCHAT_SPOTLIGHT'])
          .optional(),
        weight: z.number().int().min(0).max(100).default(50),
        season: z.string().optional(),
        notes: z.string().default(''),
      }),
    )
    .min(1)
    .max(200),
});

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    const provider = trendProvider();

    const items = await prisma.trend.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { weight: 'desc' }],
    });

    return ok({
      items,
      provider: { id: provider.id, isLive: provider.isLive, source: provider.sourceDescription },
    });
  } catch (error) {
    return apiError(error);
  }
}

/** Import manuel ou par CSV converti côté client. Aucune collecte automatique. */
export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { items } = createSchema.parse(await request.json());

    const created = await prisma.trend.createMany({
      data: items.map((item) => ({ ...item, workspaceId, source: 'manual' })),
    });

    return ok({ created: created.count }, 201);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return ok({ error: 'Paramètre id manquant.' }, 400);

    await prisma.trend.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return ok({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
