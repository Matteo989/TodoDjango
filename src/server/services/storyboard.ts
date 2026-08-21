import { z } from 'zod';
import type { ScriptSection } from '@prisma/client';
import { prisma } from '../db';
import { aiProvider } from '../providers/registry';
import { distribute } from '@/lib/utils';
import { buildStoryboardPrompt, PROMPT_VERSIONS, STORYBOARD_SCHEMA_HINT, SYSTEM_PROMPT } from './prompts';

const sceneSchema = z.object({
  section: z.enum(['HOOK', 'PROBLEM', 'SOLUTION', 'RESULT', 'CTA']).default('SOLUTION'),
  narration: z.string().default(''),
  visualPrompt: z.string().default(''),
  caption: z.string().default(''),
  transition: z.enum(['cut', 'fade', 'wipeleft', 'slideup', 'circleopen']).default('fade'),
});

const storyboardSchema = z.object({ scenes: z.array(sceneSchema).min(1) });

export interface GenerateStoryboardParams {
  workspaceId: string;
  videoId: string;
}

export interface StoryboardOutcome {
  sceneCount: number;
  totalDurationMs: number;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costCents: number };
}

/**
 * Génère le storyboard d'une vidéo à partir de son script (§12).
 * Remplace intégralement les scènes existantes: relancer l'étape est explicite,
 * pas cumulatif.
 */
export async function generateStoryboard(
  params: GenerateStoryboardParams,
): Promise<StoryboardOutcome> {
  const video = await prisma.video.findFirst({
    where: { id: params.videoId, workspaceId: params.workspaceId, deletedAt: null },
    include: { script: { include: { blocks: { orderBy: { order: 'asc' } } } }, template: true },
  });
  if (!video) throw new Error('Vidéo introuvable.');
  if (!video.script) throw new Error("Cette vidéo n'a pas de script: générez-en un d'abord.");

  const totalMs = video.targetDurationSec * 1000;
  const provider = aiProvider();

  const response = await provider.generateStructuredOutput<unknown>(
    buildStoryboardPrompt(video.script.fullText, video.targetDurationSec),
    'Storyboard',
    STORYBOARD_SCHEMA_HINT,
    { system: SYSTEM_PROMPT, temperature: 0.6, promptVersion: PROMPT_VERSIONS.storyboard },
  );

  const parsed = storyboardSchema.safeParse(response.data);
  const scenes = parsed.success
    ? parsed.data.scenes
    : // Repli déterministe: un bloc de script = une scène. Mieux vaut un
      // storyboard correct issu du script qu'un échec de l'étape.
      video.script.blocks.map((block) => ({
        section: block.section,
        narration: block.text,
        visualPrompt: block.visualDirection ?? block.text,
        caption: block.text.split(/\s+/).slice(0, 6).join(' '),
        transition: 'fade' as const,
      }));

  // Les durées sont réparties au prorata du texte de narration: une scène qui
  // dit trois mots ne doit pas durer autant qu'une scène de deux phrases.
  const weights = scenes.map((s) => Math.max(1, s.narration.trim().length || 20));
  const durations = distribute(totalMs, weights);

  let cursor = 0;
  const data = scenes.map((scene, index) => {
    const durationMs = durations[index] ?? 0;
    const startMs = cursor;
    cursor += durationMs;
    return {
      videoId: video.id,
      order: index,
      section: scene.section as ScriptSection,
      startMs,
      durationMs,
      narration: scene.narration,
      visualPrompt: scene.visualPrompt,
      caption: scene.caption,
      transition: video.template?.transition ?? scene.transition,
      zoom: 1.08,
    };
  });

  await prisma.$transaction([
    prisma.scene.deleteMany({ where: { videoId: video.id } }),
    prisma.scene.createMany({ data }),
    prisma.video.update({
      where: { id: video.id },
      data: { status: video.status === 'DRAFT' ? 'STORYBOARD' : video.status },
    }),
  ]);

  return {
    sceneCount: data.length,
    totalDurationMs: cursor,
    provider: response.provider,
    model: response.model,
    usage: response.usage,
  };
}

/** Recalcule les `startMs` après un réordonnancement ou un changement de durée. */
export async function resequenceScenes(videoId: string): Promise<number> {
  const scenes = await prisma.scene.findMany({
    where: { videoId },
    orderBy: { order: 'asc' },
    select: { id: true, durationMs: true },
  });

  let cursor = 0;
  await prisma.$transaction(
    scenes.map((scene, index) => {
      const startMs = cursor;
      cursor += scene.durationMs;
      return prisma.scene.update({
        where: { id: scene.id },
        data: { order: index, startMs },
      });
    }),
  );

  return cursor;
}

export interface UpdateSceneInput {
  workspaceId: string;
  sceneId: string;
  narration?: string;
  visualPrompt?: string;
  caption?: string;
  durationMs?: number;
  transition?: string;
  zoom?: number;
  assetId?: string | null;
  assetTrimStartMs?: number | null;
  assetTrimEndMs?: number | null;
}

export async function updateScene(input: UpdateSceneInput) {
  const scene = await prisma.scene.findFirst({
    where: { id: input.sceneId, video: { workspaceId: input.workspaceId } },
    select: { id: true, videoId: true },
  });
  if (!scene) throw new Error('Scène introuvable.');

  if (input.assetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: input.assetId, workspaceId: input.workspaceId, deletedAt: null },
      select: { id: true, kind: true },
    });
    if (!asset) throw new Error('Asset introuvable dans ce workspace.');
    if (asset.kind === 'AUDIO') {
      throw new Error("Un asset audio ne peut pas servir de visuel de scène.");
    }
  }

  const updated = await prisma.scene.update({
    where: { id: scene.id },
    data: {
      ...(input.narration !== undefined ? { narration: input.narration } : {}),
      ...(input.visualPrompt !== undefined ? { visualPrompt: input.visualPrompt } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.durationMs !== undefined ? { durationMs: Math.max(300, input.durationMs) } : {}),
      ...(input.transition !== undefined ? { transition: input.transition } : {}),
      ...(input.zoom !== undefined ? { zoom: input.zoom } : {}),
      ...(input.assetId !== undefined ? { assetId: input.assetId } : {}),
      ...(input.assetTrimStartMs !== undefined ? { assetTrimStartMs: input.assetTrimStartMs } : {}),
      ...(input.assetTrimEndMs !== undefined ? { assetTrimEndMs: input.assetTrimEndMs } : {}),
    },
  });

  if (input.durationMs !== undefined) await resequenceScenes(scene.videoId);
  return updated;
}

export async function reorderScenes(
  workspaceId: string,
  videoId: string,
  orderedSceneIds: string[],
): Promise<void> {
  const scenes = await prisma.scene.findMany({
    where: { videoId, video: { workspaceId } },
    select: { id: true },
  });
  const known = new Set(scenes.map((s) => s.id));
  if (orderedSceneIds.length !== known.size || orderedSceneIds.some((id) => !known.has(id))) {
    throw new Error("La liste fournie ne correspond pas aux scènes de cette vidéo.");
  }

  await prisma.$transaction(
    orderedSceneIds.map((id, index) => prisma.scene.update({ where: { id }, data: { order: index } })),
  );
  await resequenceScenes(videoId);
}
