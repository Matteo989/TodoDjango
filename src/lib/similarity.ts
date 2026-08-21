/**
 * Anti-duplication (§29).
 *
 * Deux méthodes, toutes deux réelles:
 *  - `embedding`: cosinus sur des embeddings du provider IA (précis, coûte un appel).
 *  - `lexical`  : cosinus sur des vecteurs de tri-grammes de caractères + tokens,
 *                 calculé localement, sans clé d'API.
 *
 * La méthode employée est toujours stockée et affichée: un score de 87 % n'a pas
 * la même valeur selon la façon dont il a été obtenu.
 */

export type SimilarityMethod = 'embedding' | 'lexical';

const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'a', 'au', 'aux', 'en', 'dans',
  'pour', 'par', 'sur', 'avec', 'sans', 'que', 'qui', 'ce', 'cette', 'ces', 'est', 'sont', 'vous',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'ils', 'plus', 'pas', 'ne', 'se', 'son', 'sa', 'ses',
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'is', 'are', 'you', 'it',
]);

export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(' ')
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function charTrigrams(input: string): string[] {
  const s = ` ${normalizeText(input)} `;
  const grams: string[] = [];
  for (let i = 0; i + 3 <= s.length; i += 1) grams.push(s.slice(i, i + 3));
  return grams;
}

function toVector(features: string[]): Map<string, number> {
  const vec = new Map<string, number>();
  for (const f of features) vec.set(f, (vec.get(f) ?? 0) + 1);
  return vec;
}

function cosineSparse(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, v] of a) normA += v * v;
  for (const [, v] of b) normB += v * v;
  // Itérer sur le plus petit des deux: le coût suit la taille du plus court texte.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const other = large.get(k);
    if (other !== undefined) dot += v * other;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Similarité lexicale 0–100. Combine tokens (sujet traité) et tri-grammes
 * (tournures de phrase): un simple recyclage de vocabulaire remonte le premier,
 * une reformulation superficielle remonte le second.
 */
export function lexicalSimilarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const tokenScore = cosineSparse(toVector(tokenize(a)), toVector(tokenize(b)));
  const gramScore = cosineSparse(toVector(charTrigrams(a)), toVector(charTrigrams(b)));
  return Math.round((tokenScore * 0.55 + gramScore * 0.45) * 100);
}

export function embeddingSimilarity(a: readonly number[], b: readonly number[]): number {
  return Math.round(Math.max(0, cosine(a, b)) * 100);
}

export interface DuplicationHit {
  id: string;
  score: number;
  method: SimilarityMethod;
}

/** Retourne la correspondance la plus proche au-dessus du seuil, s'il y en a une. */
export function closestMatch(
  candidates: ReadonlyArray<{ id: string; score: number }>,
  method: SimilarityMethod,
  threshold: number,
): DuplicationHit | null {
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    if (!best || c.score > best.score) best = c;
  }
  if (!best || best.score < threshold) return null;
  return { id: best.id, score: best.score, method };
}
