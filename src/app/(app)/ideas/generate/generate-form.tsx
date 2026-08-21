'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { JobProgress, useJob } from '@/components/domain/job-runner';

const GOALS = [
  { value: 'VIRALITY', label: 'Viralité' },
  { value: 'AFFILIATE', label: 'Affiliation' },
  { value: 'EDUCATION', label: 'Éducation' },
  { value: 'ENTERTAINMENT', label: 'Divertissement' },
  { value: 'CONVERSION', label: 'Conversion' },
] as const;

export function GenerateIdeasForm({
  defaultNiche,
  defaultLanguage,
  trendCount,
  aiConfigured,
  aiProvider,
}: {
  defaultNiche: string;
  defaultLanguage: string;
  trendCount: number;
  aiConfigured: boolean;
  aiProvider: string;
}) {
  const router = useRouter();
  const { job, error, busy, run } = useJob();
  const [created, setCreated] = useState(0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setCreated(0);

    await run(
      '/api/ideas/generate',
      {
        niche: String(form.get('niche')),
        subNiche: String(form.get('subNiche') || '') || undefined,
        count: Number(form.get('count')),
        language: String(form.get('language')),
        targetDurationSec: Number(form.get('targetDurationSec')),
        difficulty: String(form.get('difficulty')),
        budgetCents: Math.round(Number(form.get('budget')) * 100),
        goal: String(form.get('goal')),
      },
      (finished) => {
        const result = finished.result as { ideaIds?: string[] } | null;
        setCreated(result?.ideaIds?.length ?? 0);
        router.refresh();
      },
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Paramètres</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="niche">Niche</Label>
                <Input id="niche" name="niche" defaultValue={defaultNiche} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subNiche">Sous-niche</Label>
                <Input id="subNiche" name="subNiche" placeholder="Salle de bain, peinture…" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="count">Nombre d&apos;idées</Label>
                <Input id="count" name="count" type="number" min={1} max={30} defaultValue={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="language">Langue</Label>
                <Select id="language" name="language" defaultValue={defaultLanguage}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                  <option value="es">Español</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetDurationSec">Durée cible (secondes)</Label>
                <Input
                  id="targetDurationSec"
                  name="targetDurationSec"
                  type="number"
                  min={10}
                  max={300}
                  defaultValue={45}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="difficulty">Difficulté</Label>
                <Select id="difficulty" name="difficulty" defaultValue="BEGINNER">
                  <option value="BEGINNER">Débutant</option>
                  <option value="INTERMEDIATE">Intermédiaire</option>
                  <option value="ADVANCED">Avancé</option>
                  <option value="EXPERT">Expert</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">Budget matériel (€)</Label>
                <Input id="budget" name="budget" type="number" min={0} step="0.5" defaultValue={50} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal">Objectif</Label>
                <Select id="goal" name="goal" defaultValue="VIRALITY">
                  {GOALS.map((goal) => (
                    <option key={goal.value} value={goal.value}>{goal.label}</option>
                  ))}
                </Select>
              </div>
            </div>

            {error ? <Alert tone="danger">{error}</Alert> : null}
            <JobProgress job={job} />

            {created > 0 ? (
              <Alert tone="success" title={`${created} idée(s) créée(s)`}>
                <Link href="/ideas" className="font-medium text-primary hover:underline">
                  Voir les idées
                </Link>
              </Alert>
            ) : null}

            <Button type="submit" disabled={busy} size="lg">
              <Sparkles />
              {busy ? 'Génération en cours…' : 'Générer les idées'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!aiConfigured ? (
          <Alert tone="warning" title="Mode simulé">
            Aucune clé IA n&apos;est configurée (<strong>{aiProvider}</strong>). Les idées générées
            seront des exemples déterministes, clairement étiquetés. Renseignez{' '}
            <strong>AI_PROVIDER=openai</strong> et <strong>OPENAI_API_KEY</strong> pour une
            génération réelle.
          </Alert>
        ) : (
          <Alert tone="success" title="Fournisseur IA actif">
            Les idées seront générées par <strong>{aiProvider}</strong>.
          </Alert>
        )}

        <Alert tone="info" title="Tendances prises en compte">
          {trendCount > 0 ? (
            <>
              <strong>{trendCount}</strong> tendance(s) enregistrée(s) seront injectées comme
              inspiration.{' '}
              <Link href="/research" className="text-primary hover:underline">
                Gérer les tendances
              </Link>
            </>
          ) : (
            <>
              Aucune tendance enregistrée.{' '}
              <Link href="/research" className="text-primary hover:underline">
                En ajouter
              </Link>{' '}
              améliore nettement la pertinence des idées.
            </>
          )}
        </Alert>

        <Alert tone="info" title="Scoring appliqué">
          Chaque idée reçoit cinq scores de 0 à 100 : VIRAL, ORIGINALITY, PRODUCTION, AFFILIATE et
          SAFETY. L&apos;originalité est mesurée localement contre vos idées existantes, et le score
          de sécurité est plafonné dès qu&apos;un sujet à risque est détecté.
        </Alert>
      </div>
    </div>
  );
}
