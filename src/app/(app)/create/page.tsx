import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { listAvailableVoices } from '@/server/services/voice';
import { providerStatus } from '@/lib/env';
import { PageHeader } from '@/components/domain/page-header';
import { CreateWizard } from './create-wizard';

export const dynamic = 'force-dynamic';

export default async function CreatePage() {
  const session = await requireSessionOrRedirect();
  const workspaceId = session.workspaceId;

  const [ideas, templates, voices, assets, music] = await Promise.all([
    prisma.idea.findMany({
      where: { workspaceId, deletedAt: null, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, title: true, targetDurationSec: true, concept: true },
    }),
    prisma.template.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        targetDurationSec: true,
        captionStyle: true,
      },
    }),
    listAvailableVoices('fr'),
    prisma.asset.count({ where: { workspaceId, deletedAt: null, kind: { in: ['VIDEO', 'IMAGE'] } } }),
    prisma.music.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, commercialUse: true, mood: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Create Video"
        description="Six étapes, de l'idée à l'export. Chaque étape reste relançable ensuite depuis la fiche vidéo."
      />
      <CreateWizard
        ideas={ideas}
        templates={templates}
        voices={voices.voices}
        voiceProvider={voices.provider}
        voiceIsLive={voices.isLive}
        assetCount={assets}
        music={music}
        aiConfigured={providerStatus().ai.configured}
      />
    </>
  );
}
