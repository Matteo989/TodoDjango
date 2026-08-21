export interface VoiceInput {
  text: string;
  language: string;
  voiceId: string;
  /** 0.5–2.0 */
  speed: number;
  /** 0–1, pertinence selon fournisseur (ElevenLabs). */
  stability: number;
  tone?: string;
  format: 'mp3' | 'wav';
}

export interface AudioAsset {
  /** Contenu binaire; le service décide où il est stocké. */
  buffer: Buffer;
  format: 'mp3' | 'wav';
  durationMs: number;
  costCents: number;
  provider: string;
  voiceId: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  gender?: string;
  description?: string;
}

export interface VoiceProvider {
  readonly id: string;
  readonly isLive: boolean;
  listVoices(language?: string): Promise<VoiceOption[]>;
  generateVoice(input: VoiceInput): Promise<AudioAsset>;
}
