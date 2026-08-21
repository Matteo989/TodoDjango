import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { providerStatus } from '@/lib/env';
import { PageHeader } from '@/components/domain/page-header';
import { GenerateIdeasForm } from './generate-form';

export const dynamic = 'force-dynamic';

export default async function GenerateIdeasPage() {
  const session = await requireSessionOrRedirect();

  const [workspace, trendCount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: session.workspaceId },
      select: { niche: true, locale: true },
    }),
    prisma.trend.count({ where: { workspaceId: session.workspaceId, deletedAt: null } }),
  ]);

  const providers = providerStatus();

  return (
    <>
      <PageHeader
        title="Generate Ideas"
        description="L'IA propose des angles originaux inspirés de vos tendances — elle ne recopie aucune vidéo existante."
      />
      <GenerateIdeasForm
        defaultNiche={workspace?.niche ?? 'DIY / bricolage / maison'}
        defaultLanguage={workspace?.locale ?? 'fr'}
        trendCount={trendCount}
        aiConfigured={providers.ai.configured}
        aiProvider={providers.ai.selected}
      />
    </>
  );
}
