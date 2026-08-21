import { describe, expect, it } from 'vitest';
import { contentScore, scoreIdea, completionRate, engagementRate } from '@/lib/scoring';

const base = {
  title: 'Réparer un joint de silicone',
  hook: 'Une astuce simple',
  concept: 'Tutoriel court',
  description: '',
  difficulty: 'BEGINNER' as const,
  estimatedCostCents: 1000,
  targetDurationSec: 45,
  affiliateProductCount: 0,
  maxSimilarity: 0,
};

describe('scoreIdea', () => {
  it('borne tous les scores entre 0 et 100', () => {
    const scores = scoreIdea({
      ...base,
      estimatedCostCents: 10_000_000,
      targetDurationSec: 600,
      difficulty: 'EXPERT',
      affiliateProductCount: 50,
      maxSimilarity: 100,
    });
    for (const value of Object.values(scores)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('récompense un hook avec une promesse chiffrée', () => {
    const weak = scoreIdea({ ...base, hook: 'Voici une idée de bricolage.' });
    const strong = scoreIdea({ ...base, hook: 'Réparez ça en 30 secondes pour 3 euros.' });
    expect(strong.viralScore).toBeGreaterThan(weak.viralScore);
  });

  it("fait chuter l'originalité quand un contenu proche existe", () => {
    const fresh = scoreIdea({ ...base, maxSimilarity: 0 });
    const derivative = scoreIdea({ ...base, maxSimilarity: 90 });
    expect(fresh.originalityScore).toBeGreaterThan(derivative.originalityScore);
    expect(derivative.originalityScore).toBeLessThan(30);
  });

  it('pénalise la faisabilité quand la difficulté et le coût montent', () => {
    const easy = scoreIdea(base);
    const hard = scoreIdea({ ...base, difficulty: 'EXPERT', estimatedCostCents: 30_000 });
    expect(hard.productionScore).toBeLessThan(easy.productionScore);
  });

  it('plafonne le score de sécurité sur un sujet dangereux', () => {
    const safe = scoreIdea(base);
    const electrical = scoreIdea({
      ...base,
      title: 'Remplacer une prise de courant sur le tableau électrique',
    });
    expect(safe.safetyScore).toBe(100);
    expect(electrical.safetyScore).toBeLessThanOrEqual(55);
  });

  it('est déterministe', () => {
    expect(scoreIdea(base)).toEqual(scoreIdea(base));
  });
});

describe('contentScore', () => {
  it('vaut 0 sans vues', () => {
    expect(
      contentScore({
        views: 0, avgWatchMs: 0, durationMs: 45_000,
        likes: 0, comments: 0, shares: 0, followersGained: 0,
      }),
    ).toBe(0);
  });

  it('récompense la rétention plus que les likes', () => {
    const highRetention = contentScore({
      views: 1000, avgWatchMs: 43_000, durationMs: 45_000,
      likes: 10, comments: 0, shares: 0, followersGained: 0,
    });
    const highLikes = contentScore({
      views: 1000, avgWatchMs: 5_000, durationMs: 45_000,
      likes: 200, comments: 50, shares: 0, followersGained: 0,
    });
    expect(highRetention).toBeGreaterThan(highLikes);
  });

  it('reste dans 0–100 avec des valeurs extrêmes', () => {
    const score = contentScore({
      views: 100, avgWatchMs: 999_999, durationMs: 45_000,
      likes: 10_000, comments: 10_000, shares: 10_000, followersGained: 10_000,
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe('taux dérivés', () => {
  it('borne la complétion à 1 même si le visionnage dépasse la durée', () => {
    expect(completionRate(60_000, 45_000)).toBe(1);
  });

  it("renvoie 0 quand il n'y a aucune vue", () => {
    expect(engagementRate({ views: 0, likes: 5, comments: 2, shares: 1 })).toBe(0);
  });
});
