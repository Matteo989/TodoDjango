import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { synthesizePlaceholderAudio } from '@/server/render/ffmpeg';
import type { AudioAsset, VoiceInput, VoiceOption, VoiceProvider } from './types';

/**
 * Voix de repli. Ne produit PAS de parole — elle produit une piste silencieuse
 * de la bonne durée, calculée sur un débit réaliste.
 *
 * Pourquoi ce n'est pas un bouchon vide: le montage, les sous-titres et le
 * contrôle qualité ont besoin d'un fichier audio réel et d'une durée juste pour
 * s'exécuter. L'UI indique clairement qu'aucune voix n'est configurée.
 */

/** Mots par minute en narration courte, français et anglais confondus. */
const WORDS_PER_MINUTE = 150;

export function estimateSpeechDurationMs(text: string, speed: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  const baseMs = (words / WORDS_PER_MINUTE) * 60_000;
  return Math.round(baseMs / Math.max(0.5, speed));
}

export class MockVoiceProvider implements VoiceProvider {
  readonly id = 'mock';
  readonly isLive = false;

  async listVoices(language = 'fr'): Promise<VoiceOption[]> {
    return [
      {
        id: 'mock-neutral',
        name: 'Voix de démonstration (silencieuse)',
        language,
        description:
          "Piste muette à la durée correcte. Configurez VOICE_PROVIDER et sa clé pour une vraie voix off.",
      },
    ];
  }

  async generateVoice(input: VoiceInput): Promise<AudioAsset> {
    const durationMs = Math.max(500, estimateSpeechDurationMs(input.text, input.speed));
    const dir = await mkdtemp(path.join(os.tmpdir(), 'iavid-voice-'));
    const file = path.join(dir, `voice.${input.format}`);
    try {
      await synthesizePlaceholderAudio(file, durationMs, input.format);
      const buffer = await readFile(file);
      return {
        buffer,
        format: input.format,
        durationMs,
        costCents: 0,
        provider: this.id,
        voiceId: input.voiceId || 'mock-neutral',
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
