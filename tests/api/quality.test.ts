import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatQualityReport, runQualityControl } from '@/server/services/quality';
import { normalizeBlockTimings } from '@/server/services/scripts';
import { PLATFORM_PROFILES } from '@/server/services/versions';
import { createTestWorkspace, destroyTestWorkspace, prisma } from '../helpers/db';

describe('contrôle qualité sans rendu', () => {
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    ({ workspaceId, userId } = await createTestWorkspace('quality'));
  });

  afterAll(async () => {
    await destroyTestWorkspace(workspaceId, userId);
    await prisma.$disconnect();
  });

  it('échoue proprement quand aucun montage n’a été lancé', async () => {
    const video = await prisma.video.create({ data: { workspaceId, title: 'Sans rendu' } });
    const report = await runQualityControl(workspaceId, video.id);

    expect(report.passed).toBe(false);
    const byId = new Map(report.checks.map((c) => [c.id, c]));
    expect(byId.get('format')?.status).toBe('fail');
    expect(byId.get('audio')?.status).toBe('fail');
    expect(byId.get('captions')?.status).toBe('fail');
    expect(report.score).toBeLessThan(50);
  });

  it('produit un rapport lisible', async () => {
    const video = await prisma.video.create({ data: { workspaceId, title: 'Rapport' } });
    const report = await runQualityControl(workspaceId, video.id);
    const text = formatQualityReport(report);

    expect(text).toContain('QUALITY SCORE:');
    expect(text).toMatch(/[✓⚠✗]/);
  });

  it('conserve chaque rapport pour l’historique', async () => {
    const video = await prisma.video.create({ data: { workspaceId, title: 'Historique' } });
    await runQualityControl(workspaceId, video.id);
    await runQualityControl(workspaceId, video.id);

    expect(await prisma.qualityReport.count({ where: { videoId: video.id } })).toBe(2);
  });

  it("refuse une vidéo d'un autre workspace", async () => {
    const other = await createTestWorkspace('quality-other');
    const video = await prisma.video.create({
      data: { workspaceId: other.workspaceId, title: 'Ailleurs' },
    });

    await expect(runQualityControl(workspaceId, video.id)).rejects.toThrow(/introuvable/i);
    await destroyTestWorkspace(other.workspaceId, other.userId);
  });
});

describe('recalage des durées de blocs', () => {
  it('couvre exactement la durée cible', () => {
    const blocks = normalizeBlockTimings(
      [
        { section: 'HOOK', text: 'Court', startMs: 0, endMs: 99_999 },
        { section: 'SOLUTION', text: 'Un texte nettement plus long que le précédent', startMs: 0, endMs: 5 },
        { section: 'CTA', text: 'Abonne-toi', startMs: 0, endMs: 0 },
      ],
      45_000,
    );

    expect(blocks[0]?.startMs).toBe(0);
    expect(blocks[blocks.length - 1]?.endMs).toBe(45_000);
  });

  it('ne laisse ni trou ni chevauchement', () => {
    const blocks = normalizeBlockTimings(
      [
        { section: 'HOOK', text: 'a'.repeat(20), startMs: 0, endMs: 0 },
        { section: 'PROBLEM', text: 'b'.repeat(50), startMs: 0, endMs: 0 },
        { section: 'SOLUTION', text: 'c'.repeat(80), startMs: 0, endMs: 0 },
      ],
      30_000,
    );

    for (let i = 1; i < blocks.length; i += 1) {
      expect(blocks[i]?.startMs).toBe(blocks[i - 1]?.endMs);
    }
  });

  it('donne plus de temps au bloc le plus long', () => {
    const blocks = normalizeBlockTimings(
      [
        { section: 'HOOK', text: 'court', startMs: 0, endMs: 0 },
        { section: 'SOLUTION', text: 'x'.repeat(200), startMs: 0, endMs: 0 },
      ],
      20_000,
    );
    const first = (blocks[0]?.endMs ?? 0) - (blocks[0]?.startMs ?? 0);
    const second = (blocks[1]?.endMs ?? 0) - (blocks[1]?.startMs ?? 0);
    expect(second).toBeGreaterThan(first);
  });
});

describe('profils de plateforme', () => {
  it('couvre les quatre plateformes visées', () => {
    expect(Object.keys(PLATFORM_PROFILES).sort()).toEqual([
      'INSTAGRAM_REELS',
      'SNAPCHAT_SPOTLIGHT',
      'TIKTOK',
      'YOUTUBE_SHORTS',
    ]);
  });

  it('documente pourquoi Snapchat reste manuel', () => {
    expect(PLATFORM_PROFILES.SNAPCHAT_SPOTLIGHT.notes).toMatch(/manuelle/i);
  });

  it('donne des limites de métadonnées exploitables', () => {
    for (const profile of Object.values(PLATFORM_PROFILES)) {
      expect(profile.maxTitleChars).toBeGreaterThan(0);
      expect(profile.maxHashtags).toBeGreaterThan(0);
      expect(profile.videoBitrate).toMatch(/^\d+M$/);
    }
  });
});
