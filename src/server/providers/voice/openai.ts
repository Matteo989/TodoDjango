import { measureDuration } from './elevenlabs';
import type { AudioAsset, VoiceInput, VoiceOption, VoiceProvider } from './types';

/** Tarif indicatif OpenAI TTS, en centimes d'euro par millier de caractères. */
const CENTS_PER_1K_CHARS = 1.4;

const BUILT_IN_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

export class OpenAIVoiceProvider implements VoiceProvider {
  readonly id = 'openai';
  readonly isLive = true;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {
    if (!apiKey) throw new Error('OpenAIVoiceProvider requiert OPENAI_API_KEY.');
  }

  async listVoices(language = 'fr'): Promise<VoiceOption[]> {
    return BUILT_IN_VOICES.map((id) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      language,
      description: 'Voix intégrée OpenAI, multilingue.',
    }));
  }

  async generateVoice(input: VoiceInput): Promise<AudioAsset> {
    const voiceId = input.voiceId || 'alloy';
    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        voice: voiceId,
        input: input.text,
        response_format: input.format,
        speed: Math.max(0.25, Math.min(4, input.speed)),
        ...(input.tone ? { instructions: `Ton: ${input.tone}` } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS ${response.status}: ${(await response.text()).slice(0, 400)}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      format: input.format,
      durationMs: await measureDuration(buffer, input.format),
      costCents: Math.round((input.text.length / 1000) * CENTS_PER_1K_CHARS * 100) / 100,
      provider: this.id,
      voiceId,
    };
  }
}
