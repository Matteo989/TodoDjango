import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionToken, readSessionToken } from '@/server/auth/session';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { listIdeas, duplicateIdea, archiveIdea, softDeleteIdea } from '@/server/services/ideas';
import { updateScene, reorderScenes, resequenceScenes } from '@/server/services/storyboard';
import { createTestWorkspace, destroyTestWorkspace, prisma } from '../helpers/db';

describe('mots de passe', () => {
  it('vérifie un mot de passe correct et rejette un mauvais', async () => {
    const hash = await hashPassword('un-mot-de-passe-solide');
    expect(await verifyPassword('un-mot-de-passe-solide', hash)).toBe(true);
    expect(await verifyPassword('autre-chose', hash)).toBe(false);
  });

  it("ne stocke jamais le mot de passe en clair", async () => {
    const hash = await hashPassword('secret-en-clair');
    expect(hash).not.toContain('secret-en-clair');
    expect(hash.startsWith('$2')).toBe(true);
  });
});

describe('jetons de session', () => {
  const payload = { userId: 'u1', email: 'a@b.c', name: 'A', workspaceId: 'w1' };

  it('fait un aller-retour fidèle', async () => {
    const token = await createSessionToken(payload);
    expect(await readSessionToken(token)).toMatchObject(payload);
  });

  it('rejette un jeton falsifié', async () => {
    const token = await createSessionToken(payload);
    const tampered = `${token.slice(0, -6)}AAAAAA`;
    expect(await readSessionToken(tampered)).toBeNull();
  });

  it('rejette un jeton qui n’en est pas un', async () => {
    expect(await readSessionToken('pas.un.jwt')).toBeNull();
    expect(await readSessionToken('')).toBeNull();
  });
});

describe('isolation entre workspaces', () => {
  let a: { workspaceId: string; userId: string };
  let b: { workspaceId: string; userId: string };
  let ideaInA: string;

  beforeAll(async () => {
    a = await createTestWorkspace('iso-a');
    b = await createTestWorkspace('iso-b');

    const idea = await prisma.idea.create({
      data: { workspaceId: a.workspaceId, title: 'Idée confidentielle du workspace A' },
    });
    ideaInA = idea.id;
  });

  afterAll(async () => {
    await destroyTestWorkspace(a.workspaceId, a.userId);
    await destroyTestWorkspace(b.workspaceId, b.userId);
    await prisma.$disconnect();
  });

  it("ne liste pas les idées d'un autre workspace", async () => {
    const listA = await listIdeas({ workspaceId: a.workspaceId });
    const listB = await listIdeas({ workspaceId: b.workspaceId });

    expect(listA.items.map((i) => i.id)).toContain(ideaInA);
    expect(listB.items.map((i) => i.id)).not.toContain(ideaInA);
  });

  it("refuse de dupliquer l'idée d'un autre workspace", async () => {
    await expect(duplicateIdea(b.workspaceId, ideaInA)).rejects.toThrow(/introuvable/i);
  });

  it("refuse d'archiver l'idée d'un autre workspace", async () => {
    await expect(archiveIdea(b.workspaceId, ideaInA)).rejects.toThrow(/introuvable/i);
  });

  it("refuse de supprimer l'idée d'un autre workspace", async () => {
    await expect(softDeleteIdea(b.workspaceId, ideaInA)).rejects.toThrow(/introuvable/i);
  });

  it("refuse de modifier la scène d'un autre workspace", async () => {
    const video = await prisma.video.create({
      data: { workspaceId: a.workspaceId, title: 'Vidéo A' },
    });
    const sceneRow = await prisma.scene.create({
      data: { videoId: video.id, order: 0, startMs: 0, durationMs: 3000 },
    });

    await expect(
      updateScene({ workspaceId: b.workspaceId, sceneId: sceneRow.id, caption: 'piraté' }),
    ).rejects.toThrow(/introuvable/i);
  });
});

describe('opérations sur le storyboard', () => {
  let workspaceId: string;
  let userId: string;
  let videoId: string;
  let sceneIds: string[];

  beforeAll(async () => {
    ({ workspaceId, userId } = await createTestWorkspace('storyboard'));
    const video = await prisma.video.create({ data: { workspaceId, title: 'Storyboard' } });
    videoId = video.id;

    await prisma.scene.createMany({
      data: [0, 1, 2].map((order) => ({
        videoId,
        order,
        startMs: order * 3000,
        durationMs: 3000,
        caption: `Scène ${order + 1}`,
      })),
    });

    sceneIds = (
      await prisma.scene.findMany({ where: { videoId }, orderBy: { order: 'asc' } })
    ).map((s) => s.id);
  });

  afterAll(async () => {
    await destroyTestWorkspace(workspaceId, userId);
    await prisma.$disconnect();
  });

  it('recalcule les startMs après un changement de durée', async () => {
    await updateScene({ workspaceId, sceneId: sceneIds[0] as string, durationMs: 5000 });
    const scenes = await prisma.scene.findMany({ where: { videoId }, orderBy: { order: 'asc' } });

    expect(scenes[0]?.startMs).toBe(0);
    expect(scenes[1]?.startMs).toBe(5000);
    expect(scenes[2]?.startMs).toBe(8000);
  });

  it('impose une durée de scène minimale', async () => {
    await updateScene({ workspaceId, sceneId: sceneIds[1] as string, durationMs: 10 });
    const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneIds[1] as string } });
    expect(scene.durationMs).toBe(300);
  });

  it('réordonne les scènes et recale la timeline', async () => {
    const reversed = [...sceneIds].reverse();
    await reorderScenes(workspaceId, videoId, reversed);

    const scenes = await prisma.scene.findMany({ where: { videoId }, orderBy: { order: 'asc' } });
    expect(scenes.map((s) => s.id)).toEqual(reversed);
    expect(scenes[0]?.startMs).toBe(0);
    expect(scenes[1]?.startMs).toBe(scenes[0]?.durationMs);
  });

  it('refuse une liste de réordonnancement incomplète', async () => {
    await expect(
      reorderScenes(workspaceId, videoId, [sceneIds[0] as string]),
    ).rejects.toThrow(/ne correspond pas/i);
  });

  it("refuse d'utiliser un asset audio comme visuel de scène", async () => {
    const audio = await prisma.asset.create({
      data: {
        workspaceId,
        kind: 'AUDIO',
        source: 'OWNED',
        name: 'Bruitage',
        storageKey: `${workspaceId}/assets/son.mp3`,
        mimeType: 'audio/mpeg',
      },
    });

    await expect(
      updateScene({ workspaceId, sceneId: sceneIds[0] as string, assetId: audio.id }),
    ).rejects.toThrow(/audio/i);
  });

  it('renvoie la durée totale après recalage', async () => {
    const total = await resequenceScenes(videoId);
    const scenes = await prisma.scene.findMany({ where: { videoId } });
    expect(total).toBe(scenes.reduce((sum, s) => sum + s.durationMs, 0));
  });
});
