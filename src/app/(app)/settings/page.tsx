import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { providerStatus } from '@/lib/env';
import { checkFFmpegAvailable } from '@/server/render/ffmpeg';
import { PageHeader } from '@/components/domain/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { WorkspaceSettings } from './workspace-settings';

export const dynamic = 'force-dynamic';

const PROVIDER_LABELS: Record<string, string> = {
  ai: 'Génération de texte (idées, scripts, storyboard, analyse)',
  voice: 'Voix off',
  video: 'Génération de plans vidéo',
  publishing: 'Publication',
  storage: 'Stockage',
};

export default async function SettingsPage() {
  const session = await requireSessionOrRedirect();

  const [workspace, accounts, ffmpeg] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: session.workspaceId } }),
    prisma.socialAccount.findMany({
      where: { workspaceId: session.workspaceId, deletedAt: null },
      select: {
        id: true,
        platform: true,
        handle: true,
        locale: true,
        audience: true,
        tone: true,
        defaultHashtags: true,
        requireMinDuration: true,
        minDurationSec: true,
      },
      orderBy: { platform: 'asc' },
    }),
    checkFFmpegAvailable(),
  ]);

  const providers = providerStatus();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configuration du workspace, comptes sociaux et état des fournisseurs."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkspaceSettings
          workspace={{
            name: workspace?.name ?? '',
            locale: workspace?.locale ?? 'fr',
            niche: workspace?.niche ?? '',
            aiBudgetCentsMonthly: workspace?.aiBudgetCentsMonthly ?? 0,
          }}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fournisseurs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(providers).map(([key, status]) => (
              <div key={key} className="rounded-lg border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{PROVIDER_LABELS[key] ?? key}</span>
                  <Badge variant={status.configured ? 'success' : 'warning'}>
                    {status.configured ? status.selected : `${status.selected} — simulé`}
                  </Badge>
                </div>
                {!status.configured ? (
                  <p className="text-xs text-muted-foreground">
                    À configurer : <code>{status.requires}</code>
                  </p>
                ) : null}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Les secrets ne sont jamais renvoyés par l&apos;API : seul leur état de configuration
              est exposé. Modifiez-les dans votre fichier <code>.env</code>, puis redémarrez
              l&apos;application et le worker.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Moteur de montage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ffmpeg.ffmpeg.available && ffmpeg.ffprobe.available ? (
              <>
                <Badge variant="success">FFmpeg disponible</Badge>
                <p className="font-mono text-xs text-muted-foreground">{ffmpeg.ffmpeg.version}</p>
              </>
            ) : (
              <Alert tone="danger" title="FFmpeg introuvable">
                Le montage, les miniatures et la mesure des durées échoueront. Installez ffmpeg
                (<code>apt install ffmpeg</code> ou <code>brew install ffmpeg</code>) ou ajustez{' '}
                <code>FFMPEG_PATH</code> et <code>FFPROBE_PATH</code>.
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comptes sociaux</CardTitle>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun compte enregistré.</p>
            ) : (
              <ul className="space-y-2">
                {accounts.map((account) => (
                  <li key={account.id} className="rounded-lg border p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{account.platform}</Badge>
                      <span className="text-sm font-medium">{account.handle}</span>
                      <Badge variant="muted">{account.locale}</Badge>
                      {account.requireMinDuration ? (
                        <Badge variant="warning">≥ {account.minDurationSec}s exigé</Badge>
                      ) : null}
                    </div>
                    {account.audience ? (
                      <p className="text-xs text-muted-foreground">{account.audience}</p>
                    ) : null}
                    {account.defaultHashtags.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {account.defaultHashtags.map((h) => `#${h}`).join(' ')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              La connexion OAuth des plateformes relève de la phase 2. Sans elle, la publication
              passe en « publication manuelle requise » — IAvid ne contourne aucune plateforme.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
