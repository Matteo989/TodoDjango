import type { Platform } from '@prisma/client';
import { prisma } from '../db';
import { buildKey, storage } from '../storage';
import { runFFmpeg } from '../render/ffmpeg';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Génération multi-plateforme à partir d'une master (§17).
 *
 * Toutes les plateformes visées attendent le même format vertical: la master
 * est donc réencodée aux contraintes de bitrate de chacune plutôt que recadrée.
 * Aucun filigrane d'une autre plateforme n'est ajouté — jamais.
 */

export interface PlatformProfile {
  platform: Platform;
  label: string;
  maxDurationSec: number;
  maxTitleChars: number;
  maxDescriptionChars: number;
  maxHashtags: number;
  videoBitrate: string;
  notes: string;
}

export const PLATFORM_PROFILES: Record<Platform, PlatformProfile> = {
  TIKTOK: {
    platform: 'TIKTOK',
    label: 'TikTok',
    maxDurationSec: 600,
    maxTitleChars: 100,
    maxDescriptionChars: 2200,
    maxHashtags: 10,
    videoBitrate: '6M',
    notes: "Le programme Creator Rewards demande des vidéos d'au moins 60 secondes.",
  },
  YOUTUBE_SHORTS: {
    platform: 'YOUTUBE_SHORTS',
    label: 'YouTube Shorts',
    maxDurationSec: 180,
    maxTitleChars: 100,
    maxDescriptionChars: 5000,
    maxHashtags: 15,
    videoBitrate: '8M',
    notes: "Au-delà de 3 minutes, la vidéo n'est plus traitée comme un Short.",
  },
  INSTAGRAM_REELS: {
    platform: 'INSTAGRAM_REELS',
    label: 'Instagram Reels',
    maxDurationSec: 180,
    maxTitleChars: 125,
    maxDescriptionChars: 2200,
    maxHashtags: 30,
    videoBitrate: '6M',
    notes: 'La légende sert de titre: les 125 premiers caractères sont visibles.',
  },
  SNAPCHAT_SPOTLIGHT: {
    platform: 'SNAPCHAT_SPOTLIGHT',
    label: 'Snapchat Spotlight',
    maxDurationSec: 60,
    maxTitleChars: 80,
    maxDescriptionChars: 250,
    maxHashtags: 5,
    videoBitrate: '5M',
    notes: 'Publication manuelle: aucune API publique de publication.',
  },
};

export interface BuildVersionsParams {
  workspaceId: string;
  videoId: string;
  platforms: Platform[];
  /** Métadonnées par plateforme, saisies ou générées en amont. */
  metadata?: Partial<Record<Platform, { title: string; description: string; hashtags: string[]; cta: string }>>;
  onProgress?: (percent: number) => void;
}

export async function buildPlatformVersions(params: BuildVersionsParams) {
  const video = await prisma.video.findFirst({
    where: { id: params.videoId, workspaceId: params.workspaceId, deletedAt: null },
    include: { idea: true },
  });
  if (!video) throw new Error('Vidéo introuvable.');
  if (!video.masterKey) throw new Error("Aucune master à décliner: lancez le montage d'abord.");

  const store = storage();
  const masterPath = await store.localPath(video.masterKey);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'iavid-versions-'));
  const results = [];

  try {
    for (const [index, platform] of params.platforms.entries()) {
      const profile = PLATFORM_PROFILES[platform];
      const output = path.join(dir, `${platform.toLowerCase()}.mp4`);

      await runFFmpeg([
        '-i', masterPath,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-b:v', profile.videoBitrate,
        '-maxrate', profile.videoBitrate,
        '-bufsize', '12M',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        output,
      ]);

      const buffer = await readFile(output);
      const key = buildKey(
        params.workspaceId,
        'renders',
        `${video.id}-${platform.toLowerCase()}.mp4`,
      );
      await store.put(key, buffer, 'video/mp4');

      const meta = params.metadata?.[platform];
      const version = await prisma.videoVersion.upsert({
        where: { videoId_platform: { videoId: video.id, platform } },
        create: {
          videoId: video.id,
          platform,
          title: (meta?.title ?? video.title).slice(0, profile.maxTitleChars),
          description: (meta?.description ?? video.idea?.summary ?? '').slice(
            0,
            profile.maxDescriptionChars,
          ),
          hashtags: (meta?.hashtags ?? []).slice(0, profile.maxHashtags),
          cta: meta?.cta ?? video.idea?.cta ?? '',
          storageKey: key,
          durationMs: video.renderedDurationMs,
          sizeBytes: buffer.byteLength,
        },
        update: {
          ...(meta
            ? {
                title: meta.title.slice(0, profile.maxTitleChars),
                description: meta.description.slice(0, profile.maxDescriptionChars),
                hashtags: meta.hashtags.slice(0, profile.maxHashtags),
                cta: meta.cta,
              }
            : {}),
          storageKey: key,
          durationMs: video.renderedDurationMs,
          sizeBytes: buffer.byteLength,
        },
      });

      results.push(version);
      params.onProgress?.(Math.round(((index + 1) / params.platforms.length) * 100));
    }

    await prisma.video.update({
      where: { id: video.id },
      data: { status: video.status === 'RENDERED' ? 'READY' : video.status },
    });

    return results;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
