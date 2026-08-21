import { requireWorkspace } from '@/server/auth/guard';
import { listAssets } from '@/server/services/assets';
import { storage } from '@/server/storage';
import { apiError, ok } from '@/lib/api';

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const url = new URL(request.url);

    const assets = await listAssets({
      workspaceId,
      kind: (url.searchParams.get('kind') as never) ?? undefined,
      source: (url.searchParams.get('source') as never) ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      onlyCleared: url.searchParams.get('onlyCleared') === 'true',
    });

    const store = storage();
    const items = await Promise.all(
      assets.map(async (asset) => ({
        ...asset,
        url: await store.url(asset.storageKey),
        thumbnailUrl: asset.thumbnailKey ? await store.url(asset.thumbnailKey) : null,
      })),
    );

    return ok({ items, total: items.length });
  } catch (error) {
    return apiError(error);
  }
}
