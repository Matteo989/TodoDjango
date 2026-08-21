import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireWorkspace } from '@/server/auth/guard';
import { apiError, ok } from '@/lib/api';

/**
 * L'URL d'affiliation est TOUJOURS collée par l'utilisateur (§23).
 * L'application n'ajoute que les paramètres UTM; elle ne fabrique jamais un
 * lien affilié, qui serait invalide et potentiellement frauduleux.
 */
const schema = z.object({
  productId: z.string().min(1),
  videoId: z.string().optional(),
  affiliateUrl: z.string().url(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = schema.parse(await request.json());

    const product = await prisma.product.findFirst({
      where: { id: input.productId, workspaceId, deletedAt: null },
    });
    if (!product) return ok({ error: 'Produit introuvable.' }, 404);

    return ok(await prisma.affiliateLink.create({ data: input }), 201);
  } catch (error) {
    return apiError(error);
  }
}

const metricsSchema = z.object({
  linkId: z.string().min(1),
  clicks: z.number().int().min(0).optional(),
  conversions: z.number().int().min(0).optional(),
  revenueCents: z.number().int().min(0).optional(),
});

/** Saisie manuelle des performances: aucune API d'affiliation n'est connectée. */
export async function PATCH(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = metricsSchema.parse(await request.json());

    const link = await prisma.affiliateLink.findFirst({
      where: { id: input.linkId, product: { workspaceId } },
    });
    if (!link) return ok({ error: 'Lien introuvable.' }, 404);

    const { linkId, ...metrics } = input;
    void linkId;
    return ok(await prisma.affiliateLink.update({ where: { id: link.id }, data: metrics }));
  } catch (error) {
    return apiError(error);
  }
}
