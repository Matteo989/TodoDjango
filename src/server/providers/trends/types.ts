import type { Platform, TrendKind } from '@prisma/client';

/**
 * Source de tendances (§5).
 *
 * Contrat explicite: une implémentation ne doit lire que des APIs officielles
 * ou des jeux de données que l'utilisateur a le droit d'exploiter. Le scraping
 * de plateformes est hors périmètre — voir docs/COMPLIANCE.md.
 */
export interface TrendItem {
  kind: TrendKind;
  value: string;
  platform?: Platform | null;
  weight?: number;
  season?: string | null;
  notes?: string;
}

export interface TrendProvider {
  readonly id: string;
  readonly isLive: boolean;
  /** Décrit d'où viennent les données, affiché dans l'UI à côté des résultats. */
  readonly sourceDescription: string;
  fetchTrends(params: { niche: string; locale: string; limit: number }): Promise<TrendItem[]>;
}
