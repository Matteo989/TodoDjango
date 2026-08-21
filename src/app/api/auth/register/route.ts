import { z } from 'zod';
import { prisma } from '@/server/db';
import { hashPassword } from '@/server/auth/password';
import { setSessionCookie } from '@/server/auth/session';
import { apiError, ok } from '@/lib/api';
import { slugify } from '@/lib/utils';

const schema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(10, 'Le mot de passe doit faire au moins 10 caractères.'),
  workspaceName: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const email = input.email.toLowerCase();

    if (await prisma.user.findUnique({ where: { email } })) {
      return ok({ error: 'Un compte existe déjà avec cet email.' }, 409);
    }

    // Un slug unique: deux workspaces nommés « DIY Factory » sont légitimes.
    const base = slugify(input.workspaceName) || 'workspace';
    let slug = base;
    for (let i = 2; await prisma.workspace.findUnique({ where: { slug } }); i += 1) {
      slug = `${base}-${i}`;
    }

    const user = await prisma.user.create({
      data: {
        email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        memberships: {
          create: {
            role: 'OWNER',
            workspace: { create: { name: input.workspaceName, slug } },
          },
        },
      },
      include: { memberships: { include: { workspace: true } } },
    });

    const workspaceId = user.memberships[0]?.workspaceId;
    if (!workspaceId) throw new Error('Le workspace n’a pas pu être créé.');

    await seedTemplates(workspaceId);

    await setSessionCookie({
      userId: user.id,
      email: user.email,
      name: user.name,
      workspaceId,
    });

    return ok({ userId: user.id, workspaceId }, 201);
  } catch (error) {
    return apiError(error);
  }
}

/** Les six templates de la spécification sont livrés avec chaque workspace. */
async function seedTemplates(workspaceId: string): Promise<void> {
  const templates = [
    { key: 'DIY_FAST', name: 'DIY Fast', targetDurationSec: 30, captionStyle: 'BOLD' as const, transition: 'cut' },
    { key: 'DIY_EDUCATIONAL', name: 'DIY Educational', targetDurationSec: 60, captionStyle: 'MINIMAL' as const, transition: 'fade' },
    { key: 'DIY_BEFORE_AFTER', name: 'DIY Before / After', targetDurationSec: 35, captionStyle: 'HIGHLIGHTED' as const, transition: 'wipeleft' },
    { key: 'DIY_TEST', name: 'DIY Test', targetDurationSec: 45, captionStyle: 'BOLD' as const, transition: 'fade' },
    { key: 'DIY_TOP_5', name: 'DIY Top 5', targetDurationSec: 50, captionStyle: 'KARAOKE' as const, transition: 'slideup' },
    { key: 'DIY_MYTH_BUSTING', name: 'DIY Myth Busting', targetDurationSec: 45, captionStyle: 'CENTERED' as const, transition: 'circleopen' },
  ];

  for (const template of templates) {
    await prisma.template.create({
      data: {
        workspaceId,
        ...template,
        isBuiltIn: true,
        structure: {
          sections: [
            { section: 'HOOK', weight: 10 },
            { section: 'PROBLEM', weight: 17 },
            { section: 'SOLUTION', weight: 53 },
            { section: 'RESULT', weight: 12 },
            { section: 'CTA', weight: 8 },
          ],
        },
      },
    });
  }
}
