import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { requireSessionOrRedirect } from '@/server/auth/guard';
import { listIdeas } from '@/server/services/ideas';
import { PageHeader } from '@/components/domain/page-header';
import { Button } from '@/components/ui/button';
import { IdeasBrowser } from './ideas-browser';

export const dynamic = 'force-dynamic';

export default async function IdeasPage() {
  const session = await requireSessionOrRedirect();
  const { items } = await listIdeas({ workspaceId: session.workspaceId, take: 200, includeArchived: true });

  return (
    <>
      <PageHeader
        title="Ideas"
        description="Le point d'entrée du pipeline. Chaque idée porte ses scores et son statut."
        action={
          <Button asChild>
            <Link href="/ideas/generate">
              <Sparkles />
              Generate Ideas
            </Link>
          </Button>
        }
      />
      <IdeasBrowser
        initialItems={items.map((idea) => ({
          id: idea.id,
          title: idea.title,
          description: idea.description,
          hook: idea.hook,
          category: idea.category,
          subcategory: idea.subcategory,
          difficulty: idea.difficulty,
          status: idea.status,
          estimatedCostCents: idea.estimatedCostCents,
          targetDurationSec: idea.targetDurationSec,
          viralScore: idea.viralScore,
          originalityScore: idea.originalityScore,
          productionScore: idea.productionScore,
          affiliateScore: idea.affiliateScore,
          safetyScore: idea.safetyScore,
          notes: idea.notes,
          scriptCount: idea._count.scripts,
          videoCount: idea._count.videos,
          createdAt: idea.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
