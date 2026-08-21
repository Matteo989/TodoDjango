import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * Crée un workspace jetable. Chaque test travaille dans le sien: sans cela,
 * les tests s'observeraient mutuellement à travers les requêtes par workspace.
 */
export async function createTestWorkspace(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const user = await prisma.user.create({
    data: {
      email: `test-${suffix}@iavid.test`,
      name: `Test ${label}`,
      passwordHash: 'x'.repeat(60),
      memberships: {
        create: {
          role: 'OWNER',
          workspace: { create: { name: `Test ${label}`, slug: `test-${suffix}` } },
        },
      },
    },
    include: { memberships: true },
  });

  const workspaceId = user.memberships[0]?.workspaceId;
  if (!workspaceId) throw new Error("Le workspace de test n'a pas été créé.");

  return { userId: user.id, workspaceId };
}

export async function destroyTestWorkspace(workspaceId: string, userId: string) {
  // Le cascade depuis Workspace emporte tout le contenu rattaché.
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}
