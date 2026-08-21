import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import type { JobType } from '@prisma/client';
import { QUEUE_NAME, redisConnection } from '@/server/queue';
import { markFailed, markRunning, markSucceeded, updateProgress } from '@/server/services/jobs';
import { checkFFmpegAvailable } from '@/server/render/ffmpeg';
import { HANDLERS, type HandlerContext } from './handlers';

/**
 * Process worker (§33).
 *
 * Séparé du serveur web par conception: un rendu FFmpeg de trois minutes
 * bloquerait toutes les requêtes s'il tournait dans le même process.
 */

const CONCURRENCY = Number(process.env['WORKER_CONCURRENCY'] ?? 2);

/** Le rendu est CPU-bound: le paralléliser dégrade toutes les tâches à la fois. */
const SERIAL_JOBS = new Set<JobType>(['RENDER_VIDEO', 'GENERATE_VIDEO']);

let renderInFlight = false;
const renderQueue: Array<() => void> = [];

async function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  if (renderInFlight) {
    await new Promise<void>((resolve) => renderQueue.push(resolve));
  }
  renderInFlight = true;
  try {
    return await fn();
  } finally {
    renderInFlight = false;
    renderQueue.shift()?.();
  }
}

async function processJob(job: Job): Promise<unknown> {
  const type = job.name as JobType;
  const payload = job.data as Record<string, unknown>;
  const jobId = payload['jobId'];
  const workspaceId = payload['workspaceId'];

  if (typeof jobId !== 'string' || typeof workspaceId !== 'string') {
    throw new Error('Job invalide: jobId et workspaceId sont requis.');
  }

  const handler = HANDLERS[type];
  if (!handler) throw new Error(`Aucun handler pour le type de job ${type}.`);

  await markRunning(jobId);

  // La progression est écrite au maximum toutes les 750 ms: FFmpeg en émet
  // plusieurs par seconde et chaque écriture est une requête SQL.
  let lastProgressAt = 0;
  const ctx: HandlerContext = {
    jobId,
    workspaceId,
    payload,
    reportProgress: async (percent) => {
      const now = Date.now();
      if (now - lastProgressAt < 750) return;
      lastProgressAt = now;
      await updateProgress(jobId, percent).catch(() => undefined);
      await job.updateProgress(percent).catch(() => undefined);
    },
  };

  try {
    const completion = SERIAL_JOBS.has(type)
      ? await withRenderLock(() => handler(ctx))
      : await handler(ctx);
    await markSucceeded(jobId, completion);
    return completion.result ?? null;
  } catch (error) {
    await markFailed(jobId, error);
    throw error;
  }
}

async function main(): Promise<void> {
  const ffmpeg = await checkFFmpegAvailable();
  if (!ffmpeg.ffmpeg.available || !ffmpeg.ffprobe.available) {
    // On démarre quand même: seuls les jobs vidéo échoueront, avec un message clair.
    console.warn(
      '[iavid:worker] FFmpeg ou FFprobe est introuvable. ' +
        'Les jobs de rendu, de miniature et de voix mock échoueront. ' +
        'Installez ffmpeg ou ajustez FFMPEG_PATH / FFPROBE_PATH.',
    );
  } else {
    console.log(`[iavid:worker] ${ffmpeg.ffmpeg.version}`);
  }

  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: redisConnection(),
    concurrency: CONCURRENCY,
  });

  worker.on('completed', (job) => {
    console.log(`[iavid:worker] ${job.name} terminé (${job.id})`);
  });

  worker.on('failed', (job, error) => {
    console.error(`[iavid:worker] ${job?.name} en échec (${job?.id}): ${error.message}`);
  });

  console.log(`[iavid:worker] à l'écoute — concurrence ${CONCURRENCY}`);

  const shutdown = async (signal: string) => {
    console.log(`[iavid:worker] ${signal} reçu, arrêt en cours…`);
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[iavid:worker] démarrage impossible:', error);
  process.exit(1);
});
