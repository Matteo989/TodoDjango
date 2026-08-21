import { describe, expect, it } from 'vitest';
import { closestMatch, cosine, lexicalSimilarity, embeddingSimilarity, tokenize } from '@/lib/similarity';

describe('similarité lexicale', () => {
  it('donne 100 à un texte comparé à lui-même', () => {
    const text = 'Réparer un joint de silicone noirci en quatre minutes chrono.';
    expect(lexicalSimilarity(text, text)).toBe(100);
  });

  it('donne un score bas sur deux sujets sans rapport', () => {
    const score = lexicalSimilarity(
      'Réparer un joint de silicone dans la salle de bain',
      'Choisir la meilleure recette de pain au levain maison',
    );
    expect(score).toBeLessThan(30);
  });

  it('détecte une reformulation superficielle', () => {
    const original = "Pour réparer un joint de silicone, retirez l'ancien puis appliquez le nouveau.";
    const reworded = "Pour réparer un joint de silicone, enlevez l'ancien puis posez le nouveau.";
    expect(lexicalSimilarity(original, reworded)).toBeGreaterThan(70);
  });

  it('renvoie 0 sur un texte vide', () => {
    expect(lexicalSimilarity('', 'quelque chose')).toBe(0);
    expect(lexicalSimilarity('   ', '')).toBe(0);
  });

  it('est symétrique', () => {
    const a = 'Poser une étagère droite du premier coup';
    const b = 'Fixer une étagère bien droite sans se tromper';
    expect(lexicalSimilarity(a, b)).toBe(lexicalSimilarity(b, a));
  });

  it('retire les mots vides à la tokenisation', () => {
    expect(tokenize('le joint de la salle de bain est noir')).not.toContain('le');
    expect(tokenize('le joint de la salle de bain est noir')).toContain('joint');
  });
});

describe('similarité par embeddings', () => {
  it('mesure le cosinus de deux vecteurs identiques à 1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('renvoie 0 pour des vecteurs orthogonaux', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it('renvoie 0 sur des longueurs incompatibles plutôt que de lever', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });

  it('ramène une similarité négative à 0', () => {
    expect(embeddingSimilarity([1, 0], [-1, 0])).toBe(0);
  });
});

describe('closestMatch', () => {
  it('retourne le meilleur candidat au-dessus du seuil', () => {
    const hit = closestMatch(
      [{ id: 'a', score: 40 }, { id: 'b', score: 85 }, { id: 'c', score: 60 }],
      'lexical',
      80,
    );
    expect(hit).toEqual({ id: 'b', score: 85, method: 'lexical' });
  });

  it('retourne null si rien ne dépasse le seuil', () => {
    expect(closestMatch([{ id: 'a', score: 40 }], 'lexical', 80)).toBeNull();
  });

  it('retourne null sur une liste vide', () => {
    expect(closestMatch([], 'embedding', 80)).toBeNull();
  });
});
