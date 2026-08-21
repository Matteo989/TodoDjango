import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probeMedia } from '@/server/render/ffmpeg';
import type { AudioAsset, VoiceInput, VoiceOption, VoiceProvider } from './types';

const API_BASE = 'https://api.elevenlabs.io/v1';

/** Tarif indicatif ElevenLabs, en centimes d'euro par millier de caractères. */
const CENTS_PER_1K_CHARS = 22;

export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly id = 'elevenlabs';
  readonly isLive = true;
  private readonly apiKey: string;
  private readonly defaultVoiceId: string;

  constructor(apiKey: string, defaultVoiceId: string) {
    if (!apiKey) throw new Error('ElevenLabsVoiceProvider requiert ELEVENLABS_API_KEY.');
    this.apiKey = apiKey;
    this.defaultVoiceId = defaultVoiceId;
  }

  async listVoices(language?: string): Promise<VoiceOption[]> {
    const response = await fetch(`${API_BASE}/voices`, {
      headers: { 'xi-api-key': this.apiKey },
    });
    if (!response.ok) {
      throw new Error(`ElevenLabs /voices ${response.status}: ${await response.text()}`);
    }
    const json = (await response.json()) as {
      voices?: Array<{ voice_id: string; name: string; labels?: Record<string, string> }>;
    };
    return (json.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      language: language ?? v.labels?.['language'] ?? 'multi',
      gender: v.labels?.['gender'],
      description: v.labels?.['description'],
    }));
  }

  async generateVoice(input: VoiceInput): Promise<AudioAsset> {
    const voiceId = input.voiceId || this.defaultVoiceId;
    if (!voiceId) throw new Error('Aucune voix ElevenLabs sélectionnée (ELEVENLABS_VOICE_ID).');

    const response = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: input.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      },
      body: JSON.stringify({
        text: input.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: input.stability,
          similarity_boost: 0.75,
          speed: input.speed,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `ElevenLabs text-to-speech ${response.status}: ${(await response.text()).slice(0, 400)}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    // La durée réelle vient du fichier, pas d'une estimation: le montage
    // s'appuie dessus pour caler les scènes.
    const durationMs = await measureDuration(buffer, input.format);

    return {
      buffer,
      format: input.format,
      durationMs,
      costCents: Math.round((input.text.length / 1000) * CENTS_PER_1K_CHARS),
      provider: this.id,
      voiceId,
    };
  }
}

export async function measureDuration(buffer: Buffer, format: string): Promise<number> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'iavid-probe-'));
  const file = path.join(dir, `audio.${format}`);
  try {
    await writeFile(file, buffer);
    const info = await probeMedia(file);
    return info.durationMs;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
