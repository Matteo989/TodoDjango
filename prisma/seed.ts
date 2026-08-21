import 'dotenv/config';
import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Jeu de données de démarrage.
 *
 * Contient uniquement ce qui rend l'application immédiatement utilisable:
 * un compte, un workspace, les six templates de la spécification, des idées
 * d'exemple et des tendances. Aucune statistique fictive n'est insérée — un
 * dashboard qui afficherait des vues inventées mentirait sur l'état réel.
 */

interface TemplateSeed {
  key: string;
  name: string;
  description: string;
  targetDurationSec: number;
  captionStyle: 'MINIMAL' | 'BOLD' | 'HIGHLIGHTED' | 'KARAOKE' | 'CENTERED';
  captionPosition: string;
  transition: string;
  musicMood: string | null;
  introEnabled: boolean;
  outroEnabled: boolean;
  structure: Prisma.InputJsonValue;
}

const TEMPLATES: TemplateSeed[] = [
  {
    key: 'DIY_FAST',
    name: 'DIY Fast',
    description: "Réparation express. Le résultat dès la première seconde, puis les étapes au rythme maximal.",
    targetDurationSec: 30,
    captionStyle: 'BOLD',
    captionPosition: 'center',
    transition: 'cut',
    musicMood: 'energetic',
    introEnabled: false,
    outroEnabled: true,
    structure: {
      sections: [
        { section: 'HOOK', weight: 10, note: 'Résultat final, plan serré' },
        { section: 'PROBLEM', weight: 15, note: 'Le défaut en un plan' },
        { section: 'SOLUTION', weight: 55, note: '3 à 4 étapes, plans de 2 s' },
        { section: 'RESULT', weight: 12, note: 'Avant / après' },
        { section: 'CTA', weight: 8, note: 'Abonnement' },
      ],
    },
  },
  {
    key: 'DIY_EDUCATIONAL',
    name: 'DIY Educational',
    description: 'Tutoriel pédagogique. Chaque étape est expliquée, le rythme laisse le temps de comprendre.',
    targetDurationSec: 60,
    captionStyle: 'MINIMAL',
    captionPosition: 'bottom',
    transition: 'fade',
    musicMood: 'calm',
    introEnabled: true,
    outroEnabled: true,
    structure: {
      sections: [
        { section: 'HOOK', weight: 8, note: 'La promesse pédagogique' },
        { section: 'PROBLEM', weight: 17, note: "Pourquoi la méthode courante échoue" },
        { section: 'SOLUTION', weight: 55, note: 'Étapes détaillées, une par plan' },
        { section: 'RESULT', weight: 12, note: 'Résultat commenté' },
        { section: 'CTA', weight: 8, note: 'Question à l’audience' },
      ],
    },
  },
  {
    key: 'DIY_BEFORE_AFTER',
    name: 'DIY Before / After',
    description: 'Transformation. Le contraste porte toute la vidéo.',
    targetDurationSec: 35,
    captionStyle: 'HIGHLIGHTED',
    captionPosition: 'center',
    transition: 'wipeleft',
    musicMood: 'uplifting',
    introEnabled: false,
    outroEnabled: true,
    structure: {
      sections: [
        { section: 'HOOK', weight: 12, note: 'Après, en premier' },
        { section: 'PROBLEM', weight: 18, note: 'Avant, sans commentaire' },
        { section: 'SOLUTION', weight: 48, note: 'Transformation en accéléré' },
        { section: 'RESULT', weight: 14, note: 'Split screen avant/après' },
        { section: 'CTA', weight: 8, note: 'Abonnement' },
      ],
    },
  },
  {
    key: 'DIY_TEST',
    name: 'DIY Test',
    description: "Test d'un produit ou d'une méthode, avec un verdict chiffré.",
    targetDurationSec: 45,
    captionStyle: 'BOLD',
    captionPosition: 'center',
    transition: 'fade',
    musicMood: 'curious',
    introEnabled: false,
    outroEnabled: true,
    structure: {
      sections: [
        { section: 'HOOK', weight: 10, note: 'La question testée' },
        { section: 'PROBLEM', weight: 15, note: 'Le protocole' },
        { section: 'SOLUTION', weight: 50, note: 'Le test en conditions réelles' },
        { section: 'RESULT', weight: 17, note: 'Verdict chiffré' },
        { section: 'CTA', weight: 8, note: 'Proposition de test suivant' },
      ],
    },
  },
  {
    key: 'DIY_TOP_5',
    name: 'DIY Top 5',
    description: 'Liste rythmée. Cinq éléments, un plan chacun, pas de transition molle.',
    targetDurationSec: 50,
    captionStyle: 'KARAOKE',
    captionPosition: 'center',
    transition: 'slideup',
    musicMood: 'energetic',
    introEnabled: false,
    outroEnabled: true,
    structure: {
      sections: [
        { section: 'HOOK', weight: 10, note: 'La promesse de la liste' },
        { section: 'SOLUTION', weight: 74, note: '5 éléments, ~7 s chacun' },
        { section: 'RESULT', weight: 8, note: 'Le meilleur, rappelé' },
        { section: 'CTA', weight: 8, note: 'Demande de commentaire' },
      ],
    },
  },
  {
    key: 'DIY_MYTH_BUSTING',
    name: 'DIY Myth Busting',
    description: 'Démontage d’une idée reçue. La tension porte le visionnage.',
    targetDurationSec: 45,
    captionStyle: 'CENTERED',
    captionPosition: 'center',
    transition: 'circleopen',
    musicMood: 'tense',
    introEnabled: false,
    outroEnabled: true,
    structure: {
      sections: [
        { section: 'HOOK', weight: 12, note: "L'idée reçue, énoncée telle quelle" },
        { section: 'PROBLEM', weight: 18, note: 'Pourquoi tout le monde y croit' },
        { section: 'SOLUTION', weight: 46, note: 'La démonstration' },
        { section: 'RESULT', weight: 16, note: 'Ce qu’il faut faire à la place' },
        { section: 'CTA', weight: 8, note: 'Abonnement' },
      ],
    },
  },
];

