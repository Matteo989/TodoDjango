import { notFound } from 'next/navigation';
import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { storage } from '@/server/storage';
import { videoCost } from '@/server/services/costs';
import { auditVideoRights } from '@/server/services/rights';
import { PageHeader } from '@/components/domain/page-header';
import { Badge } from '@/components/ui/badge';
import { VideoStudio } from './video-studio';

export const dynamic = 'force-dynamic';

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSessionOrRedirect();
  const { id } = await params;
  const workspaceId = session.workspaceId;

  const video = await prisma.video.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      idea: { select: { id: true, title: true } },
      script: { select: { id: true, title: true, style: true } },
      template: { select: { id: true, name: true } },
      music: { select: { id: true, name: true, commercialUse: true } },
      scenes: {
        orderBy: { order: 'asc' },
        include: { asset: { include: { rightsRecord: true } } },
      },
      voiceTracks: { orderBy: { createdAt: 'desc' }, take: 1 },
      captionTracks: true,
      versions: true,
      qualityReports: { orderBy: { createdAt: 'desc' }, take: 1 },
      publications: true,
    },
  });
  if (!video) notFound();

  const store = storage();
  const [assets, rights, cost] = await Promise.all([
    prisma.asset.findMany({
      where: { workspaceId, deletedAt: null, kind: { in: ['VIDEO', 'IMAGE'] } },
      include: { rightsRecord: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    auditVideoRights(workspaceId, video.id),
    videoCost(workspaceId, video.id),
  ]);

  const captionUrls = await Promise.all(
    video.captionTracks.map(async (track) => ({
      id: track.id,
      format: track.format,
      style: track.style,
      method: track.method,
      url: await store.url(track.storageKey),
    })),
  );

  return (
    <>
      <PageHeader
        title={video.title}
        description={
          video.idea ? `Idée : ${video.idea.title}` : 'Vidéo autonome, sans idée rattachée.'
        }
        action={<Badge variant="secondary">{video.status}</Badge>}
      />

      <VideoStudio
        video={{
          id: video.id,
          title: video.title,
          status: video.status,
          targetDurationSec: video.targetDurationSec,
          renderedDurationMs: video.renderedDurationMs,
          width: video.width,
          height: video.height,
          fps: video.fps,
          captionStyle: video.captionStyle,
          monetizationReady: video.monetizationReady,
          hasScript: Boolean(video.scriptId),
          scriptTitle: video.script?.title ?? null,
          templateName: video.template?.name ?? null,
          musicName: video.music?.name ?? null,
          masterUrl: video.masterKey ? await store.url(video.masterKey) : null,
          thumbnailUrl: video.thumbnailKey ? await store.url(video.thumbnailKey) : null,
        }}
        scenes={await Promise.all(
          video.scenes.map(async (scene) => ({
            id: scene.id,
            order: scene.order,
            section: scene.section,
            startMs: scene.startMs,
            durationMs: scene.durationMs,
            narration: scene.narration,
            visualPrompt: scene.visualPrompt,
            caption: scene.caption,
            transition: scene.transition,
            assetId: scene.assetId,
            assetName: scene.asset?.name ?? null,
            assetRights: scene.asset?.rightsRecord?.status ?? null,
            assetThumbnailUrl: scene.asset?.thumbnailKey
              ? await store.url(scene.asset.thumbnailKey)
              : null,
          })),
        )}
        assets={assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          source: asset.source,
          rights: asset.rightsRecord?.status ?? null,
        }))}
        voice={
          video.voiceTracks[0]
            ? {
                id: video.voiceTracks[0].id,
                provider: video.voiceTracks[0].provider,
                durationMs: video.voiceTracks[0].durationMs,
                url: await store.url(video.voiceTracks[0].storageKey),
              }
            : null
        }
        captions={captionUrls}
        versions={video.versions.map((v) => ({
          id: v.id,
          platform: v.platform,
          title: v.title,
          description: v.description,
          hashtags: v.hashtags,
          sizeBytes: v.sizeBytes,
        }))}
        quality={
          video.qualityReports[0]
            ? {
                score: video.qualityReports[0].score,
                passed: video.qualityReports[0].passed,
                checks: video.qualityReports[0].checks as Array<{
                  id: string;
                  label: string;
                  status: string;
                  detail: string;
                }>,
              }
            : null
        }
        rights={rights}
        cost={cost}
      />
    </>
  );
}
