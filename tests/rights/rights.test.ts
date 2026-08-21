import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateRights, musicSelectableForAutoPick } from '@/lib/rights';
import { assertRenderable, auditVideoRights, updateRights } from '@/server/services/rights';
import { ComplianceError, assertNotPlatformDownload, isPlatformUrl } from '@/lib/compliance/guards';
import { createTestWorkspace, destroyTestWorkspace, prisma } from '../helpers/db';

describe('evaluateRights — logique pure', () => {
  it("ne traite jamais l'inconnu comme une autorisation", () => {
    const result = evaluateRights({ source: 'LICENSED', commercialUse: 'UNKNOWN' });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.commerciallyUsable).toBe(false);
  });

  it('bloque un usage commercial explicitement refusé', () => {
    const result = evaluateRights({ source: 'OWNED', commercialUse: 'DENIED' });
    expect(result.status).toBe('BLOCKED');
    expect(result.commerciallyUsable).toBe(false);
  });

  it('bloque une licence expirée', () => {
    const result = evaluateRights({
      source: 'LICENSED',
      commercialUse: 'ALLOWED',
      license: 'Pexels',
      proofUrl: 'https://example.com/licence',
      expiresAt: new Date('2020-01-01'),
    });
    expect(result.status).toBe('BLOCKED');
  });

  it('bloque toujours une référence externe', () => {
    const result = evaluateRights({ source: 'EXTERNAL_REFERENCE', commercialUse: 'ALLOWED' });
    expect(result.status).toBe('BLOCKED');
    expect(result.reasons.join(' ')).toMatch(/inspiration/i);
  });

  it("valide un contenu qu'on a filmé soi-même", () => {
    const result = evaluateRights({ source: 'OWNED', commercialUse: 'ALLOWED' });
    expect(result.status).toBe('CLEARED');
    expect(result.commerciallyUsable).toBe(true);
  });

  it('exige licence ET preuve pour un asset sous licence', () => {
    const noProof = evaluateRights({
      source: 'LICENSED',
      commercialUse: 'ALLOWED',
      license: 'Envato',
    });
    expect(noProof.status).toBe('NEEDS_REVIEW');
    expect(noProof.reasons.join(' ')).toMatch(/preuve/i);

    const complete = evaluateRights({
      source: 'LICENSED',
      commercialUse: 'ALLOWED',
      license: 'Envato',
      proofUrl: 'https://example.com/facture',
    });
    expect(complete.status).toBe('CLEARED');
  });

  it("demande confirmation pour un contenu généré par IA", () => {
    const result = evaluateRights({ source: 'AI_GENERATED', commercialUse: 'UNKNOWN' });
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('ne propose jamais automatiquement une musique aux droits inconnus', () => {
    expect(musicSelectableForAutoPick('UNKNOWN')).toBe(false);
    expect(musicSelectableForAutoPick('DENIED')).toBe(false);
    expect(musicSelectableForAutoPick('ALLOWED')).toBe(true);
  });
});

describe('garde-fous de conformité', () => {
  it("reconnaît les URL de plateformes, sous-domaines compris", () => {
    expect(isPlatformUrl('https://www.tiktok.com/@user/video/123')).toBe(true);
    expect(isPlatformUrl('https://youtu.be/abc')).toBe(true);
    expect(isPlatformUrl('https://cdn.cdninstagram.com/x.mp4')).toBe(true);
    expect(isPlatformUrl('https://mon-site-perso.fr/ma-video.mp4')).toBe(false);
  });

  it("refuse le téléchargement d'un média depuis une plateforme", () => {
    expect(() => assertNotPlatformDownload('https://www.tiktok.com/@a/video/1')).toThrow(
      ComplianceError,
    );
  });

  it('laisse passer une URL de site personnel', () => {
    expect(() => assertNotPlatformDownload('https://exemple.fr/clip.mp4')).not.toThrow();
  });

  it("propose une alternative légitime plutôt qu'un simple refus", () => {
    try {
      assertNotPlatformDownload('https://youtube.com/watch?v=x');
      expect.unreachable('aurait dû lever');
    } catch (error) {
      expect((error as ComplianceError).remedy).toMatch(/EXTERNAL_REFERENCE/);
    }
  });
});

describe('blocage du rendu par les droits — bout en bout', () => {
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    ({ workspaceId, userId } = await createTestWorkspace('rights'));
  });

  afterAll(async () => {
    await destroyTestWorkspace(workspaceId, userId);
    await prisma.$disconnect();
  });

  async function buildVideoWithAsset(commercialUse: 'ALLOWED' | 'DENIED' | 'UNKNOWN') {
    const asset = await prisma.asset.create({
      data: {
        workspaceId,
        kind: 'VIDEO',
        source: 'LICENSED',
        name: `Asset ${commercialUse}`,
        storageKey: `${workspaceId}/assets/test.mp4`,
        mimeType: 'video/mp4',
        commercialUse,
        rightsRecord: {
          create: {
            workspaceId,
            commercialUse,
            status:
              commercialUse === 'DENIED'
                ? 'BLOCKED'
                : commercialUse === 'ALLOWED'
                  ? 'CLEARED'
                  : 'NEEDS_REVIEW',
          },
        },
      },
    });

    const video = await prisma.video.create({
      data: { workspaceId, title: `Vidéo ${commercialUse}` },
    });

    await prisma.scene.create({
      data: {
        videoId: video.id,
        order: 0,
        startMs: 0,
        durationMs: 3000,
        assetId: asset.id,
      },
    });

    return { assetId: asset.id, videoId: video.id };
  }

  it('refuse tout rendu contenant un asset 🔴 interdit', async () => {
    const { videoId } = await buildVideoWithAsset('DENIED');
    await expect(assertRenderable(workspaceId, videoId, false)).rejects.toThrow(ComplianceError);
  });

  it('refuse un export monétisable avec un asset 🟠 non vérifié', async () => {
    const { videoId } = await buildVideoWithAsset('UNKNOWN');
    await expect(assertRenderable(workspaceId, videoId, true)).rejects.toThrow(/RIGHTS_UNVERIFIED|à vérifier/);
  });

  it('autorise un rendu de travail avec un asset 🟠', async () => {
    const { videoId } = await buildVideoWithAsset('UNKNOWN');
    await expect(assertRenderable(workspaceId, videoId, false)).resolves.toBeUndefined();
  });

  it('autorise un export monétisable quand tous les assets sont 🟢', async () => {
    const asset = await prisma.asset.create({
      data: {
        workspaceId,
        kind: 'VIDEO',
        source: 'OWNED',
        name: 'Mon plan',
        storageKey: `${workspaceId}/assets/owned.mp4`,
        mimeType: 'video/mp4',
        commercialUse: 'ALLOWED',
        rightsRecord: { create: { workspaceId, commercialUse: 'ALLOWED', status: 'CLEARED' } },
      },
    });
    const video = await prisma.video.create({
      data: { workspaceId, title: 'Vidéo propre', monetizationReady: true },
    });
    await prisma.scene.create({
      data: { videoId: video.id, order: 0, startMs: 0, durationMs: 3000, assetId: asset.id },
    });

    await expect(assertRenderable(workspaceId, video.id, true)).resolves.toBeUndefined();
  });

  it("bloque aussi sur une musique dont l'usage commercial est refusé", async () => {
    const music = await prisma.music.create({
      data: {
        workspaceId,
        name: 'Piste interdite',
        storageKey: `${workspaceId}/music/x.mp3`,
        commercialUse: 'DENIED',
      },
    });
    const video = await prisma.video.create({
      data: { workspaceId, title: 'Vidéo musique', musicId: music.id },
    });

    const audit = await auditVideoRights(workspaceId, video.id);
    expect(audit.blocking.some((b) => b.assetName.includes('Piste interdite'))).toBe(true);
  });

  it('recalcule le statut quand la licence est complétée', async () => {
    const asset = await prisma.asset.create({
      data: {
        workspaceId,
        kind: 'IMAGE',
        source: 'LICENSED',
        name: 'Photo sous licence',
        storageKey: `${workspaceId}/assets/photo.jpg`,
        mimeType: 'image/jpeg',
        commercialUse: 'UNKNOWN',
        rightsRecord: { create: { workspaceId, commercialUse: 'UNKNOWN', status: 'NEEDS_REVIEW' } },
      },
    });

    const { record } = await updateRights({
      workspaceId,
      assetId: asset.id,
      license: 'Pexels License',
      proofUrl: 'https://www.pexels.com/license/',
      commercialUse: 'ALLOWED',
      reviewedBy: 'test@iavid.test',
    });

    expect(record.status).toBe('CLEARED');

    const refreshed = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(refreshed.commercialUse).toBe('ALLOWED');
  });
});
