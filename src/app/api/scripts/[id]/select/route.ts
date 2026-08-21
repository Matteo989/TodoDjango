import { requireWorkspace } from '@/server/auth/guard';
import { selectScript } from '@/server/services/scripts';
import { apiError, ok } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    return ok(await selectScript(workspaceId, id));
  } catch (error) {
    return apiError(error);
  }
}