const IDEAS = [
  {
    title: 'Réparation express : un joint de silicone noirci en 4 minutes',
    hook: "Arrêtez de frotter — ce joint noir ne partira jamais au produit.",
    concept: "Retrait complet du joint moisi et repose propre. Le résultat est montré dès la première seconde.",
    summary: "Découpe du joint, nettoyage, application au pistolet, lissage au doigt savonné.",
    cta: 'Abonne-toi pour une réparation par jour.',
    category: 'DIY',
    subcategory: 'Réparation express',
    difficulty: 'BEGINNER' as const,
    estimatedCostCents: 1200,
    targetDurationSec: 40,
  },
  {
    title: 'Avant / après : une porte qui grince, réglée sans démontage',
    hook: "Trois secondes de grincement. Puis plus rien. Voilà comment.",
    concept: "Diagnostic du grincement puis traitement des paumelles, sans déposer la porte.",
    summary: "Identification de la paumelle fautive, nettoyage, lubrification adaptée, contrôle.",
    cta: 'Enregistre ça avant que ta porte ne recommence.',
    category: 'DIY',
    subcategory: 'Avant / après',
    difficulty: 'BEGINNER' as const,
    estimatedCostCents: 600,
    targetDurationSec: 30,
  },
  {
    title: 'Erreur courante : pourquoi votre rebouchage se fissure toujours',
    hook: "Ton enduit refissure ? Ce n'est pas le produit, c'est l'étape que tu sautes.",
    concept: "Démonstration de l'erreur de préparation, puis de la méthode qui tient dans le temps.",
    summary: "Ouverture de la fissure, dépoussiérage, application en deux passes, ponçage.",
    cta: 'Dis-moi en commentaire si tu faisais l’erreur.',
    category: 'DIY',
    subcategory: 'Erreur courante',
    difficulty: 'INTERMEDIATE' as const,
    estimatedCostCents: 1800,
    targetDurationSec: 50,
  },
];

