import type { CaptionStyle } from '@prisma/client';
import { prisma } from '../db';
import { buildKey, storage } from '../storage';
import { estimateCues, toAss, toSrt, toVtt, type CaptionCue } from '../render/captions';

export interface GenerateCaptionsParams {
  workspaceId: string;
  videoId: string;
  style?: CaptionStyle;
  fontName?: string;
  fontSizePx?: number;
  primaryColor?: string;
  accentColor?: string;
  position?: 'top' | 'center' | 'bottom';
}

export interface CaptionsOutcome {
  cueCount: number;
  method: 'estimated' | 'whisper';
  keys: { srt: string; vtt: string; ass: string };
}

/**
 * Produit les trois formats de sous-titres (§14).
 *
 * `method` est stockée et affichée: quand aucune transcription n'est possible,
 * les timings sont calés sur les durées de scènes et pondérés par la longueur
 * du texte. C'est une estimation, jamais présentée comme une transcription.
 */
export async function generateCaptions(
  params: GenerateCaptionsParams,
): Promise<CaptionsOutcome> {
  const video = await prisma.video.findFirst({
    where: { id: params.videoId, workspaceId: params.workspaceId, deletedAt: null },
    include: {
      scenes: { orderBy: { order: 'asc' } },
      template: true,
      script: true,
    },
  });
  if (!video) throw new Error('Vidéo introuvable.');
  if (video.scenes.length === 0) {
    throw new Error("Aucune scène: générez le storyboard avant les sous-titres.");
  }

  const cues: CaptionCue[] = estimateCues(
    video.scenes.map((scene) => ({
      // La narration porte le texte prononcé; le champ caption sert de repli
      // quand la scène n'a pas de voix off (plan muet avec incrustation).
      text: scene.narration.trim() || scene.caption.trim(),
      startMs: scene.startMs,
      durationMs: scene.durationMs,
    })),
  );

  const style = params.style ?? video.captionStyle;
  const opts = {
    style,
    fontName: params.fontName ?? video.template?.captionFont ?? 'DejaVu Sans',
    fontSizePx: params.fontSizePx ?? video.template?.captionSizePx ?? 72,
    primaryColor: params.primaryColor ?? video.template?.captionPrimaryColor ?? '#FFFFFF',
    accentColor: params.accentColor ?? video.template?.captionAccentColor ?? '#FFD400',
    position:
      params.position ??
      ((video.template?.captionPosition as 'top' | 'center' | 'bottom' | undefined) ?? 'center'),
    width: video.width,
    height: video.height,
  };

  const store = storage();
  const outputs = {
    srt: { content: toSrt(cues), mime: 'application/x-subrip' },
    vtt: { content: toVtt(cues), mime: 'text/vtt' },
    ass: { content: toAss(cues, opts), mime: 'text/x-ssa' },
  } as const;

  const keys: Record<string, string> = {};

  for (const [format, { content, mime }] of Object.entries(outputs)) {
    const key = buildKey(params.workspaceId, 'captions', `${video.id}-${style.toLowerCase()}.${format}`);
    await store.put(key, Buffer.from(content, 'utf-8'), mime);
    keys[format] = key;

    await prisma.captionTrack.upsert({
      where: { videoId_format_style: { videoId: video.id, format, style } },
      create: {
        videoId: video.id,
        format,
        style,
        language: video.script?.language ?? 'fr',
        storageKey: key,
        method: 'estimated',
      },
      update: { storageKey: key, method: 'estimated' },
    });
  }

  await prisma.video.update({ where: { id: video.id }, data: { captionStyle: style } });

  return {
    cueCount: cues.length,
    method: 'estimated',
    keys: {
      srt: keys['srt'] ?? '',
      vtt: keys['vtt'] ?? '',
      ass: keys['ass'] ?? '',
    },
  };
}
