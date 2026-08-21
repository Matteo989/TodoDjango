import type { TrendItem, TrendProvider } from './types';

/**
 * Source de tendances par défaut: ce que l'utilisateur a saisi ou importé.
 *
 * Aucune collecte automatique. Pour brancher une source officielle (YouTube
 * Data API, Google Trends via un export autorisé, base sectorielle sous
 * licence), implémentez TrendProvider — voir docs/PROVIDERS.md.
 */
export class ManualTrendProvider implements TrendProvider {
  readonly id = 'manual';
  readonly isLive = false;
  readonly sourceDescription =
    "Saisie et import manuels. IAvid ne collecte aucune donnée de plateforme automatiquement.";

  async fetchTrends(): Promise<TrendItem[]> {
    return [];
  }
}
