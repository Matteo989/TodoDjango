# Étendre IAvid

Toutes les intégrations externes passent par une interface. Changer de fournisseur ne doit
jamais demander de réécrire l'application — c'est la raison d'être de
`src/server/providers/`.

**Règle absolue** : aucun `import` d'un SDK propriétaire n'existe en dehors de son
implémentation. Si vous devez importer un SDK ailleurs que dans
`providers/<famille>/<nom>.ts`, l'abstraction est mal placée.

---

## Ajouter un fournisseur IA

### 1. Implémenter l'interface

`src/server/providers/ai/types.ts` :

```ts
interface AIProvider {
  readonly id: string;
  readonly model: string;
  /** False pour un mock: l'UI l'affiche, rien n'est présenté comme branché à tort. */
  readonly isLive: boolean;

  generateText(prompt: string, options?: GenerateOptions): Promise<AIResult<string>>;

  generateStructuredOutput<T>(
    prompt: string,
    schemaName: string,
    schemaHint: string,
    options?: GenerateOptions,
  ): Promise<AIResult<T>>;

  /** Null si le fournisseur n'a pas d'embeddings: l'appelant bascule en lexical. */
  embed(texts: string[]): Promise<AIResult<number[][]> | null>;
}
```

Créez `src/server/providers/ai/anthropic.ts` (par exemple) :

```ts
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly isLive = true;
  readonly model: string;
  // …
}
```

**Trois obligations :**

- renseigner `usage.costCents` — c'est ce qui alimente la page AI Costs et le plafond
  mensuel ;
- lever une erreur explicite si la sortie n'est pas conforme au schéma, jamais renvoyer un
  JSON partiel silencieusement accepté ;
- retourner `isLive: false` si le provider ne fait pas réellement d'inférence.

### 2. L'enregistrer

`src/server/providers/registry.ts` :

```ts
export function aiProvider(): AIProvider {
  const e = env();
  if (e.AI_PROVIDER === 'anthropic' && e.ANTHROPIC_API_KEY) {
    return new AnthropicProvider({ apiKey: e.ANTHROPIC_API_KEY, model: e.ANTHROPIC_MODEL });
  }
  // …
  return new MockAIProvider();
}
```

Le repli sur le mock quand la clé manque est délibéré : l'application doit rester utilisable
sans configuration. Le repli est visible via `isLive` et signalé dans **Settings**.

### 3. Déclarer les variables

`src/lib/env.ts` — ajoutez la valeur à l'enum et les clés :

```ts
AI_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
ANTHROPIC_API_KEY: z.string().default(''),
ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
```

Puis dans `.env.example`, **sans valeur réelle**.

### 4. Vérifier

```bash
npm run test          # les tests passent toujours en mode mock
AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run dev
```

Aucun autre fichier ne change.

---

## Ajouter un fournisseur de voix

`src/server/providers/voice/types.ts` :

```ts
interface VoiceProvider {
  readonly id: string;
  readonly isLive: boolean;
  listVoices(language?: string): Promise<VoiceOption[]>;
  generateVoice(input: VoiceInput): Promise<AudioAsset>;
}
```

**La durée retournée doit être la durée réelle du fichier**, mesurée par `ffprobe`, jamais
une estimation : le montage cale les scènes dessus. Utilisez l'utilitaire `measureDuration`
de `providers/voice/elevenlabs.ts`.

Implémentations fournies : ElevenLabs, OpenAI TTS, et un mock qui synthétise un WAV
silencieux à la bonne durée — pour que le pipeline reste exécutable sans clé.

---

## Ajouter un fournisseur de génération vidéo

`src/server/providers/video/types.ts` :

```ts
interface VideoProvider {
  readonly id: string;
  readonly isLive: boolean;
  generateVideo(input: VideoPrompt): Promise<VideoAsset>;
}
```

Runway, Kling et Veo sont des APIs **asynchrones** : elles renvoient un identifiant de tâche
à interroger. Effectuez cette attente **à l'intérieur** de `generateVideo` — le worker
BullMQ tourne déjà dans un process séparé, une attente longue n'y bloque rien.

Le plan généré devient automatiquement un `Asset` de source `AI_GENERATED` avec son
`RightsRecord`. Vérifiez que les conditions de votre fournisseur autorisent l'usage
commercial avant de passer l'asset en 🟢.

---

## Ajouter une plateforme de publication

### 1. Le modèle

`prisma/schema.prisma` — étendez l'enum, puis migrez :

```prisma
enum Platform {
  TIKTOK
  YOUTUBE_SHORTS
  INSTAGRAM_REELS
  SNAPCHAT_SPOTLIGHT
  MA_PLATEFORME
}
```

```bash
npm run prisma:migrate
```

### 2. Le profil d'encodage

`src/server/services/versions.ts` — ajoutez une entrée à `PLATFORM_PROFILES` avec ses
limites réelles (durée, longueur du titre, nombre de hashtags, bitrate) et une note qui
explique ses contraintes particulières.

