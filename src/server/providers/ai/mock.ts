import { createHash } from 'node:crypto';
import type { AIProvider, AIResult, GenerateOptions } from './types';

/**
 * Provider IA de repli, actif tant qu'aucune clé n'est configurée.
 *
 * Il ne prétend pas raisonner: il produit une sortie structurée VALIDE et
 * DÉTERMINISTE (graine dérivée du prompt) afin que tout le pipeline —
 * storyboard, rendu, QC — soit exécutable et testable hors ligne. Son `isLive`
 * est false et l'UI l'affiche partout où son résultat apparaît.
 */
export class MockAIProvider implements AIProvider {
  readonly id = 'mock';
  readonly model = 'mock-deterministic-v1';
  readonly isLive = false;

  private seed(prompt: string): number {
    const hash = createHash('sha256').update(prompt).digest();
    return hash.readUInt32BE(0);
  }

  /** PRNG xorshift: reproductible, sans dépendance. */
  private rng(seed: number): () => number {
    let state = seed || 1;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    };
  }

  private usage(prompt: string, output: string) {
    return {
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(output.length / 4),
      costCents: 0,
    };
  }

  async generateText(prompt: string, _options?: GenerateOptions): Promise<AIResult<string>> {
    const text =
      `[Sortie générée en mode mock — aucun fournisseur IA n'est configuré]\n\n` +
      `Requête reçue (${prompt.length} caractères). Configurez AI_PROVIDER=openai et ` +
      `OPENAI_API_KEY pour obtenir une génération réelle.`;
    return { data: text, usage: this.usage(prompt, text), model: this.model, provider: this.id };
  }

  async generateStructuredOutput<T>(
    prompt: string,
    schemaName: string,
    schemaHint: string,
    _options?: GenerateOptions,
  ): Promise<AIResult<T>> {
    const rand = this.rng(this.seed(prompt + schemaName));
    const data = buildMockPayload(schemaName, prompt, schemaHint, rand) as T;
    return {
      data,
      usage: this.usage(prompt, JSON.stringify(data)),
      model: this.model,
      provider: this.id,
    };
  }

  async embed(texts: string[]): Promise<AIResult<number[][]> | null> {
    // Pas d'embeddings en mock: l'appelant bascule sur la similarité lexicale
    // locale, qui est réelle, plutôt que sur un vecteur aléatoire trompeur.
    void texts;
    return null;
  }
}

// ─── Charges utiles par schéma ───────────────────────────────────────────────

const DIY_ANGLES = [
  'réparation express',
  'avant / après',
  'erreur courante',
  'test de produit',
  'astuce de pro',
  'budget serré',
  'outil détourné',
  'rénovation locative',
] as const;

const DIY_SUBJECTS = [
  'un joint de silicone qui noircit',
  'une porte qui grince',
  'un mur à reboucher',
  'une étagère qui penche',
  'un robinet qui goutte',
  'un parquet rayé',
  'une prise mal fixée',
  'un meuble Ikea à relooker',
  'une fenêtre qui laisse passer l’air',
  'un plan de travail abîmé',
] as const;

function pick<T>(list: readonly T[], rand: () => number): T {
  const index = Math.floor(rand() * list.length) % list.length;
  return list[index] as T;
}

function extractCount(prompt: string, fallback: number): number {
  const match = prompt.match(/"?count"?\s*[:=]\s*(\d+)/i) ?? prompt.match(/(\d+)\s+id[ée]es/i);
  const n = match?.[1] ? Number.parseInt(match[1], 10) : fallback;
  return Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : fallback;
}

