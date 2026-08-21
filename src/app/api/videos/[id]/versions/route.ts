import { z } from 'zod';
import { requireWorkspace } from '@/server/auth/guard';
import { buildPlatformVersions } from '@/server/services/versions';
import { runQualityControl } from '@/server/services/quality';
import { apiError, ok } from '@/lib/api';

const schema = z.object({
  platforms: z
    .array(z.enum(['TIKTOK', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'SNAPCHAT_SPOTLIGHT']))
    .min(1),
  metadata: z.record(z.object({
    title: z.string(),
    description: z.string(),
    hashtags: z.array(z.string()),
    cta: z.string().default(''),
  })).optional(),
  /** Ignorer le contrôle qualité produirait un export que rien ne valide. */
  skipQualityGate: z.boolean().default(false),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const input = schema.parse(await request.json());

    if (!input.skipQualityGate) {
      const quality = await runQualityControl(workspaceId, id);
      const blockers = quality.checks.filter((c) => c.status === 'fail');
      // Les métadonnées sont justement produites par cette étape: leur absence
      // ne peut pas bloquer leur propre création.
      const relevant = blockers.filter((c) => c.id !== 'metadata');
      if (relevant.length > 0) {
        return ok(
          {
            error: "Export bloqué par le contrôle qualité.",
            score: quality.score,
            blockers: relevant,
          },
          422,
        );
      }
    }

    const versions = await buildPlatformVersions({
      workspaceId,
      videoId: id,
      platforms: input.platforms,
      metadata: input.metadata as never,
    });

    return ok({ versions });
  } catch (error) {
    return apiError(error);
  }
}
