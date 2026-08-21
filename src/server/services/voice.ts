import { prisma } from '../db';
import { buildKey, storage } from '../storage';
import { voiceProvider } from '../providers/registry';

export interface GenerateVoiceParams {
  workspaceId: string;
  videoId: string;
  voiceId?: string;
  language?: string;
  speed?: number;
  stability?: number;
  tone?: string;
  format?: 'mp3' | 'wav';
}

export interface VoiceOutcome {
  voiceTrackId: string;
  durationMs: number;
  costCents: number;
  provider: string;
  isLive: boolean;
}

/**
 * Génère la voix off d'une vidéo à partir de la narration de ses scènes.
 *
 * Le texte vient du storyboard, pas du script brut: c'est le storyboard qui
 * porte le découpage réellement monté, et donc l'ordre exact de la narration.
 */
export async function generateVoice(params: GenerateVoiceParams): Promise<VoiceOutcome> {
  const video = await prisma.video.findFirst({
    where: { id: params.videoId, workspaceId: params.workspaceId, deletedAt: null },
    include: { scenes: { orderBy: { order: 'asc' } }, script: true },
  });
  if (!video) throw new Error('Vidéo introuvable.');

  const narration = video.scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean)
    .join(' ');

  const text = narration || video.script?.fullText || '';
  if (!text.trim()) {
    throw new Error(
      "Aucun texte à vocaliser: générez le storyboard ou renseignez la narration des scènes.",
    );
  }

  const provider = voiceProvider();
  const format = params.format ?? 'mp3';

  const audio = await provider.generateVoice({
    text,
    language: params.language ?? video.script?.language ?? 'fr',
    voiceId: params.voiceId ?? '',
    speed: params.speed ?? 1.0,
    stability: params.stability ?? 0.5,
    tone: params.tone,
    format,
  });

  const key = buildKey(params.workspaceId, 'voice', `${video.id}-voice.${format}`);
  await storage().put(key, audio.buffer, format === 'mp3' ? 'audio/mpeg' : 'audio/wav');

  // Une seule piste voix par vidéo: régénérer remplace, pour éviter qu'un
  // montage reprenne par erreur une version précédente.
  await prisma.voiceTrack.deleteMany({ where: { videoId: video.id } });

  const track = await prisma.voiceTrack.create({
    data: {
      workspaceId: params.workspaceId,
      videoId: video.id,
      provider: audio.provider,
      voiceId: audio.voiceId,
      language: params.language ?? video.script?.language ?? 'fr',
      speed: params.speed ?? 1.0,
      stability: params.stability ?? 0.5,
      tone: params.tone ?? null,
      text,
      storageKey: key,
      format,
      durationMs: audio.durationMs,
      costCents: Math.round(audio.costCents),
    },
  });

  await prisma.video.update({
    where: { id: video.id },
    data: {
      status: video.status === 'STORYBOARD' || video.status === 'DRAFT' ? 'VOICE' : video.status,
      costVoiceCents: { increment: Math.round(audio.costCents) },
    },
  });

  return {
    voiceTrackId: track.id,
    durationMs: audio.durationMs,
    costCents: audio.costCents,
    provider: audio.provider,
    isLive: provider.isLive,
  };
}

export async function listAvailableVoices(language = 'fr') {
  const provider = voiceProvider();
  const voices = await provider.listVoices(language);
  return { voices, provider: provider.id, isLive: provider.isLive };
}
