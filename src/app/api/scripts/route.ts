import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { apiError, ok } from '@/lib/api';

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const url = new URL(request.url);
    const ideaId = url.searchParams.get('ideaId');

    const scripts = await prisma.script.findMany({
      where: { workspaceId, deletedAt: null, ...(ideaId ? { ideaId } : {}) },
      include: {
        blocks: { orderBy: { order: 'asc' } },
        claims: true,
        idea: { select: { id: true, title: true } },
      },
      orderBy: [{ isSelected: 'desc' }, { createdAt: 'desc' }],
      take: Number(url.searchParams.get('take') ?? 100),
    });

    return ok({ items: scripts, total: scripts.length });
  } catch (error) {
    return apiError(error);
  }
}
