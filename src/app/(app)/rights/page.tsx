import Link from 'next/link';
import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { evaluateRights, RIGHTS_INDICATOR } from '@/lib/rights';
import { PageHeader, StatTile } from '@/components/domain/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { RightsBadge } from '@/components/domain/rights-badge';

export const dynamic = 'force-dynamic';

export default async function RightsPage() {
  const session = await requireSessionOrRedirect();
  const workspaceId = session.workspaceId;

  const [assets, musics] = await Promise.all([
    prisma.asset.findMany({
      where: { workspaceId, deletedAt: null },
      include: { rightsRecord: true, _count: { select: { scenes: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.music.findMany({ where: { workspaceId, deletedAt: null } }),
  ]);

  const evaluated = assets.map((asset) => ({
    asset,
    evaluation: evaluateRights({
      source: asset.source,
      commercialUse: asset.rightsRecord?.commercialUse ?? asset.commercialUse,
      license: asset.rightsRecord?.license ?? asset.license,
      proofKey: asset.rightsRecord?.proofKey,
      proofUrl: asset.rightsRecord?.proofUrl,
      expiresAt: asset.rightsRecord?.expiresAt,
    }),
  }));

  const counts = {
    CLEARED: evaluated.filter((e) => e.evaluation.status === 'CLEARED').length,
    NEEDS_REVIEW: evaluated.filter((e) => e.evaluation.status === 'NEEDS_REVIEW').length,
    BLOCKED: evaluated.filter((e) => e.evaluation.status === 'BLOCKED').length,
  };

  const musicUnknown = musics.filter((m) => m.commercialUse !== 'ALLOWED');

  return (
    <>
      <PageHeader
        title="Rights Management"
        description="L'absence d'information n'est jamais une autorisation. Un asset 🔴 bloque tout export ; un 🟠 bloque l'export monétisable."
        action={
          <Button asChild variant="outline">
            <Link href="/assets">Gérer les assets</Link>
          </Button>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatTile
          label={`${RIGHTS_INDICATOR.CLEARED.emoji} Utilisables`}
          value={counts.CLEARED}
          tone="success"
        />
        <StatTile
          label={`${RIGHTS_INDICATOR.NEEDS_REVIEW.emoji} À vérifier`}
          value={counts.NEEDS_REVIEW}
          tone="warning"
        />
        <StatTile label={`${RIGHTS_INDICATOR.BLOCKED.emoji} Interdits`} value={counts.BLOCKED} />
      </section>

      {musicUnknown.length > 0 ? (
        <div className="mb-4">
          <Alert tone="warning" title="Musiques non proposées automatiquement">
            {musicUnknown.length} morceau(x) dont l&apos;usage commercial n&apos;est pas confirmé.
            IAvid ne les sélectionne jamais automatiquement pour un montage :{' '}
            {musicUnknown.map((m) => m.name).join(', ')}.
          </Alert>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registre des droits</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {evaluated.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Aucun asset enregistré.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Asset</th>
                    <th className="px-4 py-2.5 text-left font-medium">Provenance</th>
                    <th className="px-4 py-2.5 text-left font-medium">Propriétaire</th>
                    <th className="px-4 py-2.5 text-left font-medium">Licence</th>
                    <th className="px-4 py-2.5 text-left font-medium">Territoire</th>
                    <th className="px-4 py-2.5 text-left font-medium">Expire</th>
                    <th className="px-4 py-2.5 text-left font-medium">Usage</th>
                    <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluated.map(({ asset, evaluation }) => (
                    <tr key={asset.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="max-w-[220px] truncate font-medium">{asset.name}</p>
                        {asset._count.scenes > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            utilisé dans {asset._count.scenes} scène(s)
                          </p>
                        ) : null}
                        {evaluation.reasons.length > 0 ? (
                          <p className="mt-0.5 max-w-[260px] text-xs text-warning">
                            {evaluation.reasons.join(' ')}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline">{asset.source}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {asset.rightsRecord?.owner ?? asset.author ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {asset.rightsRecord?.license ?? asset.license ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {asset.rightsRecord?.territory ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {asset.rightsRecord?.expiresAt
                          ? asset.rightsRecord.expiresAt.toISOString().slice(0, 10)
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={
                            (asset.rightsRecord?.commercialUse ?? asset.commercialUse) === 'ALLOWED'
                              ? 'success'
                              : (asset.rightsRecord?.commercialUse ?? asset.commercialUse) === 'DENIED'
                                ? 'destructive'
                                : 'warning'
                          }
                        >
                          {asset.rightsRecord?.commercialUse ?? asset.commercialUse}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <RightsBadge status={evaluation.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
