import { requireSessionOrRedirect } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { AppShell } from './app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionOrRedirect();

  const workspace = await prisma.workspace.findUnique({
    where: { id: session.workspaceId },
    select: { id: true, name: true, slug: true },
  });

  const runningJobs = await prisma.aIJob.count({
    where: { workspaceId: session.workspaceId, status: { in: ['QUEUED', 'RUNNING'] } },
  });

  return (
    <AppShell
      userName={session.name}
      workspaceName={workspace?.name ?? 'Workspace'}
      runningJobs={runningJobs}
    >
      {children}
    </AppShell>
  );
}
