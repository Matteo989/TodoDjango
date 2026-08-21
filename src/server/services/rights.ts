import type { CommercialUse, RightsStatus } from '@prisma/client';
import { prisma } from '../db';
import { evaluateRights } from '@/lib/rights';
import { ComplianceError } from '@/lib/compliance/guards';

/**
 * Gestion des droits (§24) et blocage de l'export commercial (§6).
 *
 * `assertRenderable` est appelée par le service de rendu lui-même, pas seulement
 * par l'UI: contourner l'interface ne contourne pas la règle.
 */

export interface UpdateRightsInput {
  workspaceId: string;
  assetId: string;
  owner?: string | null;
  license?: string | null;
  proofKey?: string | null;
  proofUrl?: string | null;
  expiresAt?: Date | null;
  commercialUse?: CommercialUse;
  territory?: string;
  restrictions?: string;
  reviewedBy?: string;
}

export async function updateRights(input: UpdateRightsInput) {
  const asset = await prisma.asset.findFirst({
    where: { id: input.assetId, workspaceId: input.workspaceId, deletedAt: null },
    include: { rightsRecord: true },
  });
  if (!asset) throw new Error('Asset introuvable.');

  const commercialUse = input.commercialUse ?? asset.rightsRecord?.commercialUse ?? 'UNKNOWN';
  const evaluation = evaluateRights({
    source: asset.source,
    commercialUse,
    license: input.license ?? asset.rightsRecord?.license ?? asset.license,
    proofKey: input.proofKey ?? asset.rightsRecord?.proofKey,
    proofUrl: input.proofUrl ?? asset.rightsRecord?.proofUrl,
    expiresAt: input.expiresAt ?? asset.rightsRecord?.expiresAt,
  });

  const data = {
    owner: input.owner ?? asset.rightsRecord?.owner ?? null,
    license: input.license ?? asset.rightsRecord?.license ?? null,
    proofKey: input.proofKey ?? asset.rightsRecord?.proofKey ?? null,
    proofUrl: input.proofUrl ?? asset.rightsRecord?.proofUrl ?? null,
    expiresAt: input.expiresAt ?? asset.rightsRecord?.expiresAt ?? null,
    commercialUse,
    territory: input.territory ?? asset.rightsRecord?.territory ?? 'WORLDWIDE',
    restrictions: input.restrictions ?? asset.rightsRecord?.restrictions ?? '',
    status: evaluation.status,
    reviewedBy: input.reviewedBy ?? null,
    reviewedAt: new Date(),
  };

  const [record] = await prisma.$transaction([
    prisma.rightsRecord.upsert({
      where: { assetId: asset.id },
      create: { workspaceId: input.workspaceId, assetId: asset.id, ...data },
      update: data,
    }),
    prisma.asset.update({
      where: { id: asset.id },
      data: { commercialUse, license: data.license },
    }),
  ]);

  return { record, evaluation };
}

export interface RightsIssue {
  assetId: string;
  assetName: string;
  status: RightsStatus;
  reasons: string[];
}

/** Tous les assets réellement utilisés par le storyboard d'une vidéo. */
export async function collectVideoAssets(workspaceId: string, videoId: string) {
  const scenes = await prisma.scene.findMany({
    where: { videoId, video: { workspaceId } },
    select: { asset: { include: { rightsRecord: true } } },
  });

  const unique = new Map<string, NonNullable<(typeof scenes)[number]['asset']>>();
  for (const scene of scenes) {
    if (scene.asset) unique.set(scene.asset.id, scene.asset);
  }
  return [...unique.values()];
}

export async function auditVideoRights(
  workspaceId: string,
  videoId: string,
): Promise<{ blocking: RightsIssue[]; warnings: RightsIssue[] }> {
  const assets = await collectVideoAssets(workspaceId, videoId);
  const blocking: RightsIssue[] = [];
  const warnings: RightsIssue[] = [];

  for (const asset of assets) {
    const evaluation = evaluateRights({
      source: asset.source,
      commercialUse: asset.rightsRecord?.commercialUse ?? asset.commercialUse,
      license: asset.rightsRecord?.license ?? asset.license,
      proofKey: asset.rightsRecord?.proofKey,
      proofUrl: asset.rightsRecord?.proofUrl,
      expiresAt: asset.rightsRecord?.expiresAt,
    });

    if (evaluation.status === 'BLOCKED') {
      blocking.push({
        assetId: asset.id,
        assetName: asset.name,
        status: 'BLOCKED',
        reasons: evaluation.reasons,
      });
    } else if (evaluation.status === 'NEEDS_REVIEW') {
      warnings.push({
        assetId: asset.id,
        assetName: asset.name,
        status: 'NEEDS_REVIEW',
        reasons: evaluation.reasons,
      });
    }
  }

  // La musique compte comme un asset: une piste aux droits inconnus bloque
  // l'export monétisable au même titre qu'une vidéo.
  const video = await prisma.video.findFirst({
    where: { id: videoId, workspaceId },
    select: { music: true },
  });
  if (video?.music) {
    if (video.music.commercialUse === 'DENIED') {
      blocking.push({
        assetId: video.music.id,
        assetName: `Musique — ${video.music.name}`,
        status: 'BLOCKED',
        reasons: ['Usage commercial interdit par la licence de la musique.'],
      });
    } else if (video.music.commercialUse === 'UNKNOWN') {
      warnings.push({
        assetId: video.music.id,
        assetName: `Musique — ${video.music.name}`,
        status: 'NEEDS_REVIEW',
        reasons: ['Droits commerciaux de la musique inconnus.'],
      });
    }
  }

  return { blocking, warnings };
}

/**
 * Refuse le rendu quand la vidéo est marquée monétisable et qu'un asset ne l'est pas.
 * Un rendu non monétisable reste possible: c'est le marquage MONETIZATION_READY
 * qui engage l'utilisateur, pas le fait de monter des images.
 */
export async function assertRenderable(
  workspaceId: string,
  videoId: string,
  monetizationReady: boolean,
): Promise<void> {
  const { blocking, warnings } = await auditVideoRights(workspaceId, videoId);

  if (blocking.length > 0) {
    throw new ComplianceError(
      'RIGHTS_BLOCKED',
      `Rendu refusé: ${blocking.length} asset(s) marqué(s) 🔴 interdit.\n` +
        blocking.map((b) => `• ${b.assetName} — ${b.reasons.join(' ')}`).join('\n'),
      "Retirez ces assets du storyboard, ou régularisez leurs droits dans Rights Management.",
    );
  }

  if (monetizationReady && warnings.length > 0) {
    throw new ComplianceError(
      'RIGHTS_UNVERIFIED',
      `Export monétisable refusé: ${warnings.length} asset(s) 🟠 à vérifier.\n` +
        warnings.map((w) => `• ${w.assetName} — ${w.reasons.join(' ')}`).join('\n'),
      "Validez les droits de ces assets, ou décochez « prêt pour la monétisation » pour un rendu de travail.",
    );
  }
}
