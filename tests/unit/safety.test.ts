import { describe, expect, it } from 'vitest';
import { detectSafetyTopics, requiresSafetyWarning, safetyScoreCap } from '@/lib/safety';

describe('détection des sujets à risque', () => {
  it("détecte l'électricité malgré les accents", () => {
    const found = detectSafetyTopics("Comment brancher une prise de courant sur le tableau électrique");
    expect(found.map((f) => f.topic)).toContain('electricity');
  });

  it('détecte plusieurs sujets dans un même texte', () => {
    const found = detectSafetyTopics(
      "Monter sur une échelle pour poncer un mur porteur à la meuleuse",
    );
    const topics = found.map((f) => f.topic);
    expect(topics).toContain('height');
    expect(topics).toContain('structural');
    expect(topics).toContain('power_tools');
  });

  it('ne signale rien sur un sujet inoffensif', () => {
    expect(detectSafetyTopics('Repeindre une étagère en bois avec un pinceau')).toHaveLength(0);
    expect(requiresSafetyWarning('Repeindre une étagère en bois')).toBe(false);
  });

  it('retient le plafond le plus bas quand plusieurs sujets se cumulent', () => {
    // Le gaz plafonne à 40, les outils à 70: c'est le plus contraignant qui gagne.
    const cap = safetyScoreCap('Intervention sur une chaudière à gaz avec une meuleuse');
    expect(cap).toBe(40);
  });

  it('laisse le plafond à 100 sans sujet à risque', () => {
    expect(safetyScoreCap('Ranger son garage')).toBe(100);
  });

  it('fournit un avertissement exploitable pour chaque détection', () => {
    for (const detection of detectSafetyTopics('Travaux sur une conduite de gaz')) {
      expect(detection.warning.length).toBeGreaterThan(40);
      expect(detection.matchedTerms.length).toBeGreaterThan(0);
    }
  });
});
