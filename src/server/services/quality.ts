import type { Platform } from '@prisma/client';
import { prisma } from '../db';
import { storage } from '../storage';
import { probeMedia } from '../render/ffmpeg';
import { auditVideoRights } from './rights';
import { lexicalSimilarity } from '@/lib/similarity';
import { env } from '@/lib/env';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface QualityCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface QualityReportResult {
  score: number;
  passed: boolean;
  checks: QualityCheck[];
}

/**
 * Contrôle qualité avant export (§28).
 *
 * Chaque contrôle est mesuré sur le fichier réel (ffprobe) ou sur la base —
 * aucun n'est déduit d'une intention. Un contrôle `fail` bloque l'export;
 * un `warn` est signalé sans bloquer.
 */
const WEIGHTS: Record<string, number> = {
  format: 12,
  resolution: 10,
  duration: 8,
  audio: 12,
  captions: 10,
  rights: 20,
  originality: 12,
  metadata: 8,
  safety: 8,
};

export async function runQualityControl(
  workspaceId: string,
  videoId: string,
): Promise<QualityReportResult> {
  const video = await prisma.video.findFirst({
    where: { id: videoId, workspaceId, deletedAt: null },
    include: {
      scenes: true,
      captionTracks: true,
      versions: true,
      script: { include: { claims: true } },
    },
  });
  if (!video) throw new Error('Vidéo introuvable.');

  const checks: QualityCheck[] = [];

  // ── Fichier rendu ──────────────────────────────────────────────────────────
  if (!video.masterKey) {
    checks.push({
      id: 'format',
      label: 'Format 9:16',
      status: 'fail',
      detail: "Aucun rendu: lancez le montage avant le contrôle qualité.",
    });
    checks.push({ id: 'resolution', label: 'Résolution', status: 'fail', detail: 'Aucun rendu.' });
    checks.push({ id: 'duration', label: 'Durée', status: 'fail', detail: 'Aucun rendu.' });
    checks.push({ id: 'audio', label: 'Piste audio', status: 'fail', detail: 'Aucun rendu.' });
  } else {
    const filePath = await storage().localPath(video.masterKey);
    const info = await probeMedia(filePath);
    const ratio = info.width && info.height ? info.width / info.height : 0;

    checks.push({
      id: 'format',
      label: 'Format 9:16',
      status: Math.abs(ratio - 9 / 16) < 0.01 ? 'pass' : 'fail',
      detail: `${info.width}×${info.height} (ratio ${ratio.toFixed(3)}, attendu 0.563)`,
    });

    checks.push({
      id: 'resolution',
      label: 'Résolution',
      status: (info.height ?? 0) >= 1920 ? 'pass' : (info.height ?? 0) >= 1280 ? 'warn' : 'fail',
      detail: `${info.width}×${info.height} @ ${info.fps ?? '?'} fps`,
    });

    checks.push({
      id: 'audio',
      label: 'Piste audio',
      status: info.hasAudio ? 'pass' : 'fail',
      detail: info.hasAudio
        ? 'Flux audio présent.'
        : "Aucun flux audio: plusieurs plateformes rejettent le fichier.",
    });

    checks.push(await durationCheck(workspaceId, video.id, info.durationMs));
  }

  // ── Sous-titres ────────────────────────────────────────────────────────────
  const hasCaptions = video.captionTracks.length > 0;
  checks.push({
    id: 'captions',
    label: 'Sous-titres',
    status: hasCaptions ? 'pass' : 'fail',
    detail: hasCaptions
      ? `${video.captionTracks.length} piste(s) générée(s).`
      : "Aucun sous-titre: la majorité des vues se font sans le son.",
  });

  // ── Droits ─────────────────────────────────────────────────────────────────
  const rights = await auditVideoRights(workspaceId, video.id);
  if (rights.blocking.length > 0) {
    checks.push({
      id: 'rights',
      label: 'Droits des assets',
      status: 'fail',
      detail: `🔴 ${rights.blocking.length} asset(s) interdit(s): ${rights.blocking
        .map((b) => b.assetName)
        .join(', ')}`,
    });
  } else if (rights.warnings.length > 0) {
    checks.push({
      id: 'rights',
      label: 'Droits des assets',
      status: video.monetizationReady ? 'fail' : 'warn',
      detail: `🟠 ${rights.warnings.length} asset(s) à vérifier: ${rights.warnings
        .map((w) => w.assetName)
        .join(', ')}`,
    });
  } else {
    checks.push({
      id: 'rights',
      label: 'Droits des assets',
      status: 'pass',
      detail: '🟢 Tous les assets sont commercialement utilisables.',
    });
  }

  // ── Originalité du script ──────────────────────────────────────────────────
  checks.push(await originalityCheck(workspaceId, video.scriptId));

  // ── Métadonnées de publication ─────────────────────────────────────────────
  checks.push(metadataCheck(video.versions));

  // ── Sécurité ───────────────────────────────────────────────────────────────
  const safetyClaims = video.script?.claims.filter((c) => c.status === 'SAFETY_WARNING') ?? [];
  checks.push({
    id: 'safety',
    label: 'Avertissement de sécurité',
    status: safetyClaims.length > 0 ? 'warn' : 'pass',
    detail:
      safetyClaims.length > 0
        ? `Sujet à risque détecté — vérifiez que l'avertissement est bien visible à l'écran: ${safetyClaims
            .map((c) => c.safetyTopic)
            .filter(Boolean)
            .join(', ')}`
        : 'Aucun sujet à risque détecté.',
  });

  const score = computeScore(checks);
  const passed = checks.every((c) => c.status !== 'fail');

  await prisma.qualityReport.create({
    data: { videoId: video.id, score, passed, checks: checks as unknown as object[] },
  });

  return { score, passed, checks };
}

