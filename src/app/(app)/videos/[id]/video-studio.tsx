'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Clapperboard,
  Download,
  Film,
  Layers,
  Mic,
  ShieldCheck,
  Subtitles,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Alert, Progress } from '@/components/ui/misc';
import { JobProgress, useJob } from '@/components/domain/job-runner';
import { PipelineStepper, type PipelineStep } from '@/components/domain/pipeline';
import { RightsBadge } from '@/components/domain/rights-badge';
import { formatCents, formatDuration } from '@/lib/utils';

interface Scene {
  id: string;
  order: number;
  section: string;
  startMs: number;
  durationMs: number;
  narration: string;
  visualPrompt: string;
  caption: string;
  transition: string;
  assetId: string | null;
  assetName: string | null;
  assetRights: string | null;
  assetThumbnailUrl: string | null;
}

interface RightsIssue {
  assetId: string;
  assetName: string;
  reasons: string[];
}

const PLATFORMS = [
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'YOUTUBE_SHORTS', label: 'YouTube Shorts' },
  { value: 'INSTAGRAM_REELS', label: 'Instagram Reels' },
  { value: 'SNAPCHAT_SPOTLIGHT', label: 'Snapchat Spotlight' },
] as const;

const CAPTION_STYLES = ['MINIMAL', 'BOLD', 'HIGHLIGHTED', 'KARAOKE', 'CENTERED'] as const;