const TRENDS = [
  { kind: 'TOPIC' as const, value: 'Rénovation locative à petit budget', weight: 90 },
  { kind: 'TOPIC' as const, value: 'Réparations que les artisans facturent trop cher', weight: 85 },
  { kind: 'KEYWORD' as const, value: 'astuce salle de bain', weight: 70 },
  { kind: 'KEYWORD' as const, value: 'relooking meuble', weight: 65 },
  { kind: 'HASHTAG' as const, value: 'bricolage', weight: 95 },
  { kind: 'HASHTAG' as const, value: 'diyfrance', weight: 60 },
  { kind: 'HASHTAG' as const, value: 'astucemaison', weight: 75 },
  { kind: 'FORMAT' as const, value: 'Avant / après en split screen vertical', weight: 80 },
  { kind: 'FORMAT' as const, value: 'Plan macro des mains, sans visage', weight: 72 },
  { kind: 'QUESTION' as const, value: 'Comment reboucher un trou sans que ça se voie ?', weight: 68 },
  { kind: 'QUESTION' as const, value: 'Quel silicone choisir pour une salle de bain ?', weight: 64 },
  { kind: 'SEASONAL' as const, value: "Préparation de la maison avant l'hiver", weight: 55, season: 'automne' },
];

async function main(): Promise<void> {
  const email = process.env['SEED_USER_EMAIL'] ?? 'demo@iavid.local';
  const password = process.env['SEED_USER_PASSWORD'] ?? 'iavid-demo-2024';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Créateur de démonstration',
      passwordHash: await bcrypt.hash(password, 10),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'diy-factory' },
    update: {},
    create: {
      name: 'DIY Factory',
      slug: 'diy-factory',
      locale: 'fr',
      niche: 'DIY / bricolage / maison / rénovation',
    },
  });

  await prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: {},
    create: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
  });

  for (const template of TEMPLATES) {
    await prisma.template.upsert({
      where: { workspaceId_key: { workspaceId: workspace.id, key: template.key } },
      update: { ...template, isBuiltIn: true },
      create: { ...template, workspaceId: workspace.id, isBuiltIn: true },
    });
  }

  for (const account of [
    { platform: 'TIKTOK' as const, handle: '@diyfactory.fr', requireMinDuration: true },
    { platform: 'YOUTUBE_SHORTS' as const, handle: 'DIY Factory FR', requireMinDuration: false },
    { platform: 'INSTAGRAM_REELS' as const, handle: '@diyfactory.fr', requireMinDuration: false },
  ]) {
    await prisma.socialAccount.upsert({
      where: {
        workspaceId_platform_handle: {
          workspaceId: workspace.id,
          platform: account.platform,
          handle: account.handle,
        },
      },
      update: {},
      create: {
        workspaceId: workspace.id,
        platform: account.platform,
        handle: account.handle,
        locale: 'fr',
        audience: 'Propriétaires et locataires, 25–45 ans, France',
        tone: 'Direct, concret, sans jargon',
        defaultHashtags: ['bricolage', 'diy', 'astucemaison', 'renovation'],
        requireMinDuration: account.requireMinDuration,
      },
    });
  }

  const existingIdeas = await prisma.idea.count({ where: { workspaceId: workspace.id } });
  if (existingIdeas === 0) {
    const { scoreIdea } = await import('../src/lib/scoring');
    for (const idea of IDEAS) {
      const scores = scoreIdea({
        title: idea.title,
        hook: idea.hook,
        concept: idea.concept,
        description: idea.summary,
        difficulty: idea.difficulty,
        estimatedCostCents: idea.estimatedCostCents,
        targetDurationSec: idea.targetDurationSec,
        affiliateProductCount: 2,
        maxSimilarity: 0,
      });
      await prisma.idea.create({
        data: { ...idea, workspaceId: workspace.id, description: idea.summary, ...scores },
      });
    }
  }

  const existingTrends = await prisma.trend.count({ where: { workspaceId: workspace.id } });
  if (existingTrends === 0) {
    await prisma.trend.createMany({
      data: TRENDS.map((t) => ({ ...t, workspaceId: workspace.id, source: 'seed' })),
    });
  }

  for (const name of ['Salle de bain', 'Cuisine', 'Peinture', 'Meuble', 'Extérieur']) {
    await prisma.tag.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name } },
      update: {},
      create: { workspaceId: workspace.id, name },
    });
  }

  console.log(`Seed terminé.
  Workspace : ${workspace.name} (${workspace.slug})
  Connexion : ${email}
  Mot de passe : ${password}
  Templates : ${TEMPLATES.length}
  Idées : ${await prisma.idea.count({ where: { workspaceId: workspace.id } })}
  Tendances : ${await prisma.trend.count({ where: { workspaceId: workspace.id } })}

  Aucune statistique n'est pré-remplie : le dashboard reflète vos données réelles.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
