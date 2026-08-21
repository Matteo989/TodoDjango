import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Pipeline visuel (§27). Chaque étape est relançable indépendamment: le lien
 * pointe vers l'écran qui la déclenche.
 */

export interface PipelineStep {
  id: string;
  label: string;
  state: 'done' | 'current' | 'todo' | 'failed';
  href?: string;
  detail?: string;
}

export const PIPELINE_ORDER = [
  'IDEA',
  'RESEARCH',
  'SCRIPT',
  'FACT_CHECK',
  'ASSETS',
  'STORYBOARD',
  'VOICE',
  'EDIT',
  'QUALITY',
  'READY',
  'SCHEDULE',
  'PUBLISH',
  'ANALYTICS',
  'LEARNING',
] as const;

export function PipelineStepper({ steps }: { steps: PipelineStep[] }) {
  return (
    <ol className="flex flex-wrap gap-1.5">
      {steps.map((step, index) => {
        const content = (
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
              step.state === 'done' && 'border-success/40 bg-success/10 text-foreground',
              step.state === 'current' && 'border-primary bg-primary/10 font-medium text-foreground',
              step.state === 'todo' && 'border-border bg-muted/40 text-muted-foreground',
              step.state === 'failed' && 'border-destructive/50 bg-destructive/10 text-foreground',
              step.href && 'hover:border-primary/60',
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                step.state === 'done' && 'bg-success text-success-foreground',
                step.state === 'current' && 'bg-primary text-primary-foreground',
                step.state === 'todo' && 'bg-border text-muted-foreground',
                step.state === 'failed' && 'bg-destructive text-destructive-foreground',
              )}
            >
              {step.state === 'done' ? '✓' : step.state === 'failed' ? '!' : index + 1}
            </span>
            <span className="whitespace-nowrap">{step.label}</span>
          </div>
        );

        return (
          <li key={step.id} title={step.detail}>
            {step.href ? <Link href={step.href}>{content}</Link> : content}
          </li>
        );
      })}
    </ol>
  );
}
