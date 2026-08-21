import type { JobType, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { enqueue } from '../queue';

/**
 * Cycle de vie d'un job. `AIJob` sert à la fois au suivi de progression (§33)
 * et au journal IA/coûts (§34) — une seule ligne, une seule vérité.
 */

export interface CreateJobInput {
  workspaceId: string;
  type: JobType;
  entityType?: string;
  entityId?: string;
  input?: Prisma.InputJsonValue;
}

export async function createJob(input: CreateJobInput): Promise<string> {
  const job = await prisma.aIJob.create({
    data: {
      workspaceId: input.workspaceId,
      type: input.type,
      status: 'QUEUED',
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      input: input.input ?? undefined,
    },
    select: { id: true },
  });
  return job.id;
}

/** Crée la ligne de suivi puis pousse le job. Dans cet ordre: sans quoi le
 *  worker pourrait démarrer avant que la ligne n'existe. */
export async function createAndEnqueue(
  input: CreateJobInput,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const jobId = await createJob(input);
  await enqueue(input.type, { jobId, workspaceId: input.workspaceId, ...payload });
  return jobId;
}

export async function markRunning(jobId: string): Promise<void> {
  await prisma.aIJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: new Date(), progress: 0 },
  });
}

export async function updateProgress(jobId: string, progress: number): Promise<void> {
  await prisma.aIJob.update({
    where: { id: jobId },
    data: { progress: Math.max(0, Math.min(100, Math.round(progress))) },
  });
}

export interface JobCompletion {
  provider?: string;
  model?: string;
  promptVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
  result?: Prisma.InputJsonValue;
}

export async function markSucceeded(jobId: string, completion: JobCompletion = {}): Promise<void> {
  const job = await prisma.aIJob.findUnique({ where: { id: jobId }, select: { startedAt: true } });
  const durationMs = job?.startedAt ? Date.now() - job.startedAt.getTime() : 0;

  await prisma.aIJob.update({
    where: { id: jobId },
    data: {
      status: 'SUCCEEDED',
      progress: 100,
      finishedAt: new Date(),
      durationMs,
      provider: completion.provider ?? null,
      model: completion.model ?? null,
      promptVersion: completion.promptVersion ?? null,
      inputTokens: completion.inputTokens ?? 0,
      outputTokens: completion.outputTokens ?? 0,
      // Les coûts sont en centièmes de centime à la source; on arrondit ici.
      costCents: Math.round(completion.costCents ?? 0),
      result: completion.result ?? undefined,
    },
  });
}

export async function markFailed(jobId: string, error: unknown): Promise<void> {
  const job = await prisma.aIJob.findUnique({ where: { id: jobId }, select: { startedAt: true } });
  const durationMs = job?.startedAt ? Date.now() - job.startedAt.getTime() : 0;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  // La sortie FFmpeg est la seule information utile en cas d'échec de rendu.
  const detail =
    error instanceof Error && 'stderr' in error ? `\n\n${(error as { stderr: string }).stderr}` : '';

  await prisma.aIJob.update({
    where: { id: jobId },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      durationMs,
      error: `${message}${detail}`.slice(0, 8000),
    },
  });
}
