import type { Platform } from '@prisma/client';
import type { PublishInput, PublishResult, PublishingProvider } from './types';

/**
 * Mode par défaut (§18).
 *
 * Ce n'est pas un repli dégradé mais le comportement attendu quand aucune API
 * officielle ne couvre l'opération: l'app prépare le fichier et les métadonnées,
 * l'utilisateur publie lui-même. Aucun contournement de plateforme.
 */

const REASONS: Record<Platform, string> = {
  YOUTUBE_SHORTS:
    "API YouTube non configurée. Renseignez YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET et connectez le compte pour publier depuis IAvid.",
  TIKTOK:
    "L'API TikTok Content Posting exige une application approuvée par TikTok. Tant que ce n'est pas le cas, la publication reste manuelle.",
  INSTAGRAM_REELS:
    "L'API Instagram (Graph) exige un compte Business lié à une Page Facebook et une app Meta validée.",
  SNAPCHAT_SPOTLIGHT:
    "Snapchat ne propose pas d'API publique de publication vers Spotlight. La publication est manuelle par conception.",
};

export class ManualPublishingProvider implements PublishingProvider {
  readonly id = 'manual';
  readonly isLive = false;

  supports(_platform: Platform): boolean {
    // Toujours vrai: le mode manuel est disponible pour toutes les plateformes.
    void _platform;
    return true;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    return {
      outcome: 'MANUAL_REQUIRED',
      manualReason: REASONS[input.platform],
    };
  }
}
