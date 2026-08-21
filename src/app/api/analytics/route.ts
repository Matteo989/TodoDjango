import { z } from 'zod';
import { requireWorkspace } from '@/server/auth/guard';
import {
  dashboardStats,
  learningInsights,
  recordAnalytics,
  topVideos,
  viewsPerDay,
  viewsPerPlatform,
} from '@/server/services/analytics';
import { apiError, ok } from '@/lib/api';

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const view = new URL(request.url).searchParams.get('view') ?? 'summary';

    if (view === 'learning') return ok(await learningInsights(workspaceId));

    const [stats, perDay, perPlatform, top] = await Promise.all([
      dashboardStats(workspaceId),
      viewsPerDay(workspaceId),
      viewsPerPlatform(workspaceId),
      topVideos(workspaceId),
    ]);

    return ok({ stats, perDay, perPlatform, top });
  } catch (error) {
    return apiError(error);
  }
}

const recordSchema = z.object({
  videoId: z.string().min(1),
  publicationId: z.string().optional(),
  platform: z.enum(['TIKTOK', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'SNAPCHAT_SPOTLIGHT']),
  measuredOn: z.string().datetime().optional(),
  views: z.number().int().min(0),
  likes: z.number().int().min(0).default(0),
  comments: z.number().int().min(0).default(0),
  shares: z.number().int().min(0).default(0),
  followersGained: z.number().int().min(0).default(0),
  avgWatchMs: z.number().int().min(0).default(0),
  revenueCents: z.number().int().min(0).default(0),
});

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = recordSchema.parse(await request.json());

    return ok(
      await recordAnalytics({
        ...input,
        workspaceId,
        measuredOn: input.measuredOn ? new Date(input.measuredOn) : new Date(),
      }),
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