function buildMockPayload(
  schemaName: string,
  prompt: string,
  schemaHint: string,
  rand: () => number,
): unknown {
  switch (schemaName) {
    case 'IdeaBatch': {
      const count = extractCount(prompt, 5);
      return {
        ideas: Array.from({ length: count }, (_, i) => {
          const angle = pick(DIY_ANGLES, rand);
          const subject = pick(DIY_SUBJECTS, rand);
          return {
            title: `${capitalize(angle)} : ${subject}`,
            hook: `Arrêtez de payer un artisan pour ${subject} — 3 minutes suffisent.`,
            concept: `Format ${angle}. On montre le résultat dès la première seconde, puis on déroule les étapes en plans serrés.`,
            summary: `Tutoriel court sur ${subject}, angle « ${angle} », filmé en vertical avec voix off rythmée.`,
            cta: 'Abonne-toi pour une astuce maison par jour.',
            difficulty: (['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const)[i % 3],
            estimatedCostCents: 500 + Math.floor(rand() * 3000),
            category: 'DIY',
            subcategory: capitalize(angle),
            affiliateProducts: [
              'Cartouche de silicone',
              'Pistolet à joint',
              'Lot de spatules',
            ].slice(0, 1 + (i % 3)),
            sources: [],
          };
        }),
      };
    }

    case 'ScriptVariants': {
      const styles = ['EDUCATIONAL', 'VIRAL', 'STORYTELLING', 'DIRECT', 'MYSTERIOUS'] as const;
      const topic = extractTopic(prompt);
      return {
        variants: styles.map((style) => ({
          style,
          title: `${topic} — version ${style.toLowerCase()}`,
          blocks: buildBlocks(style, topic),
        })),
      };
    }

    case 'Storyboard': {
      return {
        scenes: [
          { section: 'HOOK', narration: 'Le résultat final, tout de suite.', visualPrompt: 'Plan serré du résultat terminé, lumière naturelle, 9:16', caption: 'Regarde le résultat', transition: 'fade' },
          { section: 'PROBLEM', narration: 'Voilà à quoi ça ressemblait avant.', visualPrompt: 'Plan du problème initial, même cadrage', caption: 'Avant', transition: 'fade' },
          { section: 'SOLUTION', narration: 'Étape 1 : préparer la surface.', visualPrompt: 'Mains qui nettoient la zone, plan macro', caption: 'Étape 1', transition: 'cut' },
          { section: 'SOLUTION', narration: 'Étape 2 : appliquer proprement.', visualPrompt: "Application du produit, geste régulier, plan d'épaule", caption: 'Étape 2', transition: 'cut' },
          { section: 'RESULT', narration: 'Et voilà le rendu après séchage.', visualPrompt: 'Comparaison avant/après en split screen vertical', caption: 'Après', transition: 'fade' },
          { section: 'CTA', narration: 'Abonne-toi pour la suite.', visualPrompt: 'Plan large de la pièce terminée', caption: 'Abonne-toi', transition: 'fade' },
        ],
      };
    }

    case 'FactCheck': {
      return { claims: [] };
    }

    case 'PerformanceAnalysis': {
      return {
        summary:
          "Analyse indisponible en mode mock : configurez un fournisseur IA pour obtenir une explication fondée sur vos données.",
        strengths: [],
        weaknesses: [],
        nextIdeas: [],
      };
    }

    default:
      return { note: `Schéma "${schemaName}" non simulé.`, hint: schemaHint };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractTopic(prompt: string): string {
  const match = prompt.match(/"?title"?\s*[:=]\s*"([^"]+)"/i);
  return match?.[1] ?? 'Astuce maison';
}

function buildBlocks(style: string, topic: string) {
  const openings: Record<string, string> = {
    EDUCATIONAL: `Trois choses à savoir avant de vous lancer sur ${topic}.`,
    VIRAL: `Personne ne vous dit ça sur ${topic}.`,
    STORYTELLING: `J'ai raté ${topic} deux fois. La troisième, j'ai compris.`,
    DIRECT: `${topic}. Voilà comment faire, sans blabla.`,
    MYSTERIOUS: `Il y a une raison pour laquelle ${topic} ne tient jamais.`,
  };
  return [
    { section: 'HOOK', text: openings[style] ?? topic, startMs: 0, endMs: 3000, visualDirection: 'Résultat final en plan serré' },
    { section: 'PROBLEM', text: "Le problème, c'est que la méthode courante ne tient pas dans le temps.", startMs: 3000, endMs: 10000, visualDirection: 'Plan du défaut' },
    { section: 'SOLUTION', text: "On prépare la surface, on applique en une passe régulière, puis on lisse immédiatement.", startMs: 10000, endMs: 45000, visualDirection: 'Étapes filmées en macro' },
    { section: 'RESULT', text: 'Résultat net après séchage complet, sans reprise.', startMs: 45000, endMs: 55000, visualDirection: 'Avant / après' },
    { section: 'CTA', text: 'Abonne-toi pour une astuce maison par jour.', startMs: 55000, endMs: 60000, visualDirection: 'Plan large final' },
  ];
}
