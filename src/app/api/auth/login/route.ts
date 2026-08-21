import { z } from 'zod';
import { prisma } from '@/server/db';
import { verifyPassword } from '@/server/auth/password';
import { setSessionCookie } from '@/server/auth/session';
import { apiError, ok } from '@/lib/api';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const { email, password } = schema.parse(await request.json());

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });

    // Message identique quel que soit l'échec: distinguer « email inconnu » de
    // « mot de passe faux » révélerait quels comptes existent.
    const invalid = { error: 'Email ou mot de passe incorrect.' };
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return ok(invalid, 401);
    }

    const workspaceId = user.memberships[0]?.workspaceId;
    if (!workspaceId) {
      return ok({ error: "Ce compte n'appartient à aucun workspace." }, 403);
    }

    await setSessionCookie({
      userId: user.id,
      email: user.email,
      name: user.name,
      workspaceId,
    });

    return ok({ userId: user.id, workspaceId });
  } catch (error) {
    return apiError(error);
  }
}
