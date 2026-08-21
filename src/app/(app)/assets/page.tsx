import { requireSessionOrRedirect } from '@/server/auth/guard';
import { listAssets } from '@/server/services/assets';
import { storage } from '@/server/storage';
import { PageHeader } from '@/components/domain/page-header';
import { AssetsLibrary } from './assets-library';

export const dynamic = 'force-dynamic';

export default async function AssetsPage() {
  const session = await requireSessionOrRedirect();
  const assets = await listAssets({ workspaceId: session.workspaceId, take: 300 });
  const store = storage();

  const items = await Promise.all(
    assets.map(async (asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      source: asset.source,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
      author: asset.author,
      license: asset.license,
      sourceUrl: asset.sourceUrl,
      commercialUse: asset.commercialUse,
      rightsStatus: asset.rightsRecord?.status ?? null,
      thumbnailUrl: asset.thumbnailKey ? await store.url(asset.thumbnailKey) : null,
      url: await store.url(asset.storageKey),
      notes: asset.notes,
    })),
  );

  return (
    <>
      <PageHeader
        title="Assets"
        description="Vos médias et leur provenance. Les droits gouvernent ce qui peut entrer dans un export monétisable."
      />
      <AssetsLibrary initialItems={items} />
    </>
  );
}
