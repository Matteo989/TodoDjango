import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { apiError, ok } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().optional(),
  url: z.string().url(),
  priceCents: z.number().int().min(0).default(0),
  category: z.string().optional(),
  commissionRate: z.number().min(0).max(100).default(0),
  platform: z.string().optional(),
  status: z.enum(['CANDIDATE', 'ACTIVE', 'PAUSED', 'REJECTED']).default('CANDIDATE'),
  notes: z.string().default(''),
});

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    const items = await prisma.product.findMany({
      where: { workspaceId, deletedAt: null },
      include: { links: true },
      orderBy: { createdAt: 'desc' },
    });

    // EPC = revenu par clic. Non calculable sans clics: on renvoie null plutôt
    // que zéro, qui laisserait croire à une performance nulle.
    return ok({
      items: items.map((product) => {
        const clicks = product.links.reduce((sum, l) => sum + l.clicks, 0);
        const revenueCents = product.links.reduce((sum, l) => sum + l.revenueCents, 0);
        const conversions = product.links.reduce((sum, l) => sum + l.conversions, 0);
        return {
          ...product,
          clicks,
          conversions,
          revenueCents,
          epcCents: clicks > 0 ? Math.round(revenueCents / clicks) : null,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = createSchema.parse(await request.json());
    return ok(await prisma.product.create({ data: { ...input, workspaceId } }), 201);
  } catch (error) {
    return apiError(error);
  }
}
