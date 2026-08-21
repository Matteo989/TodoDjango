import { z } from 'zod';
import type { Platform, ScriptStyle } from '@prisma/client';
import { prisma } from '../db';
import { aiProvider } from '../providers/registry';
import { detectSafetyTopics, SAFETY_RULES } from '@/lib/safety';
import { lexicalSimilarity, embeddingSimilarity, type SimilarityMethod } from '@/lib/similarity';
import { env } from '@/lib/env';
import { distribute } from '@/lib/utils';
import {
  buildFactCheckPrompt,
  buildScriptPrompt,
  FACT_CHECK_SCHEMA_HINT,
  PROMPT_VERSIONS,
  SCRIPT_SCHEMA_HINT,
  SYSTEM_PROMPT,
} from './prompts';

const blockSchema = z.object({
  section: z.enum(['HOOK', 'PROBLEM', 'SOLUTION', 'RESULT', 'CTA']),
  text: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  visualDirection: z.string().optional(),
});

const variantSchema = z.object({
  style: z.enum(['EDUCATIONAL', 'VIRAL', 'STORYTELLING', 'DIRECT', 'MYSTERIOUS']),
  title: z.string().min(1),
  blocks: z.array(blockSchema).min(1),
});

const scriptVariantsSchema = z.object({ variants: z.array(variantSchema).min(1) });

export interface GenerateScriptsParams {
  workspaceId: string;
  ideaId: string;
  targetDurationSec: number;
  platform?: Platform;
  audience?: string;
  technicalLevel?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
  language?: string;
}

export interface GenerateScriptsOutcome {
  scriptIds: string[];
  provider: string;
  model: string;
  isLive: boolean;
  usage: { inputTokens: number; outputTokens: number; costCents: number };
  safetyTopics: string[];
}

export async function generateScripts(
  params: GenerateScriptsParams,
): Promise<GenerateScriptsOutcome> {
  const idea = await prisma.idea.findFirst({
    where: { id: params.ideaId, workspaceId: params.workspaceId, deletedAt: null },
  });
  if (!idea) throw new Error('Idée introuvable.');

  const ideaText = [idea.title, idea.concept, idea.description, idea.summary]
    .filter(Boolean)
    .join('\n');
  const safety = detectSafetyTopics(ideaText);

  const provider = aiProvider();
  const prompt = buildScriptPrompt({
    title: idea.title,
    concept: idea.concept ?? idea.description,
    language: params.language ?? idea.language,
    targetDurationSec: params.targetDurationSec,
    platform: params.platform ?? 'TIKTOK',
    audience: params.audience ?? 'grand public, 25–45 ans, propriétaires ou locataires',
    technicalLevel: params.technicalLevel ?? idea.difficulty,
    safetyTopics: safety.map((s) => s.label),
  });

  const response = await provider.generateStructuredOutput<unknown>(
    prompt,
    'ScriptVariants',
    SCRIPT_SCHEMA_HINT,
    { system: SYSTEM_PROMPT, temperature: 0.85, promptVersion: PROMPT_VERSIONS.script },
  );

  const parsed = scriptVariantsSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(
      `Le fournisseur ${response.provider} a renvoyé des variantes invalides: ${parsed.error.issues
        .map((i) => i.path.join('.'))
        .join(', ')}`,
    );
  }

  const scriptIds: string[] = [];

  for (const variant of parsed.data.variants) {
    const blocks = normalizeBlockTimings(variant.blocks, params.targetDurationSec * 1000);
    const fullText = blocks.map((b) => b.text).join('\n\n');

    const script = await prisma.script.create({
      data: {
        workspaceId: params.workspaceId,
        ideaId: idea.id,
        style: variant.style as ScriptStyle,
        language: params.language ?? idea.language,
        platform: params.platform ?? null,
        targetDurationSec: params.targetDurationSec,
        audience: params.audience ?? null,
        technicalLevel: params.technicalLevel ?? idea.difficulty,
        title: variant.title,
        fullText,
        blocks: {
          create: blocks.map((block, order) => ({
            section: block.section,
            order,
            text: block.text,
            startMs: block.startMs,
            endMs: block.endMs,
            visualDirection: block.visualDirection ?? null,
          })),
        },
      },
      select: { id: true },
    });

    // Un avertissement de sécurité est posé de façon déterministe, avant toute
    // intervention du modèle: il ne peut pas être omis par oubli du LLM.
    if (safety.length > 0) {
      await prisma.factClaim.createMany({
        data: safety.map((topic) => ({
          scriptId: script.id,
          text: topic.warning,
          status: 'SAFETY_WARNING' as const,
          safetyTopic: topic.topic,
          rationale: `Détection automatique — termes relevés: ${topic.matchedTerms.join(', ')}.`,
        })),
      });
    }

    scriptIds.push(script.id);
  }

  if (idea.status === 'IDEA' || idea.status === 'RESEARCH') {
    await prisma.idea.update({ where: { id: idea.id }, data: { status: 'SCRIPT' } });
  }

  return {
    scriptIds,
    provider: response.provider,
    model: response.model,
    isLive: provider.isLive,
    usage: response.usage,
    safetyTopics: safety.map((s) => s.label),
  };
}

/**
 * Recale les blocs sur la durée cible.
 *
 * Les modèles renvoient régulièrement des bornes qui se chevauchent ou qui
 * dépassent la durée demandée. Plutôt que de faire confiance, on répartit la
 * durée totale au prorata de la longueur des textes: c'est ce qui garantit que
 * le storyboard et le montage partent d'un découpage cohérent.
 */
