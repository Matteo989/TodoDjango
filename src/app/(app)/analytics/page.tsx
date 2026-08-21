import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import {
  dashboardStats,
  learningInsights,
  topVideos,
  viewsPerDay,
  viewsPerPlatform,
} from '@/server/services/analytics';
import { PageHeader, StatTile } from '@/components/domain/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { ViewsChart, PlatformChart } from '@/components/charts/dashboard-charts';
import { formatCents, formatNumber } from '@/lib/utils';
import { AnalyticsEntry } from './analytics-entry';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await requireSessionOrRedirect();
  const workspaceId = session.workspaceId;

  const [stats, perDay, perPlatform, top, videos, learning, rows] = await Promise.all([
    dashboardStats(workspaceId),
    viewsPerDay(workspaceId, 60),
    viewsPerPlatform(workspaceId),
    topVideos(workspaceId, 10),
    prisma.video.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, title: true, renderedDurationMs: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    learningInsights(workspaceId),
    prisma.analytics.findMany({
      where: { video: { workspaceId } },
      include: { video: { select: { title: true } } },
      orderBy: { measuredOn: 'desc' },
      take: 50,
    }),
  ]);

  const hasData = rows.length > 0;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Aucune API d'analytics n'est connectée : ces chiffres sont ceux que vous saisissez ou importez."
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Vues" value={formatNumber(stats.views)} />
        <StatTile label="Likes" value={formatNumber(stats.likes)} />
        <StatTile label="Partages" value={formatNumber(stats.shares)} />
        <StatTile label="Revenus" value={formatCents(stats.revenueCents)} />
      </section>

      {hasData ? (
        <section className="mb-6 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Vues par jour</CardTitle>
            </CardHeader>
            <CardContent>
              <ViewsChart data={perDay} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Par plateforme</CardTitle>
            </CardHeader>
            <CardContent>
              <PlatformChart data={perPlatform} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Boucle d&apos;apprentissage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {learning.patterns.length === 0 ? (
                <Alert tone="info">
                  Pas encore assez de mesures pour comparer des formats. Il faut au moins deux
                  groupes distincts (deux sous-catégories, deux styles de script, deux durées) pour
                  qu&apos;un écart ait un sens.
                </Alert>
              ) : (
                <>
                  <ul className="space-y-2">
                    {learning.patterns.map((pattern) => (
                      <li key={pattern.dimension} className="rounded-lg border p-3 text-sm">
                        <span className="text-muted-foreground">{pattern.dimension} : </span>
                        <strong>« {pattern.winner} »</strong> obtient{' '}
                        <strong className="text-primary">{pattern.multiplier}×</strong> plus de vues
                        que la moyenne des autres.
                        <Badge variant="muted" className="ml-2">
                          {pattern.sampleSize} vidéo(s)
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Ces écarts sont calculés directement sur vos mesures, sans intervention
                    d&apos;un modèle.
                  </p>
                </>
              )}

              {learning.analysis ? (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm">{learning.analysis.summary}</p>
                  {learning.analysis.nextIdeas.length > 0 ? (
                    <>
                      <h4 className="text-sm font-semibold">Next Best Ideas</h4>
                      <ul className="space-y-1.5">
                        {learning.analysis.nextIdeas.map((idea, index) => (
                          <li key={index} className="rounded border p-2 text-sm">
                            <strong>{idea.title}</strong>
                            {idea.hook ? (
                              <span className="block text-xs italic text-muted-foreground">
                                « {idea.hook} »
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {!learning.isLive ? (
                    <p className="text-xs text-warning">
                      Analyse indisponible en mode simulé — configurez un fournisseur IA.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mesures enregistrées</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!hasData ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Aucune mesure. Saisissez les chiffres d&apos;une publication dans le formulaire
                  ci-contre.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">Date</th>
                        <th className="px-4 py-2.5 text-left font-medium">Vidéo</th>
                        <th className="px-4 py-2.5 text-left font-medium">Plateforme</th>
                        <th className="px-4 py-2.5 text-right font-medium">Vues</th>
                        <th className="px-4 py-2.5 text-right font-medium">Complétion</th>
                        <th className="px-4 py-2.5 text-right font-medium">Engagement</th>
                        <th className="px-4 py-2.5 text-right font-medium">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                            {row.measuredOn.toISOString().slice(0, 10)}
                          </td>
                          <td className="max-w-[200px] truncate px-4 py-2.5">{row.video.title}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{row.platform}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatNumber(row.views)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {Math.round(row.completionRate * 100)}%
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {(row.engagementRate * 100).toFixed(1)}%
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Badge variant={row.contentScore >= 60 ? 'success' : 'secondary'}>
                              {row.contentScore}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <AnalyticsEntry videos={videos} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Meilleures vidéos</CardTitle>
            </CardHeader>
            <CardContent>
              {top.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Aucune mesure.</p>
              ) : (
                <ol className="space-y-2">
                  {top.map((video, index) => (
                    <li key={video.videoId} className="flex items-center gap-2 text-sm">
                      <span className="w-5 shrink-0 text-muted-foreground">{index + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{video.title}</span>
                      <Badge variant="muted">{formatNumber(video.views)}</Badge>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
