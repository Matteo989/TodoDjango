import Link from 'next/link';
import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { PageHeader } from '@/components/domain/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function ScriptsPage() {
  const session = await requireSessionOrRedirect();

  const scripts = await prisma.script.findMany({
    where: { workspaceId: session.workspaceId, deletedAt: null },
    include: {
      idea: { select: { id: true, title: true } },
      blocks: { orderBy: { order: 'asc' }, take: 1 },
      claims: { where: { status: 'SAFETY_WARNING' } },
      _count: { select: { videos: true } },
    },
    orderBy: [{ isSelected: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="Scripts"
        description="Toutes les variantes générées. La variante retenue est celle qui part en production."
      />

      {scripts.length === 0 ? (
        <EmptyState
          title="Aucun script"
          description="Ouvrez une idée et générez ses cinq variantes (éducatif, viral, storytelling, direct, mystérieux)."
          action={
            <Button asChild>
              <Link href="/ideas">Voir les idées</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {scripts.map((script) => (
            <Card key={script.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/ideas/${script.ideaId}`}
                    className="text-sm font-semibold leading-snug hover:underline"
                  >
                    {script.title}
                  </Link>
                  <Badge variant={script.isSelected ? 'success' : 'secondary'}>
                    {script.isSelected ? 'Retenu' : script.style}
                  </Badge>
                </div>

                {script.blocks[0] ? (
                  <p className="line-clamp-2 text-xs italic text-muted-foreground">
                    « {script.blocks[0].text} »
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{formatDuration(script.targetDurationSec * 1000)}</Badge>
                  <Badge variant="outline">{script.language}</Badge>
                  {script.similarityScore !== null ? (
                    <Badge variant={script.similarityScore >= 80 ? 'destructive' : 'muted'}>
                      Similarité {script.similarityScore}%
                    </Badge>
                  ) : null}
                  {script.claims.length > 0 ? (
                    <Badge variant="warning">⚠ {script.claims.length} avertissement(s)</Badge>
                  ) : null}
                  {script._count.videos > 0 ? (
                    <Badge variant="default">{script._count.videos} vidéo(s)</Badge>
                  ) : null}
                </div>

                {script.idea ? (
                  <p className="truncate text-xs text-muted-foreground">{script.idea.title}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
