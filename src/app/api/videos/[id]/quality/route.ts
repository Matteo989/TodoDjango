import { requireWorkspace } from '@/server/auth/guard';
import { formatQualityReport, runQualityControl } from '@/server/services/quality';
import { apiError, ok } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

/**
 * Contrôle qualité synchrone: il ne fait que lire le fichier déjà rendu et
 * interroger la base — quelques centaines de millisecondes, inutile de passer
 * par la file.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const result = await runQualityControl(workspaceId, id);
    return ok({ ...result, report: formatQualityReport(result) });
  } catch (error) {
    return apiError(error);
  }
}
