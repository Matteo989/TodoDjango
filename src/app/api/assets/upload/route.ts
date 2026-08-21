import { requireWorkspace } from '@/server/auth/guard';
import { createAsset } from '@/server/services/assets';
import { apiError, ok } from '@/lib/api';

/** 2 Go: au-delà, un upload HTTP direct n'est plus le bon outil. */
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const form = await request.formData();

    const file = form.get('file');
    if (!(file instanceof File)) {
      return ok({ error: 'Aucun fichier reçu.' }, 400);
    }
    if (file.size > MAX_BYTES) {
      return ok({ error: 'Fichier trop volumineux (2 Go maximum).' }, 413);
    }

    const source = String(form.get('source') ?? 'OWNED');
    const allowed = ['OWNED', 'LICENSED', 'AI_GENERATED', 'PUBLIC_DOMAIN', 'EXTERNAL_REFERENCE'];
    if (!allowed.includes(source)) {
      return ok({ error: `Provenance invalide: ${source}` }, 400);
    }

    const asset = await createAsset({
      workspaceId,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      buffer: Buffer.from(await file.arrayBuffer()),
      source: source as never,
      name: (form.get('name') as string) || undefined,
      author: (form.get('author') as string) || undefined,
      sourceUrl: (form.get('sourceUrl') as string) || undefined,
      license: (form.get('license') as string) || undefined,
      commercialUse: (form.get('commercialUse') as never) || undefined,
      notes: (form.get('notes') as string) || undefined,
    });

    return ok(asset, 201);
  } catch (error) {
    return apiError(error);
  }
}