export function VideoStudio({
  video,
  scenes,
  assets,
  voice,
  captions,
  versions,
  quality,
  rights,
  cost,
}: {
  video: {
    id: string;
    title: string;
    status: string;
    targetDurationSec: number;
    renderedDurationMs: number | null;
    width: number;
    height: number;
    fps: number;
    captionStyle: string;
    monetizationReady: boolean;
    hasScript: boolean;
    scriptTitle: string | null;
    templateName: string | null;
    musicName: string | null;
    masterUrl: string | null;
    thumbnailUrl: string | null;
  };
  scenes: Scene[];
  assets: Array<{ id: string; name: string; kind: string; source: string; rights: string | null }>;
  voice: { id: string; provider: string; durationMs: number; url: string } | null;
  captions: Array<{ id: string; format: string; style: string; method: string; url: string }>;
  versions: Array<{
    id: string;
    platform: string;
    title: string;
    description: string;
    hashtags: string[];
    sizeBytes: number | null;
  }>;
  quality: {
    score: number;
    passed: boolean;
    checks: Array<{ id: string; label: string; status: string; detail: string }>;
  } | null;
  rights: { blocking: RightsIssue[]; warnings: RightsIssue[] };
  cost: {
    voiceCents: number;
    videoAiCents: number;
    llmCents: number;
    storageCents: number;
    totalCents: number;
    estimatedRevenueCents: number;
    roiPercent: number | null;
  };
}) {
  const router = useRouter();
  const job = useJob();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [captionStyle, setCaptionStyle] = useState(video.captionStyle);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['TIKTOK', 'YOUTUBE_SHORTS']);

  const totalStoryboardMs = scenes.reduce((sum, s) => sum + s.durationMs, 0);

  const steps: PipelineStep[] = [
    { id: 'script', label: 'Script', state: video.hasScript ? 'done' : 'todo' },
    { id: 'storyboard', label: 'Storyboard', state: scenes.length > 0 ? 'done' : video.hasScript ? 'current' : 'todo' },
    {
      id: 'assets',
      label: 'Assets',
      state: scenes.length === 0 ? 'todo' : scenes.every((s) => s.assetId) ? 'done' : 'current',
      detail: `${scenes.filter((s) => s.assetId).length}/${scenes.length} scènes avec un asset`,
    },
    { id: 'voice', label: 'Voix', state: voice ? 'done' : scenes.length > 0 ? 'current' : 'todo' },
    { id: 'captions', label: 'Sous-titres', state: captions.length > 0 ? 'done' : 'todo' },
    {
      id: 'edit',
      label: 'Montage',
      state: video.status === 'FAILED' ? 'failed' : video.masterUrl ? 'done' : 'todo',
    },
    {
      id: 'quality',
      label: 'Contrôle qualité',
      state: quality ? (quality.passed ? 'done' : 'failed') : 'todo',
    },
    { id: 'versions', label: 'Versions', state: versions.length > 0 ? 'done' : 'todo' },
  ];

  async function runStep(path: string, body: unknown = {}) {
    setNotice(null);
    setError(null);
    await job.run(`/api/videos/${video.id}/${path}`, body, () => router.refresh());
  }

  async function runQuality() {
    setPending(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/videos/${video.id}/quality`, { method: 'POST' });
      const payload = (await response.json()) as { report?: string; error?: string; remedy?: string };
      if (!response.ok) {
        setError([payload.error, payload.remedy].filter(Boolean).join('\n'));
        return;
      }
      setNotice(payload.report ?? null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function buildVersions() {
    setPending(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/videos/${video.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: selectedPlatforms }),
      });
      const payload = (await response.json()) as {
        versions?: unknown[];
        error?: string;
        blockers?: Array<{ label: string; detail: string }>;
      };
      if (!response.ok) {
        setError(
          [
            payload.error,
            ...(payload.blockers ?? []).map((b) => `• ${b.label} — ${b.detail}`),
          ]
            .filter(Boolean)
            .join('\n'),
        );
        return;
      }
      setNotice(`${payload.versions?.length ?? 0} version(s) plateforme générée(s).`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function updateScene(sceneId: string, patch: Record<string, unknown>) {
    setPending(true);
    try {
      await fetch(`/api/videos/${video.id}/scenes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', sceneId, ...patch }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function toggleMonetization(value: boolean) {
    setPending(true);
    try {
      await fetch(`/api/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monetizationReady: value }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <PipelineStepper steps={steps} />
        </CardContent>
      </Card>

      {rights.blocking.length > 0 ? (
        <Alert tone="danger" title="🔴 Export bloqué — assets interdits">
          <ul className="mt-1 space-y-1">
            {rights.blocking.map((issue) => (
              <li key={issue.assetId}>
                <strong>{issue.assetName}</strong> — {issue.reasons.join(' ')}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {rights.warnings.length > 0 ? (
        <Alert tone="warning" title="🟠 Droits à vérifier">
          <ul className="mt-1 space-y-1">
            {rights.warnings.map((issue) => (
              <li key={issue.assetId}>
                <strong>{issue.assetName}</strong> — {issue.reasons.join(' ')}
              </li>
            ))}
          </ul>
          {video.monetizationReady ? (
            <p className="mt-2">
              Cette vidéo est marquée <strong>prête pour la monétisation</strong> : le rendu sera
              refusé tant que ces droits ne sont pas validés.
            </p>
          ) : null}
        </Alert>
      ) : null}

      {error ? <Alert tone="danger"><pre className="whitespace-pre-wrap font-sans">{error}</pre></Alert> : null}
      {job.error ? <Alert tone="danger"><pre className="whitespace-pre-wrap font-sans">{job.error}</pre></Alert> : null}
      {notice ? <Alert tone="info"><pre className="whitespace-pre-wrap font-sans text-xs">{notice}</pre></Alert> : null}
      {job.job ? <JobProgress job={job.job} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Storyboard
                {scenes.length > 0 ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {scenes.length} scènes — {formatDuration(totalStoryboardMs)}
                  </span>
                ) : null}
              </CardTitle>
              <Button
                size="sm"
                onClick={() => runStep('storyboard')}
                disabled={job.busy || !video.hasScript}
              >
                <Layers />
                {scenes.length > 0 ? 'Régénérer' : 'Générer'}
              </Button>
            </CardHeader>
            <CardContent>
              {scenes.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {video.hasScript
                    ? "Générez le storyboard : l'IA découpe le script en scènes de 2 à 6 secondes."
                    : "Rattachez un script à cette vidéo pour générer le storyboard."}
                </p>
              ) : (
                <div className="space-y-3">
                  {scenes.map((scene) => (
                    <div key={scene.id} className="rounded-lg border p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="default">Scène {scene.order + 1}</Badge>
                        <Badge variant="outline">{scene.section}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(scene.startMs)} → {formatDuration(scene.startMs + scene.durationMs)}
                        </span>
                        {scene.assetRights ? (
                          <RightsBadge status={scene.assetRights as never} />
                        ) : (
                          <Badge variant="muted">Aucun asset — ardoise au rendu</Badge>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                        {scene.assetThumbnailUrl ? (
                          <img
                            src={scene.assetThumbnailUrl}
                            alt=""
                            className="h-24 w-14 rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-24 w-14 items-center justify-center rounded bg-muted text-muted-foreground">
                            <Film className="size-5" />
                          </div>
                        )}

                        <div className="space-y-2">
                          <Textarea
                            defaultValue={scene.narration}
                            onBlur={(e) => {
                              if (e.target.value !== scene.narration) {
                                void updateScene(scene.id, { narration: e.target.value });
                              }
                            }}
                            className="min-h-[60px] text-sm"
                            placeholder="Narration (voix off)"
                          />
                          <Input
                            defaultValue={scene.visualPrompt}
                            onBlur={(e) => {
                              if (e.target.value !== scene.visualPrompt) {
                                void updateScene(scene.id, { visualPrompt: e.target.value });
                              }
                            }}
                            className="h-9 text-sm"
                            placeholder="Description du plan"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Select
                              value={scene.assetId ?? ''}
                              onChange={(e) =>
                                void updateScene(scene.id, { assetId: e.target.value || null })
                              }
                              className="h-9 w-auto min-w-[180px] text-xs"
                              disabled={pending}
                            >
                              <option value="">Aucun asset</option>
                              {assets.map((asset) => (
                                <option key={asset.id} value={asset.id}>
                                  {asset.name} ({asset.source})
                                </option>
                              ))}
                            </Select>
                            <Input
                              type="number"
                              min={0.3}
                              step="0.1"
                              defaultValue={(scene.durationMs / 1000).toFixed(1)}
                              onBlur={(e) =>
                                void updateScene(scene.id, {
                                  durationMs: Math.round(Number(e.target.value) * 1000),
                                })
                              }
                              className="h-9 w-24 text-xs"
                              title="Durée en secondes"
                            />
                            <Select
                              value={scene.transition}
                              onChange={(e) =>
                                void updateScene(scene.id, { transition: e.target.value })
                              }
                              className="h-9 w-auto text-xs"
                            >
                              {['cut', 'fade', 'wipeleft', 'slideup', 'circleopen'].map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </Select>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {video.masterUrl ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-3">
                  <video
                    src={video.masterUrl}
                    controls
                    poster={video.thumbnailUrl ?? undefined}
                    className="max-h-[560px] rounded-lg border bg-black"
                  />
                  <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">
                      {video.width}×{video.height} @ {video.fps} fps
                    </Badge>
                    {video.renderedDurationMs ? (
                      <Badge variant="secondary">{formatDuration(video.renderedDurationMs)}</Badge>
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <a href={video.masterUrl} download>
                        <Download />
                        Télécharger le master
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {quality ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  QUALITY SCORE: {quality.score}/100{' '}
                  <Badge variant={quality.passed ? 'success' : 'destructive'}>
                    {quality.passed ? 'Export autorisé' : 'Export bloqué'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Progress value={quality.score} />
                <ul className="space-y-1.5 text-sm">
                  {quality.checks.map((check) => (
                    <li key={check.id} className="flex gap-2">
                      <span
                        className={
                          check.status === 'pass'
                            ? 'text-success'
                            : check.status === 'warn'
                              ? 'text-warning'
                              : 'text-destructive'
                        }
                      >
                        {check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗'}
                      </span>
                      <span>
                        <strong>{check.label}</strong>
                        <span className="text-muted-foreground"> — {check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => runStep('voice')}
                disabled={job.busy || scenes.length === 0}
              >
                <Mic />
                {voice ? 'Régénérer la voix' : 'Générer la voix'}
              </Button>

              <div className="flex gap-2">
                <Select
                  value={captionStyle}
                  onChange={(e) => setCaptionStyle(e.target.value)}
                  className="h-10 w-auto flex-1 text-xs"
                >
                  {CAPTION_STYLES.map((style) => (
                    <option key={style} value={style}>{style}</option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  onClick={() => runStep('captions', { style: captionStyle })}
                  disabled={job.busy || scenes.length === 0}
                >
                  <Subtitles />
                  Sous-titres
                </Button>
              </div>

              <Button
                className="w-full justify-start"
                onClick={() => runStep('render', { preset: 'final' })}
                disabled={job.busy || scenes.length === 0 || rights.blocking.length > 0}
              >
                <Clapperboard />
                {video.masterUrl ? 'Relancer le montage' : 'Lancer le montage'}
              </Button>

              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={runQuality}
                disabled={pending}
              >
                <ShieldCheck />
                Contrôle qualité
              </Button>

              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => runStep('render', { preset: 'draft' })}
                disabled={job.busy || scenes.length === 0 || rights.blocking.length > 0}
                title="Rendu rapide, qualité réduite"
              >
                <Wand2 />
                Rendu brouillon
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export multi-plateforme</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                {PLATFORMS.map((platform) => (
                  <label key={platform.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedPlatforms.includes(platform.value)}
                      onChange={(e) =>
                        setSelectedPlatforms((prev) =>
                          e.target.checked
                            ? [...prev, platform.value]
                            : prev.filter((p) => p !== platform.value),
                        )
                      }
                      className="size-4 rounded border-input"
                    />
                    {platform.label}
                  </label>
                ))}
              </div>
              <Button
                className="w-full"
                onClick={buildVersions}
                disabled={pending || !video.masterUrl || selectedPlatforms.length === 0}
              >
                <Download />
                Export all platforms
              </Button>
              <p className="text-xs text-muted-foreground">
                Aucun filigrane d&apos;une autre plateforme n&apos;est ajouté.
              </p>

              {versions.length > 0 ? (
                <ul className="space-y-1.5 border-t pt-3 text-sm">
                  {versions.map((version) => (
                    <li key={version.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{version.platform}</span>
                      <Badge variant="muted">
                        {version.sizeBytes
                          ? `${(version.sizeBytes / 1_048_576).toFixed(1)} Mo`
                          : '—'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          {voice || captions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fichiers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {voice ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Voix — {voice.provider} · {formatDuration(voice.durationMs)}
                    </p>
                    <audio src={voice.url} controls className="w-full" />
                  </div>
                ) : null}
                {captions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {captions.map((track) => (
                      <Button key={track.id} asChild size="sm" variant="outline">
                        <a href={track.url} download>
                          .{track.format}
                        </a>
                      </Button>
                    ))}
                  </div>
                ) : null}
                {captions[0] ? (
                  <p className="text-xs text-muted-foreground">
                    Timings :{' '}
                    {captions[0].method === 'whisper'
                      ? 'transcrits'
                      : 'estimés à partir des durées de scènes'}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Coût de production</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row label="Voix" value={formatCents(cost.voiceCents)} />
              <Row label="Vidéo IA" value={formatCents(cost.videoAiCents)} />
              <Row label="LLM" value={formatCents(cost.llmCents)} />
              <Row label="Stockage" value={formatCents(cost.storageCents)} />
              <div className="border-t pt-1.5">
                <Row label="Total" value={formatCents(cost.totalCents)} bold />
              </div>
              <Row label="Revenu estimé" value={formatCents(cost.estimatedRevenueCents)} />
              <Row
                label="ROI"
                value={cost.roiPercent === null ? '—' : `${cost.roiPercent}%`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monétisation</CardTitle>
            </CardHeader>
            <CardContent>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={video.monetizationReady}
                  onChange={(e) => void toggleMonetization(e.target.checked)}
                  disabled={pending}
                  className="mt-0.5 size-4 rounded border-input"
                />
                <span>
                  <strong>MONETIZATION_READY</strong>
                  <span className="block text-xs text-muted-foreground">
                    Le rendu est refusé si un asset a des droits non validés.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? 'font-semibold' : 'font-medium'}>{value}</span>
    </div>
  );
}
