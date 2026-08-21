import type { Platform } from '@prisma/client';

export interface PublishInput {
  platform: Platform;
  /** Chemin local du fichier prêt à publier. */
  filePath: string;
  title: string;
  description: string;
  hashtags: string[];
  scheduledAt?: Date | null;
  /** Credentials OAuth du compte social, résolus par le service. */
  accountToken?: string | null;
}

export type PublishOutcome = 'PUBLISHED' | 'SCHEDULED' | 'MANUAL_REQUIRED' | 'FAILED';

export interface PublishResult {
  outcome: PublishOutcome;
  externalId?: string;
  externalUrl?: string;
  /**
   * Renseigné quand l'API officielle ne couvre pas l'opération.
   * Aucune implémentation ne doit contourner la plateforme pour l'éviter.
   */
  manualReason?: string;
  error?: string;
}

export interface PublishingProvider {
  readonly id: string;
  readonly isLive: boolean;
  supports(platform: Platform): boolean;
  publish(input: PublishInput): Promise<PublishResult>;
}
