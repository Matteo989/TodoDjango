import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { workspaceCostSummary } from '@/server/services/costs';
import { PageHeader, StatTile } from '@/components/domain/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { formatCents } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function CostsPage() {
  const session = await requireSessionOrRedirect();
  const workspaceId = session.workspaceId;

  const [summary, workspace, recentJobs, videos] = await Promise.all([
    workspaceCostSummary(workspaceId),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { aiBudgetCentsMonthly: true },
    }),
    prisma.aIJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        type: true,
        status: true,
        provider: true,
        model: true,
        promptVersion: true,
        inputTokens: true,
        outputTokens: true,
        costCents: true,
        durationMs: true,
        createdAt: true,
        error: true,
      },
    }),
    prisma.video.findMany({
      where: { workspaceId, deletedAt: null },
      select: {
        id: true,
        title: true,
        costVoiceCents: true,
        costVideoAiCents: true,
        costStorageCents: true,
        estimatedRevenueCents: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
  ]);

  const budget = workspace?.aiBudgetCentsMonthly ?? 0;

  return (
    <>
      <PageHeader
        title="AI Costs"
        description="Chaque opération IA est journalisée : fournisseur, modèle, version de prompt, tokens, durée et coût."
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Coût du mois"
          value={formatCents(summary.monthCents)}
          hint={budget > 0 ? `Plafond ${formatCents(budget)}` : 'Aucun plafond configuré'}
          tone={budget > 0 && summary.monthCents >= budget * 0.8 ? 'warning' : 'default'}
        />
        <StatTile label="Coût total" value={formatCents(summary.totalCents)} />
        <StatTile label="Vidéos produites" value={summary.videoCount} />
        <StatTile label="Coût moyen / vidéo" value={formatCents(summary.averagePerVideoCents)} />
      </section>

      {budget > 0 && summary.monthCents >= budget ? (
        <div className="mb-4">
          <Alert tone="danger" title="Plafond mensuel atteint">
            Les nouvelles générations IA sont refusées jusqu&apos;au mois prochain ou jusqu&apos;à
            ce que vous releviez le plafond dans Settings.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coût par fournisseur</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.byProvider.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Aucune opération enregistrée.
              </p>
            ) : (
              <ul className="space-y-2">
                {summary.byProvider.map((row) => (
                  <li key={row.provider} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{row.provider}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">{row.jobs} job(s)</Badge>
                      <span className="tabular-nums">{formatCents(row.costCents)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coût par type d&apos;opération</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.byType.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Aucune opération enregistrée.
              </p>
            ) : (
              <ul className="space-y-2">
                {summary.byType.map((row) => (
                  <li key={row.type} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{row.type}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">{row.jobs}</Badge>
                      <span className="tabular-nums">{formatCents(row.costCents)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Coût de production par vidéo</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Vidéo</th>
                  <th className="px-4 py-2.5 text-right font-medium">Voix</th>
                  <th className="px-4 py-2.5 text-right font-medium">Vidéo IA</th>
                  <th className="px-4 py-2.5 text-right font-medium">Stockage</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Revenu</th>
                  <th className="px-4 py-2.5 text-right font-medium">ROI</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((video) => {
                  const total =
                    video.costVoiceCents + video.costVideoAiCents + video.costStorageCents;
                  const roi =
                    total > 0
                      ? Math.round(((video.estimatedRevenueCents - total) / total) * 100)
                      : null;
                  return (
                    <tr key={video.id} className="border-b last:border-0">
                      <td className="max-w-[260px] truncate px-4 py-2.5">{video.title}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCents(video.costVoiceCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCents(video.costVideoAiCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCents(video.costStorageCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {formatCents(total)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCents(video.estimatedRevenueCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {roi === null ? '—' : `${roi}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Journal des opérations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                  <th className="px-4 py-2.5 text-left font-medium">Fournisseur</th>
                  <th className="px-4 py-2.5 text-left font-medium">Modèle</th>
                  <th className="px-4 py-2.5 text-left font-medium">Prompt</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tokens</th>
                  <th className="px-4 py-2.5 text-right font-medium">Durée</th>
                  <th className="px-4 py-2.5 text-right font-medium">Coût</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {job.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-2.5">{job.type}</td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant={
                          job.status === 'SUCCEEDED'
                            ? 'success'
                            : job.status === 'FAILED'
                              ? 'destructive'
                              : 'secondary'
                        }
                        title={job.error ?? undefined}
                      >
                        {job.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{job.provider ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{job.model ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{job.promptVersion ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {job.inputTokens + job.outputTokens || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {job.durationMs > 0 ? `${(job.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCents(job.costCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
