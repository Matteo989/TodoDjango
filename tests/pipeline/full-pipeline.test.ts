import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { generateIdeas } from '@/server/services/ideas';
import { generateScripts, checkDuplication, selectScript, runFactCheck } from '@/server/services/scripts';
import { generateStoryboard } from '@/server/services/storyboard';
import { generateVoice } from '@/server/services/voice';
import { generateCaptions } from '@/server/services/captions';
import { renderVideo } from '@/server/services/render';
import { runQualityControl } from '@/server/services/quality';
import { buildPlatformVersions } from '@/server/services/versions';
import { videoCost } from '@/server/services/costs';
import { probeMedia } from '@/server/render/ffmpeg';
import { storage } from '@/server/storage';
import { createTestWorkspace, destroyTestWorkspace, prisma } from '../helpers/db';

/**
 * Parcours complet, avec les fournisseurs mock et FFmpeg réel:
 * idée → script → fact check → storyboard → voix → sous-titres → montage →
 * contrôle qualité → versions plateforme.
 *
 * C'est le test qui garantit l'exigence centrale de la spécification:
 * l'application produit réellement un MP4 1080×1920 sans aucune clé d'API.
 */
describe('pipeline complet', () => {
  let workspaceId: string;
  let userId: string;
  let ideaId: string;
  let scriptId: string;
  let videoId: string;
  const createdKeys: string[] = [];

  beforeAll(async () => {
    ({ workspaceId, userId } = await createTestWorkspace('pipeline'));
  }, 60_000);

  afterAll(async () => {
    const store = storage();
    for (const key of createdKeys) {
      await store.delete(key).catch(() => undefined);
    }
    await rm(`./storage/${workspaceId}`, { recursive: true, force: true }).catch(() => undefined);
    await destroyTestWorkspace(workspaceId, userId);
    await prisma.$disconnect();
  }, 60_000);

  it('1. génère des idées scorées', async () => {
    const result = await generateIdeas({
      workspaceId,
      niche: 'DIY / bricolage',
      count: 3,
      language: 'fr',
      targetDurationSec: 30,
      difficulty: 'BEGINNER',
      budgetCents: 3000,
      goal: 'VIRALITY',
    });

    expect(result.ideaIds).toHaveLength(3);
    expect(result.isLive).toBe(false);

    const ideas = await prisma.idea.findMany({ where: { id: { in: result.ideaIds } } });
    for (const idea of ideas) {
      expect(idea.viralScore).toBeGreaterThanOrEqual(0);
      expect(idea.viralScore).toBeLessThanOrEqual(100);
      expect(idea.safetyScore).toBeGreaterThan(0);
      expect(idea.title.length).toBeGreaterThan(3);
    }

    ideaId = result.ideaIds[0] as string;
  }, 60_000);

  it('2. génère les cinq variantes de script', async () => {
    const result = await generateScripts({ workspaceId, ideaId, targetDurationSec: 30 });
    expect(result.scriptIds).toHaveLength(5);

    const scripts = await prisma.script.findMany({
      where: { id: { in: result.scriptIds } },
      include: { blocks: true },
    });
    const styles = scripts.map((s) => s.style).sort();
    expect(styles).toEqual(['DIRECT', 'EDUCATIONAL', 'MYSTERIOUS', 'STORYTELLING', 'VIRAL']);

    // Les durées des blocs doivent couvrir exactement la durée cible.
    for (const script of scripts) {
      const last = script.blocks.sort((a, b) => b.endMs - a.endMs)[0];
      expect(last?.endMs).toBe(30_000);
    }

    scriptId = scripts.find((s) => s.style === 'VIRAL')?.id ?? (result.scriptIds[0] as string);
  }, 60_000);

  it('3. retient une variante et la marque comme unique sélection', async () => {
    await selectScript(workspaceId, scriptId);
    const selected = await prisma.script.findMany({ where: { ideaId, isSelected: true } });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe(scriptId);
  });

  it('4. mesure la similarité au corpus existant', async () => {
    const result = await checkDuplication(workspaceId, scriptId);
    expect(result.method).toBe('lexical');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.threshold).toBeGreaterThan(0);
  }, 30_000);

  it('5. exécute le fact check', async () => {
    const result = await runFactCheck(workspaceId, scriptId);
    expect(Array.isArray(result.claims)).toBe(true);
  }, 30_000);

  it('6. crée la vidéo et son storyboard', async () => {
    const video = await prisma.video.create({
      data: {
        workspaceId,
        ideaId,
        scriptId,
        title: 'Test pipeline',
        targetDurationSec: 30,
        captionStyle: 'BOLD',
      },
    });
    videoId = video.id;

    const result = await generateStoryboard({ workspaceId, videoId });
    expect(result.sceneCount).toBeGreaterThan(0);
    // Les durées réparties doivent tomber exactement sur la durée cible.
    expect(result.totalDurationMs).toBe(30_000);

    const scenes = await prisma.scene.findMany({ where: { videoId }, orderBy: { order: 'asc' } });
    let cursor = 0;
    for (const s of scenes) {
      expect(s.startMs).toBe(cursor);
      cursor += s.durationMs;
    }
  }, 60_000);

  it('7. produit une piste voix réelle', async () => {
    const result = await generateVoice({ workspaceId, videoId, format: 'mp3' });
    expect(result.durationMs).toBeGreaterThan(0);

    const track = await prisma.voiceTrack.findUniqueOrThrow({ where: { id: result.voiceTrackId } });
    createdKeys.push(track.storageKey);

    const path = await storage().localPath(track.storageKey);
    const info = await probeMedia(path);
    expect(info.hasAudio).toBe(true);
    expect(info.durationMs).toBeGreaterThan(0);
  }, 120_000);

  it('8. produit les sous-titres aux trois formats', async () => {
    const result = await generateCaptions({ workspaceId, videoId, style: 'BOLD' });
    expect(result.cueCount).toBeGreaterThan(0);
    expect(result.method).toBe('estimated');

    const store = storage();
    for (const key of Object.values(result.keys)) {
      expect(key).not.toBe('');
      createdKeys.push(key);
      expect(await store.exists(key)).toBe(true);
    }

    const ass = (await store.get(result.keys.ass)).toString('utf-8');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('Dialogue:');

    const srt = (await store.get(result.keys.srt)).toString('utf-8');
    expect(srt).toMatch(/^1\n00:00:00,000 --> /);
  }, 60_000);

  it('9. rend un MP4 1080×1920 avec audio et sous-titres brûlés', async () => {
    const result = await renderVideo({ workspaceId, videoId, preset: 'draft' });
    createdKeys.push(result.masterKey, result.thumbnailKey);

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.sizeBytes).toBeGreaterThan(10_000);
    // Aucun asset rattaché: toutes les scènes sont rendues en ardoise.
    expect(result.placeholderScenes).toBeGreaterThan(0);

    const path = await storage().localPath(result.masterKey);
    const info = await probeMedia(path);
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(true);
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1920);
    // Les fondus sont compensés en amont: la durée rendue doit retomber sur la
    // cible. La tolérance couvre le calage de l'encodeur sur les images clés.
    expect(Math.abs(info.durationMs - 30_000)).toBeLessThan(400);

    const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(video.status).toBe('RENDERED');
    expect(video.masterKey).toBe(result.masterKey);
  }, 300_000);

  it('10. exécute le contrôle qualité sur le fichier réel', async () => {
    const report = await runQualityControl(workspaceId, videoId);

    expect(report.score).toBeGreaterThan(0);
    const byId = new Map(report.checks.map((c) => [c.id, c]));

    expect(byId.get('format')?.status).toBe('pass');
    expect(byId.get('resolution')?.status).toBe('pass');
    expect(byId.get('audio')?.status).toBe('pass');
    expect(byId.get('captions')?.status).toBe('pass');
    expect(byId.get('rights')?.status).toBe('pass');

    // Aucune version plateforme n'existe encore: les métadonnées manquent.
    expect(byId.get('metadata')?.status).toBe('fail');

    const stored = await prisma.qualityReport.findFirst({
      where: { videoId },
      orderBy: { createdAt: 'desc' },
    });
    expect(stored?.score).toBe(report.score);
  }, 120_000);

  it('11. décline la master pour deux plateformes', async () => {
    const versions = await buildPlatformVersions({
      workspaceId,
      videoId,
      platforms: ['TIKTOK', 'YOUTUBE_SHORTS'],
      metadata: {
        TIKTOK: {
          title: 'Test TikTok',
          description: 'Description TikTok',
          hashtags: ['bricolage', 'diy'],
          cta: 'Abonne-toi',
        },
        YOUTUBE_SHORTS: {
          title: 'Test Shorts',
          description: 'Description Shorts',
          hashtags: ['diy'],
          cta: 'Abonne-toi',
        },
      },
    });

    expect(versions).toHaveLength(2);
    for (const version of versions) {
      expect(version.storageKey).toBeTruthy();
      createdKeys.push(version.storageKey as string);
      const info = await probeMedia(await storage().localPath(version.storageKey as string));
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1920);
    }
  }, 300_000);

  it('12. agrège le coût de production', async () => {
    const cost = await videoCost(workspaceId, videoId);
    expect(cost.totalCents).toBeGreaterThanOrEqual(0);
    expect(cost.voiceCents).toBeGreaterThanOrEqual(0);
    // Les mocks ne coûtent rien: le total reflète la réalité, pas une estimation.
    expect(cost.roiPercent === null || typeof cost.roiPercent === 'number').toBe(true);
  });
});
