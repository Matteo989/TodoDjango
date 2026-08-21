import { redirect } from 'next/navigation';
import { getSession, type SessionPayload } from './session';
import { prisma } from '../db';

export class UnauthorizedError extends Error {
  constructor(message = 'Authentification requise.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Accès refusé à ce workspace.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Pour les Route Handlers: lève plutôt que de rediriger. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * Vérifie l'appartenance au workspace demandé.
 * Sans cette vérification, un identifiant de workspace deviné donnerait accès
 * aux données d'un autre utilisateur — le cookie seul ne suffit pas.
 */
export async function requireWorkspace(workspaceId?: string): Promise<{
  session: SessionPayload;
  workspaceId: string;
}> {
  const session = await requireSession();
  const target = workspaceId ?? session.workspaceId;

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.userId, workspaceId: target } },
  });
  if (!membership) throw new ForbiddenError();

  return { session, workspaceId: target };
}

/** Pour les Server Components: redirige vers la connexion. */
export async function requireSessionOrRedirect(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}
