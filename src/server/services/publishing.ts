import type { Platform } from '@prisma/client';
import { prisma } from '../db';
import { storage } from '../storage';
import { publishingProvider } from '../providers/registry';
import { PLATFORM_PROFILES } from './versions';

/**
 * Publication (§18).
 *
 * Quand l'API officielle ne couvre pas l'opération, la publication passe en
 * MANUAL_REQUIRED avec le fichier et les métadonnées prêts à copier. Aucun
 * contournement de plateforme n'est tenté, jamais.
 */

export interface PublishVideoParams {
  workspaceId: string;
  publicationId: string;
}

export interface PublishOutcomeResult {
  status: string;
  provider: string;
  manualReason?: string;
  externalUrl?: string;
  error?: string;
}

export async function publishVideo(params: PublishVideoParams): Promise<PublishOutcomeResult> {
  const publication = await prisma.publication.findFirst({
    where: { id: params.publicationId, video: { workspaceId: params.workspaceId } },
    include: { video: true, videoVersion: true, socialAccount: true },
  });
  if (!publication) throw new Error('Publication introuvable.');

  const storageKey = publication.videoVersion?.storageKey ?? publication.video.masterKey;
  if (!storageKey) {
    throw new Error("Aucun fichier à publier: lancez le montage et la déclinaison plateforme.");
  }

  const provider = publishingProvider();
  const filePath = await storage().localPath(storageKey);

  const result = await provider.publish({
    platform: publication.platform,
    filePath,
    title: publication.videoVersion?.title ?? publication.video.title,
    description: publication.videoVersion?.description ?? publication.caption,
    hashtags: publication.hashtags.length > 0 ? publication.hashtags : (publication.videoVersion?.hashtags ?? []),
    scheduledAt: publication.scheduledAt,
    accountToken: publication.socialAccount?.oauthPayload ?? null,
  });

  const status =
    result.outcome === 'PUBLISHED'
      ? 'PUBLISHED'
      : result.outcome === 'SCHEDULED'
        ? 'SCHEDULED'
        : result.outcome === 'MANUAL_REQUIRED'
          ? 'MANUAL_REQUIRED'
          : 'FAILED';

  await prisma.publication.update({
    where: { id: publication.id },
    data: {
      status,
      externalId: result.externalId ?? null,
      externalUrl: result.externalUrl ?? null,
      manualReason: result.manualReason ?? null,
      failureReason: result.error ?? null,
      publishedAt: result.outcome === 'PUBLISHED' ? new Date() : null,
    },
  });

  if (result.outcome === 'PUBLISHED') {
    await prisma.video.update({
      where: { id: publication.videoId },
      data: { status: 'PUBLISHED' },
    });
  }

  return {
    status,
    provider: provider.id,
    manualReason: result.manualReason,
    externalUrl: result.externalUrl,
    error: result.error,
  };
}

export interface ManualExportPackage {
  downloadUrl: string;
  filename: string;
  platform: Platform;
  title: string;
  description: string;
  hashtags: string;
  cta: string;
  notes: string;
}

/**
 * Paquet de publication manuelle: le fichier à télécharger et les métadonnées
 * à copier-coller. C'est la sortie normale pour Snapchat et pour toute
 * plateforme dont l'API n'est pas configurée.
 */
export async function buildManualExport(
  workspaceId: string,
  publicationId: string,
): Promise<ManualExportPackage> {
  const publication = await prisma.publication.findFirst({
    where: { id: publicationId, video: { workspaceId } },
    include: { video: true, videoVersion: true },
  });
  if (!publication) throw new Error('Publication introuvable.');

  const key = publication.videoVersion?.storageKey ?? publication.video.masterKey;
  if (!key) throw new Error('Aucun fichier disponible pour cette publication.');

  const profile = PLATFORM_PROFILES[publication.platform];
  const hashtags = (
    publication.hashtags.length > 0 ? publication.hashtags : (publication.videoVersion?.hashtags ?? [])
  )
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .join(' ');

  return {
    downloadUrl: await storage().url(key),
    filename: `${publication.video.title.replace(/[^\w-]+/g, '-').slice(0, 50)}-${publication.platform.toLowerCase()}.mp4`,
    platform: publication.platform,
    title: publication.videoVersion?.title ?? publication.video.title,
    description: publication.videoVersion?.description ?? publication.caption,
    hashtags,
    cta: publication.videoVersion?.cta ?? '',
    notes: profile.notes,
  };
}

export interface SchedulePublicationParams {
  workspaceId: string;
  videoId: string;
  platform: Platform;
  socialAccountId?: string;
  scheduledAt: Date;
  caption?: string;
  hashtags?: string[];
}

export async function schedulePublication(params: SchedulePublicationParams) {
  const video = await prisma.video.findFirst({
    where: { id: params.videoId, workspaceId: params.workspaceId, deletedAt: null },
    include: { versions: { where: { platform: params.platform } } },
  });
  if (!video) throw new Error('Vidéo introuvable.');

  const publication = await prisma.publication.create({
    data: {
      videoId: video.id,
      videoVersionId: video.versions[0]?.id ?? null,
      socialAccountId: params.socialAccountId ?? null,
      platform: params.platform,
      status: 'SCHEDULED',
      scheduledAt: params.scheduledAt,
      caption: params.caption ?? video.versions[0]?.description ?? '',
      hashtags: params.hashtags ?? video.versions[0]?.hashtags ?? [],
    },
  });

  await prisma.video.update({
    where: { id: video.id },
    data: { status: video.status === 'READY' ? 'SCHEDULED' : video.status },
  });

  return publication;
}
