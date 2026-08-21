import { requireWorkspace } from '@/server/auth/guard';
import { listAvailableVoices } from '@/server/services/voice';
import { apiError, ok } from '@/lib/api';

export async function GET(request: Request) {
  try {
    await requireWorkspace();
    const language = new URL(request.url).searchParams.get('language') ?? 'fr';
    return ok(await listAvailableVoices(language));
  } catch (error) {
    return apiError(error);
  }
}
