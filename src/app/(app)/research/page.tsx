import Link from 'next/link';
import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { trendProvider } from '@/server/providers/registry';
import { PageHeader } from '@/components/domain/page-header';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { TrendsManager } from './trends-manager';

export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  const session = await requireSessionOrRedirect();
  const provider = trendProvider();

  const trends = await prisma.trend.findMany({
    where: { workspaceId: session.workspaceId, deletedAt: null },
    orderBy: [{ kind: 'asc' }, { weight: 'desc' }],
  });

  return (
    <>
      <PageHeader
        title="Research"
        description="Tendances, mots-clés et formats qui alimentent le générateur d'idées."
        action={
          <Button asChild>
            <Link href="/ideas/generate">Générer des idées</Link>
          </Button>
        }
      />

      <div className="mb-4">
        <Alert tone="info" title="Comment ces données arrivent ici">
          {provider.sourceDescription} Pour brancher une source officielle (API YouTube Data, export
          Google Trends, base sectorielle sous licence), implémentez l&apos;interface{' '}
          <strong>TrendProvider</strong> — voir <code>docs/PROVIDERS.md</code>. L&apos;IA s&apos;en
          sert comme <strong>inspiration</strong> : elle propose des angles neufs, elle ne recopie
          aucune vidéo existante.
        </Alert>
      </div>

      <TrendsManager
        initialItems={trends.map((t) => ({
          id: t.id,
          kind: t.kind,
          value: t.value,
          platform: t.platform,
          weight: t.weight,
          season: t.season,
          source: t.source,
        }))}
      />
    </>
  );
}
