'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Progress } from '@/components/ui/misc';

export interface JobState {
  id: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress: number;
  error: string | null;
  result: unknown;
  provider: string | null;
  costCents: number;
}

/**
 * Suit un job asynchrone jusqu'à son terme.
 *
 * Interroge l'API plutôt que d'ouvrir un WebSocket: la fréquence utile est de
 * l'ordre de la seconde et une requête GET coûte moins qu'une connexion
 * persistante par onglet ouvert.
 */
export function useJob() {
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const poll = useCallback(
    (jobId: string, onDone?: (job: JobState) => void) => {
      const tick = async () => {
        try {
          const response = await fetch(`/api/jobs/${jobId}`);
          const payload = (await response.json()) as JobState & { error?: string };
          if (!response.ok) {
            setError(payload.error ?? 'Suivi du job impossible.');
            return;
          }

          setJob(payload);

          if (payload.status === 'SUCCEEDED' || payload.status === 'FAILED') {
            stop();
            if (payload.status === 'FAILED') setError(payload.error ?? 'Le job a échoué.');
            onDone?.(payload);
            return;
          }

          timer.current = setTimeout(tick, 1500);
        } catch {
          setError('Le serveur est injoignable.');
        }
      };
      void tick();
    },
    [stop],
  );

  const run = useCallback(
    async (url: string, body: unknown, onDone?: (job: JobState) => void) => {
      setError(null);
      setJob(null);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        const payload = (await response.json()) as { jobId?: string; error?: string; remedy?: string };
        if (!response.ok || !payload.jobId) {
          setError(
            [payload.error ?? 'Lancement impossible.', payload.remedy].filter(Boolean).join('\n'),
          );
          return null;
        }
        poll(payload.jobId, onDone);
        return payload.jobId;
      } catch {
        setError('Le serveur est injoignable.');
        return null;
      }
    },
    [poll],
  );

  const busy = job?.status === 'QUEUED' || job?.status === 'RUNNING';

  return { job, error, busy, run, reset: () => { setJob(null); setError(null); } };
}

export function JobProgress({ job }: { job: JobState | null }) {
  if (!job) return null;
  if (job.status === 'SUCCEEDED') return null;

  const label =
    job.status === 'QUEUED'
      ? "En file d'attente…"
      : job.status === 'RUNNING'
        ? `En cours — ${job.progress}%`
        : job.status;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Progress value={job.status === 'QUEUED' ? 5 : job.progress} />
    </div>
  );
}
