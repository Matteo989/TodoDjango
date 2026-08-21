import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { PageHeader } from '@/components/domain/page-header';
import { Alert } from '@/components/ui/misc';
import { ProductsManager } from './products-manager';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const session = await requireSessionOrRedirect();

  const [products, videos] = await Promise.all([
    prisma.product.findMany({
      where: { workspaceId: session.workspaceId, deletedAt: null },
      include: { links: { include: { video: { select: { title: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.video.findMany({
      where: { workspaceId: session.workspaceId, deletedAt: null },
      select: { id: true, title: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Products"
        description="Produits affiliables et performances de leurs liens."
      />

      <div className="mb-4">
        <Alert tone="info" title="Les liens d'affiliation viennent de vous">
          IAvid ne fabrique jamais un lien affilié — un lien inventé serait invalide et pourrait
          vous exposer. Collez celui que votre programme vous a fourni ; l&apos;application
          n&apos;ajoute que les paramètres UTM pour le suivi.
        </Alert>
      </div>

      <ProductsManager
        products={products.map((product) => {
          const clicks = product.links.reduce((sum, l) => sum + l.clicks, 0);
          const revenueCents = product.links.reduce((sum, l) => sum + l.revenueCents, 0);
          return {
            id: product.id,
            name: product.name,
            brand: product.brand,
            url: product.url,
            priceCents: product.priceCents,
            category: product.category,
            commissionRate: product.commissionRate,
            platform: product.platform,
            status: product.status,
            clicks,
            conversions: product.links.reduce((sum, l) => sum + l.conversions, 0),
            revenueCents,
            epcCents: clicks > 0 ? Math.round(revenueCents / clicks) : null,
            links: product.links.map((link) => ({
              id: link.id,
              affiliateUrl: link.affiliateUrl,
              utmCampaign: link.utmCampaign,
              clicks: link.clicks,
              conversions: link.conversions,
              revenueCents: link.revenueCents,
              videoTitle: link.video?.title ?? null,
            })),
          };
        })}
        videos={videos}
      />
    </>
  );
}
