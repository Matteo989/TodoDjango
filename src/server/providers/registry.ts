import { env } from '@/lib/env';
import type { AIProvider } from './ai/types';
import { MockAIProvider } from './ai/mock';
import { OpenAIProvider } from './ai/openai';
import type { VoiceProvider } from './voice/types';
import { MockVoiceProvider } from './voice/mock';
import { ElevenLabsVoiceProvider } from './voice/elevenlabs';
import { OpenAIVoiceProvider } from './voice/openai';
import type { VideoProvider } from './video/types';
import { MockVideoProvider } from './video/mock';
import type { PublishingProvider } from './publishing/types';
import { ManualPublishingProvider } from './publishing/manual';
import { YouTubePublishingProvider } from './publishing/youtube';
import type { TrendProvider } from './trends/types';
import { ManualTrendProvider } from './trends/manual';

/**
 * Point unique de résolution des fournisseurs (§26).
 *
 * Règle: changer de fournisseur ne doit demander qu'une variable d'environnement.
 * Aucun `import` d'un SDK propriétaire n'existe en dehors de son implémentation.
 *
 * Règle n°2: si un fournisseur est demandé mais sa clé manque, on retombe sur le
 * mock au lieu de lever — l'application doit rester utilisable — mais le repli
 * est visible via `isLive` et signalé dans Settings.
 */

export function aiProvider(): AIProvider {
  const e = env();
  if (e.AI_PROVIDER === 'openai' && e.OPENAI_API_KEY) {
    return new OpenAIProvider({
      apiKey: e.OPENAI_API_KEY,
      baseUrl: e.OPENAI_BASE_URL,
      model: e.OPENAI_MODEL,
      embeddingModel: e.OPENAI_EMBEDDING_MODEL,
    });
  }
  return new MockAIProvider();
}

export function voiceProvider(): VoiceProvider {
  const e = env();
  if (e.VOICE_PROVIDER === 'elevenlabs' && e.ELEVENLABS_API_KEY) {
    return new ElevenLabsVoiceProvider(e.ELEVENLABS_API_KEY, e.ELEVENLABS_VOICE_ID);
  }
  if (e.VOICE_PROVIDER === 'openai' && e.OPENAI_API_KEY) {
    return new OpenAIVoiceProvider(e.OPENAI_API_KEY, e.OPENAI_BASE_URL, e.OPENAI_TTS_MODEL);
  }
  return new MockVoiceProvider();
}

export function videoProvider(): VideoProvider {
  // Runway / Kling / Veo: aucune implémentation fournie. Renvoyer un provider
  // vide serait présenter une fonctionnalité inexistante comme disponible.
  return new MockVideoProvider();
}

export function publishingProvider(): PublishingProvider {
  const e = env();
  if (e.PUBLISHING_PROVIDER === 'youtube' && e.YOUTUBE_CLIENT_ID && e.YOUTUBE_CLIENT_SECRET) {
    return new YouTubePublishingProvider();
  }
  return new ManualPublishingProvider();
}

export function trendProvider(): TrendProvider {
  return new ManualTrendProvider();
}
