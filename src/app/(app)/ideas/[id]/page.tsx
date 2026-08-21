import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { PageHeader } from '@/components/domain/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { formatCents } from '@/lib/utils';
import { IdeaWorkbench } from './idea-workbench';

export const dynamic = 'force-dynamic';

export default async function IdeaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSessionOrRedirect();
  const { id } = await params;

  const idea = await prisma.idea.findFirst({
    where: { id, workspaceId: session.workspaceId, deletedAt: null },
    include: {
      scripts: {
        orderBy: [{ isSelected: 'desc' }, { createdAt: 'desc' }],
        include: { blocks: { orderBy: { order: 'asc' } }, claims: true },
      },
      videos: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!idea) notFound();

  const templates = await prisma.template.findMany({
    where: { workspaceId: session.workspaceId, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, targetDurationSec: true },
  });

  return (
    <>
      <PageHeader
        title={idea.title}
        description={idea.concept ?? idea.description}
        action={<Badge variant="secondary">{idea.status}</Badge>}
      />

      {idea.notes.startsWith('⚠️') ? (
        <div className="mb-4">
          <Alert tone="warning" title="Sujet à risque détecté">
            <pre className="whitespace-pre-wrap font-sans text-xs">{idea.notes}</pre>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <IdeaWorkbench
            ideaId={idea.id}
            ideaTitle={idea.title}
            defaultDuration={idea.targetDurationSec}
            templates={templates}
            scripts={idea.scripts.map((script) => ({
              id: script.id,
              style: script.style,
              title: script.title,
              isSelected: script.isSelected,
              similarityScore: script.similarityScore,
              similarityMethod: script.similarityMethod,
              blocks: script.blocks.map((b) => ({
                id: b.id,
                section: b.section,
                text: b.text,
                startMs: b.startMs,
                endMs: b.endMs,
              })),
              claims: script.claims.map((c) => ({
                id: c.id,
                text: c.text,
                status: c.status,
                safetyTopic: c.safetyTopic,
                humanReviewed: c.humanReviewed,
              })),
            }))}
            videos={idea.videos.map((v) => ({ id: v.id, title: v.title, status: v.status }))}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'VIRAL_SCORE', value: idea.viralScore },
                { label: 'ORIGINALITY_SCORE', value: idea.originalityScore },
                { label: 'PRODUCTION_SCORE', value: idea.productionScore },
                { label: 'AFFILIATE_SCORE', value: idea.affiliateScore },
                { label: 'SAFETY_SCORE', value: idea.safetyScore },
              ].map((score) => (
                <div key={score.label} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-xs text-muted-foreground">{score.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${score.value}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm font-semibold tabular-nums">
                    {score.value}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fiche</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Catégorie" value={`${idea.category}${idea.subcategory ? ` / ${idea.subcategory}` : ''}`} />
              <Row label="Difficulté" value={idea.difficulty} />
              <Row label="Coût matériel" value={formatCents(idea.estimatedCostCents)} />
              <Row label="Durée cible" value={`${idea.targetDurationSec} s`} />
              <Row label="Objectif" value={idea.goal} />
              <Row label="Langue" value={idea.language} />
              {idea.cta ? <Row label="CTA" value={idea.cta} /> : null}
            </CardContent>
          </Card>

          {idea.sources.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sources</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {idea.sources.map((source) => (
                    <li key={source} className="truncate text-muted-foreground">{source}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Button asChild variant="outline" className="w-full">
            <Link href="/ideas">Retour aux idées</Link>
          </Button>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
