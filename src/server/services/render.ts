import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../db';
import { buildKey, storage } from '../storage';
import { extractThumbnail, probeMedia, runFFmpeg } from '../render/ffmpeg';
import { buildRenderCommand, compensateForTransitions, type RenderScene } from '../render/filtergraph';
import { videoProvider } from '../providers/registry';
import { assertRenderable } from './rights';
import { musicSelectableForAutoPick } from '@/lib/rights';

/** Police utilisée pour les ardoises de scènes sans asset. */
const PLACEHOLDER_FONTS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
];

async function resolveFont(): Promise<string> {
  const { access } = await import('node:fs/promises');
  for (const candidate of PLACEHOLDER_FONTS) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Police suivante.
    }
  }
  throw new Error(
    "Aucune police TrueType trouvée pour les incrustations. Installez fonts-dejavu (Linux) ou définissez une police disponible.",
  );
}

export interface RenderVideoParams {
  workspaceId: string;
  videoId: string;
  preset?: 'draft' | 'final';
  onProgress?: (percent: number) => void;
}

export interface RenderOutcome {
  masterKey: string;
  thumbnailKey: string;
  durationMs: number;
  sizeBytes: number;
  width: number;
  height: number;
  /** Scènes rendues en ardoise faute d'asset rattaché. */
  placeholderScenes: number;
}

/**
 * Montage complet d'une vidéo (§13).
 *
 * Ordre des opérations, volontairement strict:
 *  1. vérification des droits — avant toute dépense CPU;
 *  2. matérialisation des sources sur disque (FFmpeg lit des fichiers);
 *  3. construction du graphe de filtres (pur, testable, loggable);
 *  4. exécution, puis extraction de la miniature et mesure du résultat réel.
 */
export async function renderVideo(params: RenderVideoParams): Promise<RenderOutcome> {
  const video = await prisma.video.findFirst({
    where: { id: params.videoId, workspaceId: params.workspaceId, deletedAt: null },
    include: {
      scenes: { orderBy: { order: 'asc' }, include: { asset: true } },
      voiceTracks: { orderBy: { createdAt: 'desc' }, take: 1 },
      captionTracks: true,
      music: true,
      template: true,
    },
  });
  if (!video) throw new Error('Vidéo introuvable.');
  if (video.scenes.length === 0) {
    throw new Error("Aucune scène à monter: générez le storyboard d'abord.");
  }

  // 1. Droits — lève une ComplianceError si un asset est 🔴, ou 🟠 en mode monétisable.
  await assertRenderable(params.workspaceId, video.id, video.monetizationReady);

  const store = storage();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'iavid-render-'));
  const fontFile = await resolveFont();

  try {
    await prisma.video.update({ where: { id: video.id }, data: { status: 'RENDERING' } });

    // 2. Sources
    const scenes: RenderScene[] = [];
    let placeholderScenes = 0;

    for (const scene of video.scenes) {
      const transition = normalizeTransition(scene.transition);

      if (scene.asset && scene.asset.kind !== 'AUDIO') {
        const localPath = await store.localPath(scene.asset.storageKey);
        scenes.push({
          durationMs: scene.durationMs,
          zoom: scene.zoom,
          transition,
          source:
            scene.asset.kind === 'VIDEO'
              ? {
                  kind: 'video',
                  path: localPath,
                  trimStartMs: scene.assetTrimStartMs ?? 0,
                  trimEndMs: scene.assetTrimEndMs ?? undefined,
                }
              : { kind: 'image', path: localPath },
        });
      } else {
        // Le libellé passe par un fichier: le texte contient des apostrophes et
        // des accents qui casseraient un drawtext inline.
        const labelFile = path.join(dir, `label-${scene.order}.txt`);
        await writeFile(
          labelFile,
          wrapForSlate(
            `SCÈNE ${scene.order + 1} — ${scene.section}\n\n${scene.visualPrompt || scene.caption || 'Plan à filmer'}`,
          ),
          'utf-8',
        );
        placeholderScenes += 1;
        scenes.push({
          durationMs: scene.durationMs,
          zoom: 1,
          transition,
          source: { kind: 'placeholder', labelFile },
        });
      }
    }

    const voiceTrack = video.voiceTracks[0];
    const voicePath = voiceTrack ? await store.localPath(voiceTrack.storageKey) : null;

    // Une musique aux droits inconnus n'est jamais montée automatiquement (§15).
    const musicPath =
      video.music && musicSelectableForAutoPick(video.music.commercialUse)
        ? await store.localPath(video.music.storageKey)
        : null;

    const assTrack = video.captionTracks.find(
      (t) => t.format === 'ass' && t.style === video.captionStyle,
    );
    let subtitlePath: string | null = null;
    if (assTrack) {
      // Le filtre ass est sensible aux chemins: on copie dans le dossier de
      // travail sous un nom simple, sans espace ni accent.
      subtitlePath = path.join(dir, 'captions.ass');
      await writeFile(subtitlePath, await store.get(assTrack.storageKey));
    }

    const outputPath = path.join(dir, 'master.mp4');

    // 3. Graphe de filtres. Les fondus se recouvrent: sans compensation, une
    // cible de 30 s rendrait un fichier plus court que ce que l'utilisateur a
    // demandé — et que ce que le contrôle qualité mesurera.
    const timedScenes = compensateForTransitions(scenes, video.targetDurationSec * 1000);

    const command = buildRenderCommand({
      outputPath,
      width: video.width,
      height: video.height,
      fps: video.fps,
      scenes: timedScenes,
      voicePath,
      musicPath,
      musicVolume: video.musicVolume,
      subtitlePath,
      watermarkPath: null,
      preset: params.preset ?? 'final',
      fontFile,
    });

    // 4. Exécution
    await runFFmpeg(command.args, {
      totalDurationMs: command.expectedDurationMs,
      onProgress: params.onProgress,
      timeoutMs: 30 * 60_000,
    });

    const info = await probeMedia(outputPath);
    const buffer = await readFile(outputPath);

    const masterKey = buildKey(params.workspaceId, 'renders', `${video.id}-master.mp4`);
    await store.put(masterKey, buffer, 'video/mp4');

    const thumbFile = path.join(dir, 'thumb.jpg');
    await extractThumbnail(outputPath, thumbFile, Math.min(1500, info.durationMs / 2));
    const thumbnailKey = buildKey(params.workspaceId, 'thumbnails', `${video.id}-master.jpg`);
    await store.put(thumbnailKey, await readFile(thumbFile), 'image/jpeg');

    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: 'RENDERED',
        masterKey,
        thumbnailKey,
        renderedDurationMs: info.durationMs,
        // Facturation du stockage: ~0,023 €/Go/mois arrondi au centime supérieur.
        costStorageCents: Math.max(1, Math.round((buffer.byteLength / 1_073_741_824) * 2.3)),
      },
    });

    return {
      masterKey,
      thumbnailKey,
      durationMs: info.durationMs,
      sizeBytes: buffer.byteLength,
      width: info.width ?? video.width,
      height: info.height ?? video.height,
      placeholderScenes,
    };
  } catch (error) {
    await prisma.video.update({ where: { id: video.id }, data: { status: 'FAILED' } });
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function normalizeTransition(value: string): RenderScene['transition'] {
  const allowed: RenderScene['transition'][] = ['cut', 'fade', 'wipeleft', 'slideup', 'circleopen'];
  return allowed.includes(value as RenderScene['transition'])
    ? (value as RenderScene['transition'])
    : 'fade';
}

function wrapForSlate(text: string, maxChars = 30): string {
  return text
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return [''];
      const words = line.split(/\s+/);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        if (!current) current = word;
        else if (current.length + 1 + word.length <= maxChars) current = `${current} ${word}`;
        else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines;
    })
    .join('\n');
}

