import Link from 'next/link';
import { Lightbulb, Sparkles, Video } from 'lucide-react';
import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import {
  dashboardStats,
  topVideos,
  viewsPerDay,
  viewsPerPlatform,
} from '@/server/services/analytics';
import { workspaceCostSummary } from '@/server/services/costs';
import { PageHeader, StatTile } from '@/components/domain/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { formatCents, formatNumber } from '@/lib/utils';
import { ViewsChart, PlatformChart } from '@/components/charts/dashboard-charts';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await requireSessionOrRedirect();
  const workspaceId = session.workspaceId;

  const [stats, perDay, perPlatform, top, costs, recentVideos] = await Promise.all([
    dashboardStats(workspaceId),
    viewsPerDay(workspaceId),
    viewsPerPlatform(workspaceId),
    topVideos(workspaceId, 5),
    workspaceCostSummary(workspaceId),
    prisma.video.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
  ]);

  const hasMetrics = stats.views > 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Vue d'ensemble de la production et des performances."
        action={
          <Button asChild>
            <Link href="/create">
              <Sparkles />
              Create Video
            </Link>
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Idées" value={stats.ideaCount} />
        <StatTile label="En production" value={stats.inProduction} />
        <StatTile label="Terminées" value={stats.finished} />
        <StatTile label="Programmées" value={stats.scheduled} />
        <StatTile label="Publiées" value={stats.published} />
      </section>

      <section className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Vues cumulées" value={formatNumber(stats.views)} />
        <StatTile label="Likes" value={formatNumber(stats.likes)} />
        <StatTile label="Commentaires" value={formatNumber(stats.comments)} />
        <StatTile label="Partages" value={formatNumber(stats.shares)} />
        <StatTile label="Abonnés gagnés" value={formatNumber(stats.followersGained)} />
        <StatTile label="Revenus saisis" value={formatCents(stats.revenueCents)} />
        <StatTile
          label="Taux de réussite"
          value={hasMetrics ? `${stats.successRate}%` : '—'}
          hint={hasMetrics ? 'Vidéos au CONTENT_SCORE ≥ 60' : 'Aucune mesure enregistrée'}
          tone={stats.successRate >= 50 ? 'success' : 'default'}
        />
        <StatTile
          label="Coût IA du mois"
          value={formatCents(costs.monthCents)}
          hint={`${formatCents(costs.averagePerVideoCents)} par vidéo en moyenne`}
        />
      </section>

      {!hasMetrics ? (
        <div className="mt-6">
          <EmptyState
            icon={<Video className="size-8" />}
            title="Aucune donnée de performance"
            description="Les graphiques se remplissent dès que vous saisissez ou importez les statistiques de vos publications. Rien n'est simulé ici : ce tableau de bord ne montre que vos chiffres réels."
            action={
              <Button asChild variant="outline">
                <Link href="/analytics">Saisir des statistiques</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <section className="mt-6 grid gap-4 lg:grid-cols-3">
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
              <CardTitle className="text-base">Vues par plateforme</CardTitle>
            </CardHeader>
            <CardContent>
              <PlatformChart data={perPlatform} />
            </CardContent>
          </Card>
        </section>
      )}

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Meilleures vidéos</CardTitle>
          </CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucune mesure enregistrée.
              </p>
            ) : (
              <ul className="space-y-3">
                {top.map((video) => (
                  <li key={video.videoId} className="flex items-center justify-between gap-3">
                    <Link
                      href={`/videos/${video.videoId}`}
                      className="truncate text-sm hover:underline"
                    >
                      {video.title}
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="muted">{formatNumber(video.views)} vues</Badge>
                      <Badge variant={video.contentScore >= 60 ? 'success' : 'secondary'}>
                        {video.contentScore}/100
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activité récente</CardTitle>
          </CardHeader>
          <CardContent>
            {recentVideos.length === 0 ? (
              <EmptyState
                icon={<Lightbulb className="size-6" />}
                title="Aucune vidéo"
                description="Lancez votre première production depuis Create Video."
                action={
                  <Button asChild size="sm">
                    <Link href="/create">Créer une vidéo</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-3">
                {recentVideos.map((video) => (
                  <li key={video.id} className="flex items-center justify-between gap-3">
                    <Link href={`/videos/${video.id}`} className="truncate text-sm hover:underline">
                      {video.title}
                    </Link>
                    <Badge variant="secondary">{video.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
