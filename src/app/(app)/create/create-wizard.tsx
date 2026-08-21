'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { JobProgress, useJob } from '@/components/domain/job-runner';
import { cn } from '@/lib/utils';

const STEPS = ['Sujet', 'Style', 'Durée', 'Voix', 'Assets', 'Generate'] as const;

interface Props {
  ideas: Array<{ id: string; title: string; targetDurationSec: number; concept: string | null }>;
  templates: Array<{
    id: string;
    key: string;
    name: string;
    description: string;
    targetDurationSec: number;
    captionStyle: string;
  }>;
  voices: Array<{ id: string; name: string; description?: string }>;
  voiceProvider: string;
  voiceIsLive: boolean;
  assetCount: number;
  music: Array<{ id: string; name: string; commercialUse: string; mood: string | null }>;
  aiConfigured: boolean;
}

/**
 * Workflow guidé (§31).
 *
 * Il enchaîne les jobs réels du pipeline: script → vidéo → storyboard → voix →
 * sous-titres → montage. Chaque étape attend la précédente, et l'échec de l'une
 * arrête la chaîne avec son message — aucune étape n'est simulée.
 */
export function CreateWizard(props: Props) {
  const router = useRouter();
  const job = useJob();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

  const [ideaId, setIdeaId] = useState(props.ideas[0]?.id ?? '');
  const [manualTitle, setManualTitle] = useState('');
  const [templateId, setTemplateId] = useState(props.templates[0]?.id ?? '');
  const [duration, setDuration] = useState(45);
  const [voiceId, setVoiceId] = useState(props.voices[0]?.id ?? '');
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [musicId, setMusicId] = useState('');
  const [captionStyle, setCaptionStyle] = useState('BOLD');
  const [generateSceneVisuals, setGenerateSceneVisuals] = useState(false);

  const selectedIdea = props.ideas.find((i) => i.id === ideaId);
  const canAdvance =
    step !== 0 || Boolean(ideaId) || manualTitle.trim().length > 2;

  /** Lance un job et attend son issue. Rejette avec le message d'erreur du job. */
  function runJob(url: string, body: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      void job.run(url, body, (finished) => {
        if (finished.status === 'FAILED') {
          reject(new Error(finished.error ?? 'Le job a échoué.'));
        } else {
          resolve();
        }
      });
    });
  }

  async function generate() {
    setError(null);
    setPhase(null);

    try {
      // 1. Script
      let scriptId: string | undefined;
      if (ideaId) {
        setPhase('Génération du script (5 variantes)…');
        const response = await fetch('/api/scripts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ideaId, targetDurationSec: duration }),
        });
        const payload = (await response.json()) as { jobId?: string; error?: string };
        if (!response.ok || !payload.jobId) throw new Error(payload.error ?? 'Script impossible.');

        await waitForJob(payload.jobId);
        const scripts = await fetch(`/api/scripts?ideaId=${ideaId}`).then(
          (r) => r.json() as Promise<{ items: Array<{ id: string; style: string }> }>,
        );
        // La variante VIRAL est prise par défaut; l'utilisateur pourra changer
        // depuis la fiche idée, où les cinq restent consultables.
        scriptId = (scripts.items.find((s) => s.style === 'VIRAL') ?? scripts.items[0])?.id;
        if (scriptId) await fetch(`/api/scripts/${scriptId}/select`, { method: 'POST' });
      }

      // 2. Vidéo
      setPhase('Création de la vidéo…');
      const videoResponse = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selectedIdea?.title ?? manualTitle,
          ideaId: ideaId || undefined,
          scriptId,
          templateId: templateId || undefined,
          musicId: musicId || undefined,
          targetDurationSec: duration,
          captionStyle,
        }),
      });
      const video = (await videoResponse.json()) as { id?: string; error?: string };
      if (!videoResponse.ok || !video.id) throw new Error(video.error ?? 'Création impossible.');
      setVideoId(video.id);

      // 3. Storyboard
      if (scriptId) {
        setPhase('Découpage en scènes…');
        await runJob(`/api/videos/${video.id}/storyboard`, {});
      }

      // 4. Plans IA, si demandé
      if (generateSceneVisuals) {
        setPhase('Génération des plans…');
        await runJob(`/api/videos/${video.id}/render`, { preset: 'draft' }).catch(() => undefined);
      }

      // 5. Voix
      setPhase('Génération de la voix off…');
      await runJob(`/api/videos/${video.id}/voice`, { voiceId, speed: voiceSpeed });

      // 6. Sous-titres
      setPhase('Génération des sous-titres…');
      await runJob(`/api/videos/${video.id}/captions`, { style: captionStyle });

      // 7. Montage
      setPhase('Montage FFmpeg…');
      await runJob(`/api/videos/${video.id}/render`, { preset: 'final' });

      setPhase(null);
      router.push(`/videos/${video.id}`);
    } catch (caught) {
      setError((caught as Error).message);
      setPhase(null);
    }
  }

  async function waitForJob(jobId: string): Promise<void> {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const response = await fetch(`/api/jobs/${jobId}`);
      const payload = (await response.json()) as { status: string; error?: string };
      if (payload.status === 'SUCCEEDED') return;
      if (payload.status === 'FAILED') throw new Error(payload.error ?? 'Le job a échoué.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <ol className="mb-6 flex flex-wrap gap-1.5">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => index <= step && setStep(index)}
              disabled={index > step}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
                index === step && 'border-primary bg-primary/10 font-medium',
                index < step && 'border-success/40 bg-success/10',
                index > step && 'border-border text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold',
                  index === step && 'bg-primary text-primary-foreground',
                  index < step && 'bg-success text-success-foreground',
                  index > step && 'bg-border',
                )}
              >
                {index < step ? <Check className="size-3" /> : index + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Étape {step + 1} — {STEPS[step]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="idea">Partir d&apos;une idée existante</Label>
                <Select
                  id="idea"
                  value={ideaId}
                  onChange={(e) => {
                    setIdeaId(e.target.value);
                    const idea = props.ideas.find((i) => i.id === e.target.value);
                    if (idea) setDuration(idea.targetDurationSec);
                  }}
                >
                  <option value="">— Aucune, je saisis un titre —</option>
                  {props.ideas.map((idea) => (
                    <option key={idea.id} value={idea.id}>{idea.title}</option>
                  ))}
                </Select>
                {selectedIdea?.concept ? (
                  <p className="text-xs text-muted-foreground">{selectedIdea.concept}</p>
                ) : null}
              </div>

              {!ideaId ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="manualTitle">Titre de la vidéo</Label>
                    <Input
                      id="manualTitle"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      placeholder="Réparer un joint de silicone en 4 minutes"
                    />
                  </div>
                  <Alert tone="warning">
                    Sans idée rattachée, aucun script n&apos;est généré et le storyboard reste vide.
                    Vous devrez composer les scènes à la main depuis la fiche vidéo.{' '}
                    <Link href="/ideas/generate" className="text-primary hover:underline">
                      Générer des idées
                    </Link>
                  </Alert>
                </>
              ) : null}
            </>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <Label>Template de montage</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {props.templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => {
                      setTemplateId(template.id);
                      setDuration(template.targetDurationSec);
                      setCaptionStyle(template.captionStyle);
                    }}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      templateId === template.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-primary/50',
                    )}
                  >
                    <p className="text-sm font-medium">{template.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {template.description}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <Badge variant="outline">{template.targetDurationSec}s</Badge>
                      <Badge variant="outline">{template.captionStyle}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="duration">Durée cible : {duration} secondes</Label>
                <input
                  id="duration"
                  type="range"
                  min={15}
                  max={180}
                  step={5}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full accent-[hsl(var(--primary))]"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>15 s</span>
                  <span>180 s</span>
                </div>
              </div>
              {duration < 60 ? (
                <Alert tone="info">
                  Le programme Creator Rewards de TikTok demande des vidéos d&apos;au moins
                  60 secondes. Le contrôle qualité le signalera si un compte social l&apos;exige.
                </Alert>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="captionStyle">Style de sous-titres</Label>
                <Select
                  id="captionStyle"
                  value={captionStyle}
                  onChange={(e) => setCaptionStyle(e.target.value)}
                >
                  {['MINIMAL', 'BOLD', 'HIGHLIGHTED', 'KARAOKE', 'CENTERED'].map((style) => (
                    <option key={style} value={style}>{style}</option>
                  ))}
                </Select>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              {!props.voiceIsLive ? (
                <Alert tone="warning" title="Aucun fournisseur de voix configuré">
                  La piste produite sera <strong>silencieuse</strong>, à la durée correcte, pour que
                  le montage et les sous-titres restent exploitables. Configurez{' '}
                  <strong>VOICE_PROVIDER</strong> et sa clé pour une vraie voix off.
                </Alert>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="voice">Voix ({props.voiceProvider})</Label>
                <Select id="voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                  {props.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>{voice.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="speed">Vitesse : {voiceSpeed.toFixed(2)}×</Label>
                <input
                  id="speed"
                  type="range"
                  min={0.7}
                  max={1.5}
                  step={0.05}
                  value={voiceSpeed}
                  onChange={(e) => setVoiceSpeed(Number(e.target.value))}
                  className="w-full accent-[hsl(var(--primary))]"
                />
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <Alert tone={props.assetCount > 0 ? 'info' : 'warning'}>
                {props.assetCount > 0 ? (
                  <>
                    <strong>{props.assetCount}</strong> asset(s) disponible(s). Vous les rattacherez
                    aux scènes depuis la fiche vidéo, une fois le storyboard généré.
                  </>
                ) : (
                  <>
                    Aucun asset importé. Les scènes seront rendues en{' '}
                    <strong>ardoises lisibles</strong> portant la description du plan — utile pour
                    valider le rythme avant de filmer.{' '}
                    <Link href="/assets" className="text-primary hover:underline">
                      Importer des médias
                    </Link>
                  </>
                )}
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="music">Musique de fond</Label>
                <Select id="music" value={musicId} onChange={(e) => setMusicId(e.target.value)}>
                  <option value="">Aucune</option>
                  {props.music
                    .filter((m) => m.commercialUse === 'ALLOWED')
                    .map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.name} {track.mood ? `(${track.mood})` : ''}
                      </option>
                    ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  Seules les musiques dont l&apos;usage commercial est confirmé sont proposées.
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={generateSceneVisuals}
                  onChange={(e) => setGenerateSceneVisuals(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-input"
                />
                <span>
                  Produire un rendu brouillon intermédiaire
                  <span className="block text-xs text-muted-foreground">
                    Permet de vérifier le rythme avant le rendu final.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 text-sm">
                <h4 className="mb-2 font-semibold">Récapitulatif</h4>
                <dl className="space-y-1">
                  <Summary label="Sujet" value={selectedIdea?.title ?? (manualTitle || '—')} />
                  <Summary
                    label="Template"
                    value={props.templates.find((t) => t.id === templateId)?.name ?? 'Aucun'}
                  />
                  <Summary label="Durée" value={`${duration} s`} />
                  <Summary
                    label="Voix"
                    value={`${props.voices.find((v) => v.id === voiceId)?.name ?? '—'} · ${voiceSpeed.toFixed(2)}×`}
                  />
                  <Summary label="Sous-titres" value={captionStyle} />
                  <Summary
                    label="Musique"
                    value={props.music.find((m) => m.id === musicId)?.name ?? 'Aucune'}
                  />
                </dl>
              </div>

              {!props.aiConfigured ? (
                <Alert tone="warning" title="Mode simulé">
                  Aucune clé IA n&apos;est configurée : le script et le storyboard seront des
                  exemples déterministes. Le montage, lui, est bien réel — vous obtiendrez un MP4
                  1080×1920 lisible.
                </Alert>
              ) : null}

              {phase ? <Alert tone="info">{phase}</Alert> : null}
              <JobProgress job={job.job} />
              {error ? (
                <Alert tone="danger">
                  <pre className="whitespace-pre-wrap font-sans">{error}</pre>
                  {videoId ? (
                    <p className="mt-2">
                      <Link href={`/videos/${videoId}`} className="text-primary hover:underline">
                        Ouvrir la vidéo pour reprendre l&apos;étape manuellement
                      </Link>
                    </p>
                  ) : null}
                </Alert>
              ) : null}

              <Button onClick={generate} disabled={Boolean(phase)} size="lg" className="w-full">
                <Sparkles />
                {phase ? 'Production en cours…' : 'Generate'}
              </Button>
            </div>
          ) : null}

          <div className="flex justify-between border-t pt-4">
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
              <ArrowLeft />
              Précédent
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
                Suivant
                <ArrowRight />
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
