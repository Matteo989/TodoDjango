import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { storage } from '@/server/storage';
import { PageHeader } from '@/components/domain/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { formatDuration } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  DRAFT: 'secondary',
  STORYBOARD: 'secondary',
  VOICE: 'secondary',
  RENDERING: 'warning',
  RENDERED: 'default',
  REVIEW: 'default',
  READY: 'success',
  SCHEDULED: 'success',
  PUBLISHED: 'success',
  FAILED: 'destructive',
  ARCHIVED: 'secondary',
};

export default async function VideosPage() {
  const session = await requireSessionOrRedirect();
  const store = storage();

  const [videos, activeJobs] = await Promise.all([
    prisma.video.findMany({
      where: { workspaceId: session.workspaceId, deletedAt: null },
      include: {
        idea: { select: { title: true } },
        _count: { select: { scenes: true, versions: true } },
        qualityReports: { orderBy: { createdAt: 'desc' }, take: 1, select: { score: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.aIJob.findMany({
      where: {
        workspaceId: session.workspaceId,
        status: { in: ['QUEUED', 'RUNNING'] },
        entityType: 'video',
      },
      select: { entityId: true, type: true, progress: true },
    }),
  ]);

  const jobsByVideo = new Map(activeJobs.map((j) => [j.entityId, j]));

  const rows = await Promise.all(
    videos.map(async (video) => ({
      ...video,
      thumbnailUrl: video.thumbnailKey ? await store.url(video.thumbnailKey) : null,
    })),
  );

  return (
    <>
      <PageHeader
        title="Videos"
        description="Toutes les productions et leur avancement dans le pipeline."
        action={
          <Button asChild>
            <Link href="/create">
              <Sparkles />
              Create Video
            </Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Aucune vidéo"
          description="Lancez une production depuis une idée ou via le workflow guidé Create Video."
          action={
            <Button asChild>
              <Link href="/create">Create Video</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((video) => {
            const job = jobsByVideo.get(video.id);
            return (
              <Card key={video.id}>
                <CardContent className="flex gap-3 p-4">
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      className="h-28 w-16 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-28 w-16 shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                      9:16
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Link
                      href={`/videos/${video.id}`}
                      className="line-clamp-2 text-sm font-semibold hover:underline"
                    >
                      {video.title}
                    </Link>
                    {video.idea ? (
                      <p className="truncate text-xs text-muted-foreground">{video.idea.title}</p>
                    ) : null}

                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={STATUS_VARIANT[video.status] ?? 'secondary'}>
                        {video.status}
                      </Badge>
                      {video._count.scenes > 0 ? (
                        <Badge variant="outline">{video._count.scenes} scènes</Badge>
                      ) : null}
                      {video.renderedDurationMs ? (
                        <Badge variant="outline">{formatDuration(video.renderedDurationMs)}</Badge>
                      ) : null}
                      {video.qualityReports[0] ? (
                        <Badge
                          variant={video.qualityReports[0].score >= 80 ? 'success' : 'warning'}
                        >
                          QC {video.qualityReports[0].score}
                        </Badge>
                      ) : null}
                      {video.monetizationReady ? (
                        <Badge variant="success">Monétisable</Badge>
                      ) : null}
                    </div>

                    {job ? (
                      <p className="text-xs text-primary">
                        {job.type} — {job.progress}%
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
