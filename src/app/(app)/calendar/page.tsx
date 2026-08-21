import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { PageHeader } from '@/components/domain/page-header';
import { EditorialCalendar } from './editorial-calendar';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await requireSessionOrRedirect();
  const workspaceId = session.workspaceId;

  const [publications, videos, accounts] = await Promise.all([
    prisma.publication.findMany({
      where: { video: { workspaceId } },
      include: {
        video: { select: { id: true, title: true } },
        socialAccount: { select: { handle: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    }),
    prisma.video.findMany({
      where: { workspaceId, deletedAt: null, status: { in: ['RENDERED', 'READY', 'REVIEW', 'SCHEDULED'] } },
      select: { id: true, title: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.socialAccount.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, platform: true, handle: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Programmation éditoriale. La publication effective dépend de l'API de chaque plateforme."
      />
      <EditorialCalendar
        publications={publications.map((p) => ({
          id: p.id,
          videoId: p.videoId,
          videoTitle: p.video.title,
          platform: p.platform,
          status: p.status,
          scheduledAt: p.scheduledAt?.toISOString() ?? null,
          publishedAt: p.publishedAt?.toISOString() ?? null,
          handle: p.socialAccount?.handle ?? null,
          manualReason: p.manualReason,
          caption: p.caption,
          hashtags: p.hashtags,
        }))}
        videos={videos}
        accounts={accounts}
      />
    </>
  );
}