function computeScore(checks: QualityCheck[]): number {
  const total = checks.reduce((sum, c) => sum + (WEIGHTS[c.id] ?? 5), 0);
  if (total === 0) return 0;
  const earned = checks.reduce((sum, c) => {
    const weight = WEIGHTS[c.id] ?? 5;
    // Un avertissement vaut la moitié des points: il signale sans disqualifier.
    return sum + (c.status === 'pass' ? weight : c.status === 'warn' ? weight * 0.5 : 0);
  }, 0);
  return Math.round((earned / total) * 100);
}

/**
 * La règle « ≥ 60 s » vient du programme Creator Rewards de TikTok, pas d'une
 * contrainte technique: elle n'est appliquée que si un compte social la demande.
 */
async function durationCheck(
  workspaceId: string,
  videoId: string,
  durationMs: number,
): Promise<QualityCheck> {
  const publications = await prisma.publication.findMany({
    where: { videoId },
    include: { socialAccount: true },
  });

  const constrained = publications
    .map((p) => p.socialAccount)
    .filter((a): a is NonNullable<typeof a> => Boolean(a?.requireMinDuration));

  if (constrained.length === 0) {
    const accounts = await prisma.socialAccount.findMany({
      where: { workspaceId, requireMinDuration: true, deletedAt: null },
    });
    if (accounts.length === 0) {
      return {
        id: 'duration',
        label: 'Durée',
        status: 'pass',
        detail: `${(durationMs / 1000).toFixed(1)} s — aucune contrainte de durée configurée.`,
      };
    }
    constrained.push(...accounts);
  }

  const minSec = Math.max(...constrained.map((a) => a.minDurationSec));
  const seconds = durationMs / 1000;

  return {
    id: 'duration',
    label: `Durée ≥ ${minSec} s`,
    status: seconds >= minSec ? 'pass' : 'warn',
    detail:
      seconds >= minSec
        ? `${seconds.toFixed(1)} s — éligible.`
        : `${seconds.toFixed(1)} s — sous le seuil de ${minSec} s exigé par ${constrained
            .map((a) => a.handle)
            .join(', ')}.`,
  };
}

async function originalityCheck(
  workspaceId: string,
  scriptId: string | null,
): Promise<QualityCheck> {
  if (!scriptId) {
    return {
      id: 'originality',
      label: 'Script original',
      status: 'warn',
      detail: "Aucun script rattaché: l'originalité n'a pas pu être vérifiée.",
    };
  }

  const threshold = env().DUPLICATION_THRESHOLD;
  const script = await prisma.script.findFirst({
    where: { id: scriptId, workspaceId },
    select: { fullText: true, similarityScore: true, similarityMethod: true },
  });
  if (!script) {
    return {
      id: 'originality',
      label: 'Script original',
      status: 'warn',
      detail: 'Script introuvable.',
    };
  }

  // Réutilise le score calculé si disponible; sinon compare à la volée.
  let score = script.similarityScore;
  let method = script.similarityMethod ?? 'lexical';

  if (score === null) {
    const others = await prisma.script.findMany({
      where: { workspaceId, id: { not: scriptId }, deletedAt: null },
      select: { fullText: true },
      take: 200,
    });
    score = others.reduce(
      (max, other) => Math.max(max, lexicalSimilarity(script.fullText, other.fullText)),
      0,
    );
    method = 'lexical';
  }

  return {
    id: 'originality',
    label: 'Script original',
    status: score >= threshold ? 'fail' : score >= threshold - 15 ? 'warn' : 'pass',
    detail: `Similarité maximale ${score}% (méthode ${method}, seuil ${threshold}%).`,
  };
}

function metadataCheck(
  versions: Array<{ platform: Platform; title: string; description: string; hashtags: string[] }>,
): QualityCheck {
  if (versions.length === 0) {
    return {
      id: 'metadata',
      label: 'Métadonnées',
      status: 'fail',
      detail: "Aucune version plateforme: générez les versions avant l'export.",
    };
  }

  const incomplete = versions.filter(
    (v) => !v.title.trim() || !v.description.trim() || v.hashtags.length === 0,
  );

  return {
    id: 'metadata',
    label: 'Métadonnées',
    status: incomplete.length === 0 ? 'pass' : 'fail',
    detail:
      incomplete.length === 0
        ? `${versions.length} version(s) complète(s).`
        : `Titre, description ou hashtags manquants: ${incomplete.map((v) => v.platform).join(', ')}.`,
  };
}

/** Rapport lisible, tel qu'affiché dans l'UI et exportable. */
export function formatQualityReport(result: QualityReportResult): string {
  const icon: Record<CheckStatus, string> = { pass: '✓', warn: '⚠', fail: '✗' };
  return [
    `QUALITY SCORE: ${result.score}/100`,
    '',
    ...result.checks.map((c) => `${icon[c.status]} ${c.label} — ${c.detail}`),
  ].join('\n');
}
