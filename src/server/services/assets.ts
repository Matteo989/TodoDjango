import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AssetKind, AssetSource, CommercialUse, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { buildKey, storage } from '../storage';
import { extractThumbnail, probeMedia } from '../render/ffmpeg';
import { evaluateRights } from '@/lib/rights';
import { assertNotPlatformDownload } from '@/lib/compliance/guards';

const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac']);

export function kindFromMime(mimeType: string): AssetKind {
  if (VIDEO_MIME.has(mimeType)) return 'VIDEO';
  if (IMAGE_MIME.has(mimeType)) return 'IMAGE';
  if (AUDIO_MIME.has(mimeType)) return 'AUDIO';
  throw new Error(
    `Type de fichier non pris en charge: ${mimeType}. Formats acceptés: MP4, MOV, WebM, JPEG, PNG, WebP, MP3, WAV.`,
  );
}

export interface CreateAssetInput {
  workspaceId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  source: AssetSource;
  name?: string;
  author?: string;
  sourceUrl?: string;
  license?: string;
  acquiredAt?: Date;
  commercialUse?: CommercialUse;
  notes?: string;
}

/**
 * Importe un média, extrait ses métadonnées réelles via ffprobe et crée son
 * enregistrement de droits. Aucune métadonnée n'est devinée: si ffprobe ne peut
 * pas lire le fichier, l'import échoue plutôt que d'enregistrer des zéros.
 */
export async function createAsset(input: CreateAssetInput) {
  if (input.sourceUrl) {
    // Un média ne s'importe jamais depuis une plateforme sociale (§25).
    assertNotPlatformDownload(input.sourceUrl);
  }

  const kind = kindFromMime(input.mimeType);
  const store = storage();
  const key = buildKey(input.workspaceId, 'assets', input.filename);

  // ffprobe et la génération de miniature travaillent sur un fichier: on passe
  // par un répertoire temporaire même quand le stockage final est S3.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'iavid-asset-'));
  const tmpFile = path.join(dir, path.basename(input.filename).replace(/[^\w.-]/g, '_'));

  try {
    await writeFile(tmpFile, input.buffer);
    const info = await probeMedia(tmpFile);

    if (kind === 'VIDEO' && !info.hasVideo) {
      throw new Error("Le fichier est annoncé comme vidéo mais ne contient aucun flux vidéo.");
    }

    await store.put(key, input.buffer, input.mimeType);

    let thumbnailKey: string | null = null;
    if (kind === 'VIDEO') {
      const thumbFile = path.join(dir, 'thumb.jpg');
      // Une image à 1 s évite les fondus au noir d'ouverture; on retombe au
      // début si la vidéo est plus courte.
      await extractThumbnail(tmpFile, thumbFile, Math.min(1000, Math.max(0, info.durationMs / 2)));
      thumbnailKey = buildKey(input.workspaceId, 'thumbnails', `${path.parse(input.filename).name}.jpg`);
      await store.put(thumbnailKey, await readFile(thumbFile), 'image/jpeg');
    } else if (kind === 'IMAGE') {
      thumbnailKey = key;
    }

    const commercialUse = input.commercialUse ?? defaultCommercialUse(input.source);
    const evaluation = evaluateRights({
      source: input.source,
      commercialUse,
      license: input.license ?? null,
    });

    return prisma.asset.create({
      data: {
        workspaceId: input.workspaceId,
        kind,
        source: input.source,
        name: input.name ?? path.parse(input.filename).name,
        storageKey: key,
        thumbnailKey,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.byteLength,
        durationMs: info.durationMs || null,
        width: info.width,
        height: info.height,
        fps: info.fps,
        author: input.author ?? null,
        sourceUrl: input.sourceUrl ?? null,
        license: input.license ?? null,
        acquiredAt: input.acquiredAt ?? new Date(),
        commercialUse,
        notes: input.notes ?? '',
        rightsRecord: {
          create: {
            workspaceId: input.workspaceId,
            owner: input.author ?? null,
            license: input.license ?? null,
            commercialUse,
            status: evaluation.status,
          },
        },
      },
      include: { rightsRecord: true },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Un contenu qu'on a filmé soi-même est utilisable; tout le reste part de
 * l'inconnu. L'absence d'information n'est jamais une autorisation.
 */
function defaultCommercialUse(source: AssetSource): CommercialUse {
  return source === 'OWNED' ? 'ALLOWED' : 'UNKNOWN';
}

export interface ListAssetsParams {
  workspaceId: string;
  kind?: AssetKind;
  source?: AssetSource;
  search?: string;
  onlyCleared?: boolean;
  take?: number;
}

export async function listAssets(params: ListAssetsParams) {
  const where: Prisma.AssetWhereInput = {
    workspaceId: params.workspaceId,
    deletedAt: null,
    ...(params.kind ? { kind: params.kind } : {}),
    ...(params.source ? { source: params.source } : {}),
    ...(params.onlyCleared ? { rightsRecord: { status: 'CLEARED' } } : {}),
    ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
  };

  return prisma.asset.findMany({
    where,
    include: { rightsRecord: true },
    orderBy: { createdAt: 'desc' },
    take: params.take ?? 100,
  });
}

export async function softDeleteAsset(workspaceId: string, assetId: string) {
  const updated = await prisma.asset.updateMany({
    where: { id: assetId, workspaceId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (updated.count === 0) throw new Error('Asset introuvable.');
}

/** Découpe un passage d'un asset vidéo en un nouvel asset (§7). */
export async function trimAsset(
  workspaceId: string,
  assetId: string,
  startMs: number,
  endMs: number,
) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, workspaceId, deletedAt: null, kind: 'VIDEO' },
    include: { rightsRecord: true },
  });
  if (!asset) throw new Error('Asset vidéo introuvable.');
  if (endMs <= startMs) throw new Error('La fin du passage doit être après son début.');

  const { runFFmpeg } = await import('../render/ffmpeg');
  const store = storage();
  const sourcePath = await store.localPath(asset.storageKey);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'iavid-trim-'));
  const output = path.join(dir, 'clip.mp4');

  try {
    await runFFmpeg([
      '-ss', (startMs / 1000).toFixed(3),
      '-i', sourcePath,
      '-t', ((endMs - startMs) / 1000).toFixed(3),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      output,
    ]);

    return createAsset({
      workspaceId,
      filename: `${asset.name}-extrait.mp4`,
      mimeType: 'video/mp4',
      buffer: await readFile(output),
      // Un extrait hérite de la provenance de sa source: on ne « blanchit »
      // jamais un asset en le découpant.
      source: asset.source,
      name: `${asset.name} — extrait ${(startMs / 1000).toFixed(1)}s→${(endMs / 1000).toFixed(1)}s`,
      author: asset.author ?? undefined,
      license: asset.license ?? undefined,
      commercialUse: asset.commercialUse,
      notes: `Extrait de l'asset ${asset.id}.`,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
