import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { PageHeader } from '@/components/domain/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

interface StructureSection {
  section: string;
  weight: number;
  note?: string;
}

export default async function TemplatesPage() {
  const session = await requireSessionOrRedirect();

  const templates = await prisma.template.findMany({
    where: { workspaceId: session.workspaceId, deletedAt: null },
    orderBy: { name: 'asc' },
    include: { _count: { select: { videos: true } } },
  });

  return (
    <>
      <PageHeader
        title="Templates"
        description="Un template fixe la structure, les durées, le style de sous-titres et les transitions."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => {
          const structure = template.structure as { sections?: StructureSection[] } | null;
          const sections = structure?.sections ?? [];
          const total = sections.reduce((sum, s) => sum + s.weight, 0) || 1;

          return (
            <Card key={template.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  {template.name}
                  {template.isBuiltIn ? <Badge variant="muted">Intégré</Badge> : null}
                </CardTitle>
                {template.description ? (
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {sections.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="flex h-2 overflow-hidden rounded-full">
                      {sections.map((section, index) => (
                        <div
                          key={`${section.section}-${index}`}
                          style={{ width: `${(section.weight / total) * 100}%` }}
                          className={
                            [
                              'bg-primary',
                              'bg-primary/70',
                              'bg-primary/50',
                              'bg-primary/35',
                              'bg-primary/20',
                            ][index % 5]
                          }
                          title={`${section.section} — ${Math.round((section.weight / total) * template.targetDurationSec)}s`}
                        />
                      ))}
                    </div>
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {sections.map((section, index) => (
                        <li key={`${section.section}-${index}`} className="flex justify-between gap-2">
                          <span className="font-medium text-foreground">{section.section}</span>
                          <span>
                            ~{Math.round((section.weight / total) * template.targetDurationSec)}s
                            {section.note ? ` — ${section.note}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{template.targetDurationSec}s</Badge>
                  <Badge variant="outline">{template.captionStyle}</Badge>
                  <Badge variant="outline">{template.transition}</Badge>
                  {template.musicMood ? (
                    <Badge variant="outline">🎵 {template.musicMood}</Badge>
                  ) : null}
                  {template.outroEnabled ? <Badge variant="outline">outro</Badge> : null}
                  {template._count.videos > 0 ? (
                    <Badge variant="default">{template._count.videos} vidéo(s)</Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
