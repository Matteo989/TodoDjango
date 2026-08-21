import { clamp } from './utils';
import { safetyScoreCap } from './safety';

/**
 * Scoring 0–100 des idées (§4).
 *
 * Ces scores sont calculés localement à partir de signaux observables, puis
 * éventuellement ajustés par le provider IA. Les garder déterministes garantit
 * qu'une idée reçoit un score même en mode mock, et que deux idées identiques
 * ne sont pas classées différemment d'une exécution à l'autre.
 */

export interface IdeaSignals {
  title: string;
  hook?: string | null;
  concept?: string | null;
  description?: string | null;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
  estimatedCostCents: number;
  targetDurationSec: number;
  affiliateProductCount: number;
  /** Similarité maximale à un contenu existant (0–100). */
  maxSimilarity: number;
}

export interface IdeaScores {
  viralScore: number;
  originalityScore: number;
  productionScore: number;
  affiliateScore: number;
  safetyScore: number;
}

/** Marqueurs de format connus pour retenir l'attention en vertical court. */
const HOOK_PATTERNS: ReadonlyArray<{ re: RegExp; weight: number }> = [
  { re: /^\s*(arretez|stop|n['’]achetez|ne faites)/i, weight: 14 },
  { re: /\b(\d+)\s*(secondes?|minutes?|euros?|€)\b/i, weight: 12 },
  { re: /\b(erreur|piege|arnaque|mythe|faux)\b/i, weight: 11 },
  { re: /\b(personne ne|99\s*%|la plupart des gens)\b/i, weight: 10 },
  { re: /\b(avant|apres)\b.*\b(apres|avant)\b/i, weight: 9 },
  { re: /\?/, weight: 6 },
  { re: /\b(astuce|hack|truc)\b/i, weight: 6 },
];

const DIFFICULTY_PRODUCTION_PENALTY: Record<IdeaSignals['difficulty'], number> = {
  BEGINNER: 0,
  INTERMEDIATE: 12,
  ADVANCED: 28,
  EXPERT: 45,
};

export function scoreIdea(signals: IdeaSignals): IdeaScores {
  const text = [signals.title, signals.hook, signals.concept, signals.description]
    .filter(Boolean)
    .join('\n');

  // VIRAL — force du hook, format court, promesse chiffrée.
  let viral = 40;
  for (const { re, weight } of HOOK_PATTERNS) {
    if (re.test(signals.hook ?? signals.title)) viral += weight;
  }
  if (signals.targetDurationSec <= 30) viral += 8;
  else if (signals.targetDurationSec > 90) viral -= 12;
  if (signals.title.length > 80) viral -= 8;

  // ORIGINALITY — l'inverse de la proximité au déjà-produit.
  const originality = clamp(Math.round(100 - signals.maxSimilarity * 0.9), 0, 100);

  // PRODUCTION — faisabilité: plus c'est simple et bon marché, plus c'est haut.
  let production = 92 - DIFFICULTY_PRODUCTION_PENALTY[signals.difficulty];
  production -= Math.min(30, Math.floor(signals.estimatedCostCents / 2000)); // -1 par 20 €
  if (signals.targetDurationSec > 60) production -= 8;

  // AFFILIATE — nombre de produits réellement rattachables.
  const affiliate = clamp(
    signals.affiliateProductCount === 0 ? 10 : 35 + signals.affiliateProductCount * 15,
    0,
    100,
  );

  // SAFETY — plafonné par la détection déterministe des sujets à risque.
  const safety = safetyScoreCap(text);

  return {
    viralScore: clamp(Math.round(viral), 0, 100),
    originalityScore: originality,
    productionScore: clamp(Math.round(production), 0, 100),
    affiliateScore: Math.round(affiliate),
    safetyScore: safety,
  };
}

export interface ContentScoreInput {
  views: number;
  avgWatchMs: number;
  durationMs: number;
  likes: number;
  comments: number;
  shares: number;
  followersGained: number;
}

/**
 * CONTENT_SCORE (§21): rétention 40 %, engagement 25 %, partages 20 %,
 * conversion en abonnés 15 %. Les seuils de normalisation reflètent les ordres
 * de grandeur usuels du format vertical court, pas une vérité universelle.
 */
export function contentScore(input: ContentScoreInput): number {
  if (input.views <= 0 || input.durationMs <= 0) return 0;

  const retention = clamp(input.avgWatchMs / input.durationMs, 0, 1);
  const engagement = clamp((input.likes + input.comments) / input.views / 0.12, 0, 1);
  const shareRate = clamp(input.shares / input.views / 0.02, 0, 1);
  const followerRate = clamp(input.followersGained / input.views / 0.01, 0, 1);

  return Math.round((retention * 40 + engagement * 25 + shareRate * 20 + followerRate * 15));
}

export function completionRate(avgWatchMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return clamp(avgWatchMs / durationMs, 0, 1);
}

export function engagementRate(input: {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}): number {
  if (input.views <= 0) return 0;
  return clamp((input.likes + input.comments + input.shares) / input.views, 0, 1);
}