/**
 * Génère les plans manquants avec le fournisseur vidéo IA, puis les rattache
 * aux scènes. Chaque plan devient un Asset AI_GENERATED avec ses droits.
 */
export async function generateSceneVideos(params: {
  workspaceId: string;
  videoId: string;
  onProgress?: (percent: number) => void;
}): Promise<{ generated: number; costCents: number; provider: string; isLive: boolean }> {
  const { createAsset } = await import('./assets');
  const provider = videoProvider();

  const scenes = await prisma.scene.findMany({
    where: { videoId: params.videoId, video: { workspaceId: params.workspaceId }, assetId: null },
    orderBy: { order: 'asc' },
    include: { video: { select: { width: true, height: true, fps: true } } },
  });

  let costCents = 0;
  let generated = 0;

  for (const [index, scene] of scenes.entries()) {
    const result = await provider.generateVideo({
      prompt: scene.visualPrompt || scene.caption || scene.narration,
      durationMs: scene.durationMs,
      width: scene.video.width,
      height: scene.video.height,
      fps: scene.video.fps,
    });

    const asset = await createAsset({
      workspaceId: params.workspaceId,
      filename: `scene-${scene.order + 1}.mp4`,
      mimeType: 'video/mp4',
      buffer: result.buffer,
      source: 'AI_GENERATED',
      name: `Scène ${scene.order + 1} — ${scene.section}`,
      notes: `Généré par ${result.provider}. Prompt: ${scene.visualPrompt}`,
    });

    await prisma.scene.update({ where: { id: scene.id }, data: { assetId: asset.id } });
    costCents += result.costCents;
    generated += 1;
    params.onProgress?.(Math.round(((index + 1) / scenes.length) * 100));
  }

  if (costCents > 0) {
    await prisma.video.update({
      where: { id: params.videoId },
      data: { costVideoAiCents: { increment: Math.round(costCents) } },
    });
  }

  return { generated, costCents, provider: provider.id, isLive: provider.isLive };
}