### 3. Le provider

`src/server/providers/publishing/types.ts` :

```ts
interface PublishingProvider {
  readonly id: string;
  readonly isLive: boolean;
  supports(platform: Platform): boolean;
  publish(input: PublishInput): Promise<PublishResult>;
}
```

**Si l'API officielle ne couvre pas l'opération, renvoyez `MANUAL_REQUIRED` avec un
`manualReason` explicite.** Ne contournez jamais la plateforme :

```ts
if (!input.accountToken) {
  return {
    outcome: 'MANUAL_REQUIRED',
    manualReason: "Aucun jeton OAuth. Connectez le compte dans Settings.",
  };
}
```

L'utilisateur obtient alors le fichier et les métadonnées à copier — ce qui est le
comportement **attendu**, pas un repli dégradé.

---

## Ajouter une source de tendances

`src/server/providers/trends/types.ts` :

```ts
interface TrendProvider {
  readonly id: string;
  readonly isLive: boolean;
  /** Affiché dans l'UI à côté des résultats: d'où viennent ces données ? */
  readonly sourceDescription: string;
  fetchTrends(params: { niche: string; locale: string; limit: number }): Promise<TrendItem[]>;
}
```

**Contrat explicite** : une implémentation ne doit lire que des **APIs officielles** ou des
jeux de données que l'utilisateur a le droit d'exploiter. Sources acceptables : YouTube Data
API v3, un export Google Trends téléchargé par l'utilisateur, une base sectorielle sous
licence, un fichier CSV interne.

Le scraping de plateformes est hors périmètre — voir [`COMPLIANCE.md`](COMPLIANCE.md).

---

## Ajouter un template de montage

Un template est une ligne en base, pas du code. Voir `prisma/seed.ts` :

```ts
{
  key: 'DIY_CHECKLIST',
  name: 'DIY Checklist',
  description: "Liste de vérification avant de se lancer.",
  targetDurationSec: 40,
  captionStyle: 'HIGHLIGHTED',
  captionPosition: 'center',
  transition: 'slideup',
  musicMood: 'calm',
  introEnabled: false,
  outroEnabled: true,
  structure: {
    sections: [
      { section: 'HOOK',     weight: 10, note: 'La promesse' },
      { section: 'SOLUTION', weight: 74, note: '5 points, ~6 s chacun' },
      { section: 'RESULT',   weight: 8 },
      { section: 'CTA',      weight: 8 },
    ],
  },
}
```

Les `weight` sont **relatifs** : les durées en découlent au prorata de
`targetDurationSec`. Vous n'avez pas à ce qu'ils fassent 100.

---

## Ajouter un style de sous-titres animés

`src/server/render/captions.ts` — ajoutez une valeur à l'enum `CaptionStyle` (Prisma), puis
une entrée à `STYLE_SPECS` :

```ts
PULSE: {
  bold: 1,
  outline: 4,
  shadow: 1,
  borderStyle: 1,
  // Balises d'override ASS appliquées à chaque réplique.
  effect: () => '{\\fscx90\\fscy90\\t(0,80,\\fscx105\\fscy105)\\t(80,200,\\fscx100\\fscy100)}',
},
```

Le style `KARAOKE` montre comment exploiter les timings mot à mot (`cue.words`) avec les
balises `\k`.

---

## Ajouter une étape au pipeline

1. **Le type de job** : ajoutez une valeur à l'enum `JobType` dans `prisma/schema.prisma`,
   puis migrez.
2. **La priorité** : ajoutez-la à `PRIORITY` dans `src/server/queue/index.ts`.
3. **Le service** : créez `src/server/services/<étape>.ts`. Toute la logique métier vit là,
   jamais dans la route.
4. **Le handler** : ajoutez une entrée à `HANDLERS` dans `src/worker/handlers/index.ts`.
   Retournez un `JobCompletion` avec `provider`, `costCents` et `result`.
5. **La route** : `src/app/api/videos/[id]/<étape>/route.ts`, calquée sur les existantes —
   elle authentifie, valide, met en file, renvoie `202` avec le `jobId`.
6. **L'UI** : ajoutez un bouton dans `video-studio.tsx` et une étape au `PipelineStepper`.

Une étape ainsi ajoutée est automatiquement **relançable indépendamment**, suivie en
progression, et journalisée avec son coût.

---

## Où ne PAS mettre de logique

| Endroit | Ce qui doit s'y trouver |
|---|---|
| `src/app/api/**/route.ts` | Authentification, validation Zod, appel d'un service, sérialisation. **Rien d'autre.** |
| `src/server/services/**` | Toute la logique métier. Appelable identiquement par HTTP et par le worker. |
| `src/components/**` | Affichage et interactions. Aucune règle métier — une règle qui n'existe que dans un composant est contournable. |
| `src/server/render/filtergraph.ts` | Fonctions **pures**. Aucun accès disque, aucun process : c'est ce qui rend le montage testable sans exécuter FFmpeg. |
