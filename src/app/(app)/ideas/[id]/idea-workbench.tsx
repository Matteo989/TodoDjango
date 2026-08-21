'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, FileText, ShieldAlert, Video, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Alert, Tabs } from '@/components/ui/misc';
import { JobProgress, useJob } from '@/components/domain/job-runner';
import { formatDuration } from '@/lib/utils';

interface ScriptBlock {
  id: string;
  section: string;
  text: string;
  startMs: number;
  endMs: number;
}

interface Claim {
  id: string;
  text: string;
  status: string;
  safetyTopic: string | null;
  humanReviewed: boolean;
}

export interface ScriptSummary {
  id: string;
  style: string;
  title: string;
  isSelected: boolean;
  similarityScore: number | null;
  similarityMethod: string | null;
  blocks: ScriptBlock[];
  claims: Claim[];
}

const CLAIM_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  VERIFIED: 'success',
  UNVERIFIED: 'warning',
  OPINION: 'muted',
  SAFETY_WARNING: 'destructive',
};

export function IdeaWorkbench({
  ideaId,
  ideaTitle,
  defaultDuration,
  templates,
  scripts,
  videos,
}: {
  ideaId: string;
  ideaTitle: string;
  defaultDuration: number;
  templates: Array<{ id: string; name: string; targetDurationSec: number }>;
  scripts: ScriptSummary[];
  videos: Array<{ id: string; title: string; status: string }>;
}) {
  const router = useRouter();
  const scriptJob = useJob();
  const [activeScript, setActiveScript] = useState(scripts[0]?.id ?? '');
  const [duration, setDuration] = useState(defaultDuration);
  const [templateId, setTemplateId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const current = scripts.find((s) => s.id === activeScript) ?? scripts[0];

  async function generateScripts() {
    setNotice(null);
    await scriptJob.run(
      '/api/scripts/generate',
      { ideaId, targetDurationSec: duration },
      () => router.refresh(),
    );
  }

  async function selectScript(scriptId: string) {
    setPending(true);
    try {
      await fetch(`/api/scripts/${scriptId}/select`, { method: 'POST' });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function checkDuplication(scriptId: string) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/scripts/${scriptId}/duplication`, { method: 'POST' });
      const payload = (await response.json()) as {
        score: number;
        method: string;
        isDuplicate: boolean;
        closestTitle: string | null;
        error?: string;
      };
      if (!response.ok) {
        setNotice(payload.error ?? 'Vérification impossible.');
        return;
      }
      setNotice(
        payload.isDuplicate
          ? `⚠️ Similarity detected: ${payload.score}% (méthode ${payload.method}) avec « ${payload.closestTitle} ». Réécrivez avec un angle différent.`
          : `Similarité maximale ${payload.score}% (méthode ${payload.method}) — script suffisamment original.`,
      );
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function runFactCheck(scriptId: string) {
    setNotice(null);
    await scriptJob.run(`/api/scripts/${scriptId}/factcheck`, {}, () => router.refresh());
  }

  async function markClaim(scriptId: string, claimId: string, status: string) {
    setPending(true);
    try {
      await fetch(`/api/scripts/${scriptId}/factcheck`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, status }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function createVideo(scriptId: string, templateId: string) {
    setPending(true);
    try {
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: ideaTitle,
          ideaId,
          scriptId,
          templateId: templateId || undefined,
          targetDurationSec: duration,
        }),
      });
      const payload = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        setNotice(payload.error ?? 'Création impossible.');
        return;
      }
      router.push(`/videos/${payload.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Scripts</CardTitle>
          <div className="flex items-end gap-2">
            <div className="w-32">
              <Label htmlFor="duration" className="text-xs">Durée (s)</Label>
              <Input
                id="duration"
                type="number"
                min={10}
                max={300}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="h-9"
              />
            </div>
            <Button onClick={generateScripts} disabled={scriptJob.busy}>
              <Wand2 />
              {scriptJob.busy ? 'Génération…' : '5 variantes'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {scriptJob.error ? <Alert tone="danger">{scriptJob.error}</Alert> : null}
          <JobProgress job={scriptJob.job} />
          {notice ? (
            <Alert tone={notice.startsWith('⚠️') ? 'warning' : 'info'}>{notice}</Alert>
          ) : null}

          {scripts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucun script. Générez cinq variantes (éducatif, viral, storytelling, direct,
              mystérieux) puis choisissez celle que vous produirez.
            </p>
          ) : (
            <>
              <Tabs
                tabs={scripts.map((s) => ({
                  id: s.id,
                  label: `${s.style}${s.isSelected ? ' ★' : ''}`,
                }))}
                active={current?.id ?? ''}
                onChange={setActiveScript}
              />

              {current ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={current.isSelected ? 'success' : 'secondary'}>
                      {current.isSelected ? 'Variante retenue' : current.style}
                    </Badge>
                    {current.similarityScore !== null ? (
                      <Badge variant={current.similarityScore >= 80 ? 'destructive' : 'muted'}>
                        Similarité {current.similarityScore}% ({current.similarityMethod})
                      </Badge>
                    ) : null}
                    <div className="ml-auto flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => checkDuplication(current.id)}
                        disabled={pending}
                      >
                        Anti-duplication
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runFactCheck(current.id)}
                        disabled={scriptJob.busy}
                      >
                        <ShieldAlert />
                        Fact check
                      </Button>
                      {!current.isSelected ? (
                        <Button size="sm" onClick={() => selectScript(current.id)} disabled={pending}>
                          <CheckCircle2 />
                          Choisir
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {current.blocks.map((block) => (
                      <div key={block.id} className="rounded-lg border p-3">
                        <div className="mb-1.5 flex items-center gap-2">
                          <Badge variant="outline">{block.section}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDuration(block.startMs)} → {formatDuration(block.endMs)}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed">{block.text}</p>
                      </div>
                    ))}
                  </div>

                  {current.claims.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Vérification factuelle</h4>
                      {current.claims.map((claim) => (
                        <div key={claim.id} className="rounded-lg border p-3">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <Badge variant={CLAIM_VARIANT[claim.status] ?? 'muted'}>
                              {claim.status}
                            </Badge>
                            {claim.safetyTopic ? (
                              <Badge variant="outline">{claim.safetyTopic}</Badge>
                            ) : null}
                            {claim.humanReviewed ? (
                              <Badge variant="success">Validé par un humain</Badge>
                            ) : null}
                          </div>
                          <p className="text-sm">{claim.text}</p>
                          {!claim.humanReviewed ? (
                            <div className="mt-2 flex gap-1.5">
                              {['VERIFIED', 'UNVERIFIED', 'OPINION'].map((status) => (
                                <Button
                                  key={status}
                                  size="sm"
                                  variant="outline"
                                  onClick={() => markClaim(current.id, claim.id, status)}
                                  disabled={pending}
                                >
                                  {status}
                                </Button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        Le statut VERIFIED ne peut être posé que par vous : l&apos;IA ne valide
                        jamais une affirmation seule.
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-end gap-2 border-t pt-4">
                    <div className="min-w-[200px] flex-1">
                      <Label htmlFor="template" className="text-xs">Template de montage</Label>
                      <Select
                        id="template"
                        value={templateId}
                        onChange={(e) => setTemplateId(e.target.value)}
                        className="h-9"
                      >
                        <option value="">Sans template</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.targetDurationSec}s)
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button onClick={() => createVideo(current.id, templateId)} disabled={pending}>
                      <Video />
                      Créer la vidéo
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {videos.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vidéos issues de cette idée</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {videos.map((video) => (
                <li key={video.id} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/videos/${video.id}`}
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    <FileText className="size-4 text-muted-foreground" />
                    {video.title}
                  </Link>
                  <Badge variant="secondary">{video.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