export function normalizeBlockTimings(
  blocks: ReadonlyArray<z.infer<typeof blockSchema>>,
  totalMs: number,
): Array<z.infer<typeof blockSchema>> {
  const weights = blocks.map((b) => Math.max(1, b.text.trim().length));
  const durations = distribute(totalMs, weights);

  let cursor = 0;
  return blocks.map((block, i) => {
    const duration = durations[i] ?? 0;
    const startMs = cursor;
    cursor += duration;
    return { ...block, startMs, endMs: cursor };
  });
}

export async function selectScript(workspaceId: string, scriptId: string) {
  const script = await prisma.script.findFirst({
    where: { id: scriptId, workspaceId, deletedAt: null },
    select: { id: true, ideaId: true },
  });
  if (!script) throw new Error('Script introuvable.');

  // Une seule variante active par idée: les autres restent consultables.
  await prisma.$transaction([
    prisma.script.updateMany({
      where: { ideaId: script.ideaId, workspaceId },
      data: { isSelected: false },
    }),
    prisma.script.update({ where: { id: script.id }, data: { isSelected: true } }),
  ]);

  return script;
}

// ─── Anti-duplication (§29) ──────────────────────────────────────────────────

export interface DuplicationCheck {
  score: number;
  method: SimilarityMethod;
  threshold: number;
  isDuplicate: boolean;
  closestScriptId: string | null;
  closestTitle: string | null;
}

export async function checkDuplication(
  workspaceId: string,
  scriptId: string,
): Promise<DuplicationCheck> {
  const threshold = env().DUPLICATION_THRESHOLD;

  const script = await prisma.script.findFirst({
    where: { id: scriptId, workspaceId, deletedAt: null },
    select: { id: true, fullText: true, title: true },
  });
  if (!script) throw new Error('Script introuvable.');

  const others = await prisma.script.findMany({
    where: { workspaceId, deletedAt: null, id: { not: scriptId } },
    select: { id: true, title: true, fullText: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  if (others.length === 0) {
    return {
      score: 0,
      method: 'lexical',
      threshold,
      isDuplicate: false,
      closestScriptId: null,
      closestTitle: null,
    };
  }

  const provider = aiProvider();
  let method: SimilarityMethod = 'lexical';
  let scores: Array<{ id: string; title: string; score: number }>;

  const embeddings = await provider
    .embed([script.fullText, ...others.map((o) => o.fullText)])
    .catch(() => null);

  if (embeddings && embeddings.data.length === others.length + 1) {
    method = 'embedding';
    const [reference, ...rest] = embeddings.data;
    scores = others.map((other, i) => ({
      id: other.id,
      title: other.title,
      score: embeddingSimilarity(reference ?? [], rest[i] ?? []),
    }));
  } else {
    scores = others.map((other) => ({
      id: other.id,
      title: other.title,
      score: lexicalSimilarity(script.fullText, other.fullText),
    }));
  }

  const closest = scores.reduce(
    (best, current) => (current.score > best.score ? current : best),
    { id: '', title: '', score: 0 },
  );

  await prisma.script.update({
    where: { id: script.id },
    data: {
      similarityScore: closest.score,
      similarityMethod: method,
      similarToScriptId: closest.id || null,
    },
  });

  return {
    score: closest.score,
    method,
    threshold,
    isDuplicate: closest.score >= threshold,
    closestScriptId: closest.id || null,
    closestTitle: closest.title || null,
  };
}

// ─── Fact check (§9) ─────────────────────────────────────────────────────────

const factCheckSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(1),
        status: z.enum(['UNVERIFIED', 'OPINION', 'SAFETY_WARNING']),
        rationale: z.string().default(''),
      }),
    )
    .default([]),
});

export async function runFactCheck(workspaceId: string, scriptId: string) {
  const script = await prisma.script.findFirst({
    where: { id: scriptId, workspaceId, deletedAt: null },
    select: { id: true, fullText: true },
  });
  if (!script) throw new Error('Script introuvable.');

  // 1) Détection déterministe: elle prime et ne dépend d'aucun modèle.
  const safety = detectSafetyTopics(script.fullText);
  await prisma.factClaim.deleteMany({
    where: { scriptId: script.id, humanReviewed: false },
  });
  if (safety.length > 0) {
    await prisma.factClaim.createMany({
      data: safety.map((topic) => ({
        scriptId: script.id,
        text: topic.warning,
        status: 'SAFETY_WARNING' as const,
        safetyTopic: topic.topic,
        rationale: `Détection automatique — termes relevés: ${topic.matchedTerms.join(', ')}.`,
      })),
    });
  }

  // 2) Classement des affirmations par le modèle, en complément.
  const provider = aiProvider();
  const response = await provider.generateStructuredOutput<unknown>(
    buildFactCheckPrompt(script.fullText),
    'FactCheck',
    FACT_CHECK_SCHEMA_HINT,
    { system: SYSTEM_PROMPT, temperature: 0.2, promptVersion: PROMPT_VERSIONS.factCheck },
  );

  const parsed = factCheckSchema.safeParse(response.data);
  if (parsed.success && parsed.data.claims.length > 0) {
    await prisma.factClaim.createMany({
      data: parsed.data.claims.map((claim) => ({
        scriptId: script.id,
        text: claim.text,
        status: claim.status,
        rationale: claim.rationale,
      })),
    });
  }

  const claims = await prisma.factClaim.findMany({
    where: { scriptId: script.id },
    orderBy: { createdAt: 'asc' },
  });

  return { claims, usage: response.usage, provider: response.provider, model: response.model };
}

export function safetyTopicLabel(topic: string | null): string | null {
  if (!topic) return null;
  return SAFETY_RULES.find((r) => r.topic === topic)?.label ?? topic;
}
