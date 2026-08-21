import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { JobType } from '@prisma/client';
import { env } from '@/lib/env';

/**
 * Files de jobs (§33). Les opérations lourdes ne tournent jamais dans le
 * process web: un rendu FFmpeg de trois minutes bloquerait toutes les requêtes.
 */

export const QUEUE_NAME = 'iavid';

let connection: IORedis | null = null;
let queue: Queue | null = null;

export function redisConnection(): IORedis {
  if (connection) return connection;
  connection = new IORedis(env().REDIS_URL, {
    // Exigé par BullMQ: les workers bloquent sur BRPOPLPUSH sans limite de tentatives.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connection;
}

export function jobQueue(): Queue {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  return queue;
}

export interface JobPayload {
  /** Identifiant de l'AIJob correspondant: le worker y écrit sa progression. */
  jobId: string;
  workspaceId: string;
  [key: string]: unknown;
}

const PRIORITY: Record<JobType, number> = {
  GENERATE_IDEAS: 3,
  GENERATE_SCRIPT: 3,
  GENERATE_STORYBOARD: 3,
  FACT_CHECK: 3,
  GENERATE_VOICE: 2,
  GENERATE_CAPTIONS: 2,
  GENERATE_VIDEO: 5,
  RENDER_VIDEO: 5,
  ANALYZE_VIDEO: 4,
  PUBLISH_VIDEO: 1,
  FETCH_ANALYTICS: 6,
};

export async function enqueue(
  type: JobType,
  payload: JobPayload,
  options: JobsOptions = {},
): Promise<void> {
  await jobQueue().add(type, payload, {
    priority: PRIORITY[type],
    attempts: type === 'RENDER_VIDEO' ? 1 : 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
    ...options,
  });
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  connection?.disconnect();
  queue = null;
  connection = null;
}
