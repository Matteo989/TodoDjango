# IAvid — Architecture technique

> Réponse aux 10 points de la « Première tâche » de la spécification.
> Ce document est le contrat d'architecture ; le code du dépôt en est l'implémentation.

---

## 1. Analyse de la spécification

### Ce que le produit est

Une **usine à contenu vertical** self-hosted : une idée entre, une vidéo 1080×1920 prête à
publier sort, avec ses métadonnées par plateforme. La valeur n'est pas dans un modèle IA
particulier — elle est dans le **pipeline traçable** qui relie 15 étapes et dans la
**gouvernance des droits** qui rend le résultat monétisable.

### Les trois invariants non négociables

| Invariant | Conséquence architecturale |
|---|---|
| **Aucun repost.** L'app ne télécharge pas de vidéos de plateformes pour les republier. | Pas de module d'ingestion par URL de plateforme. Les assets viennent d'un upload, d'une génération IA, ou d'une bibliothèque sous licence déclarée. Un garde-fou applicatif (`src/lib/compliance/guards.ts`) refuse les URL de plateformes sociales à l'import. |
| **Les droits gouvernent l'export.** | `RightsRecord` est une entité de premier rang, pas un champ. Le rendu commercial est **bloqué** (erreur, pas warning) si un asset rouge est dans le storyboard. |
| **Aucune fonctionnalité fictive.** | Chaque provider a soit une implémentation réelle, soit un mock explicitement étiqueté `mock` dans l'UI et dans `AIJob.provider`. Rien n'est présenté comme branché s'il ne l'est pas. |

### Tension principale identifiée

La spec demande **40 domaines fonctionnels**. Les livrer tous à moitié produirait une démo
non exécutable. Le découpage retenu (§10) livre **le chemin critique de bout en bout**
(Idée → Script → Assets → Voix → Storyboard → Montage → Sous-titres → QC → Export MP4)
en état réellement fonctionnel, et pose les **abstractions + le schéma complet** pour les
domaines des phases 2 et 3 — de sorte que les ajouter ne demande pas de refonte.

### Ambiguïtés levées par décision (pas de blocage)

| Point | Décision | Raison |
|---|---|---|
| « Next.js API routes **ou** backend propre » | Route Handlers Next.js **fins**, toute la logique dans `src/server/services/*` | Un service pur est appelable identiquement par une route HTTP et par un worker BullMQ. Zéro duplication. |
| Auth « simple » | Session JWT signée (`jose`) en cookie httpOnly + `bcryptjs` | Pas de dépendance à un provider OAuth externe pour se connecter à sa propre machine. |
| Transcription pour les sous-titres | Whisper si `OPENAI_API_KEY`, sinon **alignement déterministe** sur les durées de scènes | Les deux sont honnêtes ; le mode dégradé est étiqueté `estimated` dans l'UI, pas maquillé en transcription. |
| Anti-duplication | Embeddings si clé OpenAI, sinon **cosinus sur vecteurs de tokens locaux** | Le mode local est réel et mesurable, pas un placeholder. |
| « ≥ 60 s pour TikTok Creator Rewards » | Règle QC **avertissante**, activable par compte social | Le seuil est une règle de programme, pas une contrainte technique — il change. Il vit en configuration. |

---

## 2. Architecture technique proposée

```
┌──────────────────────────────────────────────────────────────────────┐
│  Navigateur — Next.js App Router (RSC) + Tailwind + shadcn-style UI  │
└───────────────┬──────────────────────────────────────────────────────┘
                │ fetch JSON  /api/*
┌───────────────▼──────────────────────────────────────────────────────┐
│  Route Handlers  — fins : auth, validation Zod, sérialisation        │
│  src/app/api/**/route.ts                                             │
└───────────────┬──────────────────────────────────────────────────────┘
                │ appels de fonctions typées
┌───────────────▼──────────────────────────────────────────────────────┐
│  COUCHE SERVICES  src/server/services/*                              │
│  ideas · scripts · assets · rights · voice · storyboard · render     │
│  captions · quality · duplication · costs                            │
│  ─ seul endroit qui contient des règles métier                       │
│  ─ appelée à l'identique par HTTP et par les workers                 │
└──┬────────────┬─────────────┬──────────────┬─────────────────────────┘
   │            │             │              │
┌──▼─────┐  ┌───▼────────┐ ┌──▼──────────┐ ┌─▼──────────────────────┐
│ Prisma │  │ Providers  │ │  Storage    │ │  BullMQ (Redis)        │
│ Postgres│ │ AI/Voice/  │ │ Local ⇄ S3  │ │  9 files de jobs       │
│        │  │ Video/Pub/ │ │  (driver)   │ │  worker séparé         │
│        │  │ Trend      │ │             │ │                        │
└────────┘  └────────────┘ └─────────────┘ └─┬──────────────────────┘
                                             │
                                  ┌──────────▼───────────┐
                                  │  FFmpeg / FFprobe    │
                                  │  moteur de montage   │
                                  └──────────────────────┘
```

### Décisions structurantes

**1. Les Route Handlers ne contiennent aucune logique.** Ils authentifient, valident avec
Zod, appellent un service, sérialisent. Cela rend le worker BullMQ capable d'exécuter
exactement le même code que l'API sans passer par HTTP — indispensable puisque
`RENDER_VIDEO` et `GENERATE_SCRIPT` sont déclenchés des deux côtés.

**2. Les providers sont chargés par une factory lisant l'environnement**
(`src/server/providers/registry.ts`). Changer de fournisseur IA = changer une variable
d'environnement. Aucun `import { OpenAI }` n'existe hors de `providers/ai/openai.ts`.
Chaque provider expose `id` et `costPer1kTokens` afin que le suivi de coût (§34-35) soit
alimenté par le provider lui-même et non par une table de correspondance codée en dur.

**3. Le mock n'est pas un bouchon vide.** `MockAIProvider` produit une sortie structurée
valide et déterministe (seed dérivée du prompt) ; `MockVoiceProvider` synthétise un WAV
réel via FFmpeg à la bonne durée. Conséquence : **le pipeline complet tourne et rend un
MP4 sans une seule clé d'API**. C'est ce qui rend « `docker compose up` puis ça marche »
vrai plutôt qu'aspirationnel.

**4. Le rendu est un graphe de filtres FFmpeg construit programmatiquement**
(`src/server/render/filtergraph.ts`), pas une chaîne concaténée. Chaque scène produit un
segment normalisé (1080×1920, 30 fps, SAR 1:1), les segments sont concaténés, puis
voix + musique sont mixées et les sous-titres ASS brûlés. Construire le graphe comme une
structure de données le rend testable sans exécuter FFmpeg.

**5. Les droits sont vérifiés au moment du rendu, pas à l'affichage.** `assertRenderable()`
est appelé par le service de rendu lui-même. Un contournement de l'UI ne contourne pas la
règle.

### Modèle de concurrence

| Charge | Où | Pourquoi |
|---|---|---|
| Lecture/écriture DB, génération de texte courte | Route Handler | < 2 s, réponse directe |
| Génération d'idées/scripts, voix, transcription | Worker BullMQ | 5–60 s, appel réseau externe |
| Rendu FFmpeg, génération vidéo IA | Worker BullMQ, concurrence 1 | CPU-bound ; paralléliser dégraderait tout |

Le worker (`src/worker/index.ts`) est un **process séparé** (`npm run worker`,
service `worker` dans Docker Compose). L'app web ne rend jamais de vidéo dans son propre
process : un rendu de 3 minutes bloquerait le serveur Next.

---

## 3. Arborescence complète du projet

```
IAvid/
├── docker-compose.yml            app · worker · postgres · redis
├── Dockerfile                    build Next standalone + ffmpeg
├── .env.example                  toutes les clés, aucune valeur réelle
├── README.md
├── package.json
├── tsconfig.json                 strict: true, noUncheckedIndexedAccess
├── vitest.config.ts
├── tailwind.config.ts
├── prisma/
│   ├── schema.prisma             22 modèles, 14 enums
│   ├── migrations/
│   └── seed.ts                   user + workspace + templates + musiques + idées
├── docs/
│   ├── ARCHITECTURE.md           (ce fichier)
│   ├── COMPLIANCE.md             ce que l'app refuse de faire, et pourquoi
│   └── PROVIDERS.md              ajouter un provider IA / plateforme / template
├── storage/                      (dev) uploads, renders, cache — gitignored
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── (auth)/login · register
│   │   ├── (app)/
│   │   │   ├── layout.tsx        shell + navigation
│   │   │   ├── dashboard/
│   │   │   ├── ideas/            liste · [id] · generate
│   │   │   ├── research/         tendances
│   │   │   ├── scripts/[id]/     éditeur + variantes + fact-check
│   │   │   ├── assets/           bibliothèque + upload
│   │   │   ├── videos/           liste · [id] pipeline · [id]/storyboard
│   │   │   ├── create/           workflow guidé 6 étapes
│   │   │   ├── templates/
│   │   │   ├── calendar/
│   │   │   ├── analytics/
│   │   │   ├── products/
│   │   │   ├── rights/
│   │   │   ├── costs/
│   │   │   └── settings/
│   │   └── api/
│   │       ├── auth/{login,register,logout}
│   │       ├── ideas/…  scripts/…  assets/…  videos/…
│   │       ├── videos/[id]/{storyboard,render,quality,export}
│   │       ├── jobs/[id]            progression
│   │       └── media/[...path]      service de fichiers du storage local
│   ├── components/
│   │   ├── ui/                   button · card · input · select · dialog · badge…
│   │   ├── charts/               recharts, wrappers typés
│   │   └── domain/               PipelineStepper · RightsBadge · SceneEditor…
│   ├── server/
│   │   ├── auth/                 session jose · mots de passe · guards
│   │   ├── db.ts                 singleton Prisma
│   │   ├── services/             ← toute la logique métier
│   │   ├── providers/
│   │   │   ├── ai/               types · openai · mock · registry
│   │   │   ├── voice/            types · elevenlabs · openai · mock
│   │   │   ├── video/            types · mock (+ stubs documentés)
│   │   │   ├── publishing/       types · manual · youtube (stub OAuth)
│   │   │   └── trends/           types · manual (import CSV/JSON)
│   │   ├── render/               ffmpeg · filtergraph · captions · probe
│   │   ├── storage/              types · local · s3 · index
│   │   └── queue/                connection · queues · enqueue
│   ├── worker/                   index.ts + handlers/*.ts
│   └── lib/                      zod schemas · enums · scoring · similarity · utils
└── tests/
    ├── unit/      scoring · similarity · filtergraph · captions · costs
    ├── rights/    validation des droits (bloquant)
    ├── api/       routes авторisées / non autorisées
    └── pipeline/  idée → … → MP4 (avec providers mock)
```

---

## 4. Dépendances npm

### Production

| Paquet | Rôle | Pourquoi celui-ci |
|---|---|---|
| `next` `react` `react-dom` | Framework | RSC = moins de JS client pour des pages majoritairement en lecture |
| `@prisma/client` `prisma` | ORM + migrations | Migrations versionnées, typage généré depuis le schéma |
| `zod` | Validation | Une source de vérité partagée entre route, service et worker |
| `bullmq` `ioredis` | Jobs | Progression, reprises, priorités — nécessaire pour §33 |
| `jose` `bcryptjs` | Auth | JWT signé en cookie httpOnly ; pas de dépendance externe |
| `tailwindcss` `class-variance-authority` `clsx` `tailwind-merge` | Style | Base shadcn/ui |
| `@radix-ui/react-*` | Primitives accessibles | dialog · select · tabs · dropdown · tooltip · progress |
| `lucide-react` | Icônes | |
| `recharts` | Graphiques §2 | |
| `date-fns` | Dates, calendrier | |
| `@aws-sdk/client-s3` `@aws-sdk/s3-request-presigner` | Storage prod | |
| `fluent-ffmpeg` *(optionnel)* | — **écarté** | On invoque `ffmpeg` via `execFile` : le graphe de filtres complexe est plus lisible et plus débogable en argv brut qu'à travers un wrapper |

### Développement

`typescript` · `vitest` · `@vitest/coverage-v8` · `tsx` (worker + seed) · `eslint`
`eslint-config-next` · `prettier` · `@types/*` · `autoprefixer` · `postcss`

### Binaires système (hors npm)

`ffmpeg` et `ffprobe` ≥ 6.0 — installés dans l'image Docker. En développement hors
Docker : `apt install ffmpeg` / `brew install ffmpeg`. L'app **détecte leur absence au
démarrage** et le signale dans Settings plutôt que d'échouer au premier rendu.

---

## 5. APIs externes nécessaires

| API | Utilisée pour | Statut sans clé | Obligatoire ? |
|---|---|---|---|
| OpenAI (ou compatible) | Idées, scripts, storyboard, fact-check, analyse, embeddings | `MockAIProvider` déterministe | Non |
| OpenAI Whisper | Transcription → sous-titres alignés | Alignement estimé sur durées de scènes | Non |
| ElevenLabs | Voix off de qualité production | `MockVoiceProvider` (WAV synthétisé, durée juste) | Non |
| OpenAI TTS | Voix off alternative | idem | Non |
| Runway / Kling / Veo | Génération de plans vidéo IA | `MockVideoProvider` (plan de couleur + texte) | Non |
| YouTube Data API v3 | Publication + analytics | « Publication manuelle requise » | Non |
| TikTok Content Posting API | Publication | idem | Non |
| Meta Graph API | Instagram Reels | idem | Non |
| Snapchat | — | **Aucune API publique de publication** → manuel définitif | — |
| S3 / R2 / MinIO | Stockage production | Disque local | Non en dev |

**Rien n'est requis pour que l'application démarre et rende un MP4.** C'est le critère
d'acceptation de l'exigence « réellement exécutable localement ».

---

## 6. Fonctionnalités nécessitant des credentials

| Fonctionnalité | Credentials | Sans elles |
|---|---|---|
| Génération IA réelle | `OPENAI_API_KEY` | Mock étiqueté `mock` dans l'UI et en base |
| Voix ElevenLabs | `ELEVENLABS_API_KEY` | Mock |
| Sous-titres transcrits | `OPENAI_API_KEY` | Timings estimés, étiquetés `estimated` |
| Vidéo IA | clé du fournisseur | Mock |
| Publication YouTube | `YOUTUBE_CLIENT_ID/SECRET` + OAuth utilisateur | Export manuel |
| Publication TikTok | `TIKTOK_CLIENT_ID/SECRET` + app approuvée | Export manuel |
| Instagram Reels | `META_CLIENT_ID/SECRET` + compte Business lié | Export manuel |
| Stockage S3 | `S3_*` | Disque local |
| Analytics importés | OAuth de la plateforme | Saisie manuelle / import CSV |

Aucun secret n'est écrit dans le dépôt. `.env.example` ne contient que des noms de clés.
Les secrets ne sont jamais renvoyés par l'API : Settings expose `configured: boolean`.

---

## 7. Risques techniques

| # | Risque | Gravité | Mitigation retenue |
|---|---|---|---|
| R1 | **FFmpeg est la dépendance la plus fragile** : version absente, filtre indisponible, échec silencieux sur une entrée exotique | Élevée | Vérification `ffmpeg -version` au démarrage, surfacée dans Settings ; argv construit programmatiquement et loggé ; `stderr` conservé sur `AIJob.error` ; normalisation systématique de chaque entrée avant concaténation (le mélange de SAR/fps est la cause n°1 d'échec de `concat`) |
| R2 | **Coût IA non maîtrisé** : une boucle d'apprentissage qui régénère peut brûler un budget | Élevée | Chaque appel passe par `AIJob` avec coût estimé ; plafond mensuel configurable par workspace ; page AI Costs ; refus si plafond dépassé |
| R3 | **Dérive des API de publication** : TikTok/Meta changent leurs conditions et leurs scopes | Élevée | Abstraction `PublishingProvider` ; le mode manuel est le **défaut**, pas la solution de repli. Aucune fonctionnalité critique n'en dépend |
| R4 | **Durée de rendu** : une vidéo de 60 s avec captures ASS peut prendre plusieurs minutes | Moyenne | Worker séparé, concurrence 1, progression via `AIJob.progress` parsée depuis la sortie FFmpeg ; preset `veryfast` en brouillon, `medium` en export final |
| R5 | **Hallucination sur des sujets dangereux** (électricité, gaz, porteur) | Élevée — sécurité réelle | Détection lexicale déterministe **avant** l'IA (`SAFETY_TOPICS`), injection d'un avertissement obligatoire, `SAFETY_SCORE` plafonné, QC exige une `SAFETY_WARNING` sur ces sujets. La sécurité ne dépend pas du bon vouloir du modèle |
| R6 | **Faux négatif de l'anti-duplication** en mode local (sans embeddings) | Moyenne | Le mode est étiqueté ; le seuil est configurable ; le score est affiché avec sa méthode (`embedding` \| `lexical`) |
| R7 | **Stockage local qui grossit** : chaque rendu = 20–60 Mo | Moyenne | Versions horodatées, purge des brouillons > N jours, taille par workspace affichée |
| R8 | **Un utilisateur importe un asset dont il n'a pas les droits** | Élevée — juridique | Impossible de marquer `commercialUse=true` sans champs licence + preuve ; défaut `UNKNOWN` = 🟠 ; export commercial bloqué |
| R9 | Prisma + BullMQ dans le même process en dev | Faible | Worker séparé même en dev (`npm run dev` lance les deux via `concurrently`) |

---

## 8. Points qui doivent rester manuels

Non par manque de temps, mais **par conception** :

1. **Publication Snapchat Spotlight** — pas d'API publique de publication. Export + upload manuel, définitivement.
2. **Publication TikTok tant que l'app n'est pas approuvée** — l'API Content Posting exige une revue. Pas de contournement.
3. **Saisie des liens d'affiliation** — l'app ne fabrique jamais un lien affilié. L'utilisateur colle celui que son programme lui a donné ; l'app n'ajoute que les paramètres UTM.
4. **Validation des droits d'un asset** — décision humaine avec preuve. Aucune heuristique ne remplace un contrat de licence.
5. **Validation finale du fact-check** — l'IA propose un classement des affirmations, l'humain valide. `VERIFIED` n'est jamais posé par l'IA seule.
6. **Import des analytics** tant que l'OAuth n'est pas configuré — saisie ou CSV.
7. **Approbation avant publication** d'une vidéo portant un `SAFETY_WARNING` — case à cocher explicite.
8. **Choix de la variante de script** — l'IA en propose 5, l'humain choisit. Pas de sélection automatique.

---

## 9. Schéma Prisma proposé

**22 modèles, 14 enums.** Conventions appliquées partout : `id` cuid · `createdAt` /
`updatedAt` · `deletedAt` (soft delete) sur les entités que l'utilisateur archive ·
`@@index` sur toutes les clés étrangères et tous les champs de filtre · cascade depuis
`Workspace`.

```
User ──< WorkspaceMember >── Workspace
                                 │
   ┌─────────────────────────────┼──────────────────────────────┐
   │            │        │       │        │        │      │     │
SocialAccount  Idea    Asset   Music  Template  Product Trend  Tag
                │        │                          │
                │        └──< RightsRecord          └──< AffiliateLink
                │        │
             Script      │
                │        │
              Scene >────┘  (Scene.assetId → Asset)
                │
              Video ──< VideoVersion ──< Publication ──< Analytics
                │
             VoiceTrack · CaptionTrack · QualityReport · AIJob
```

Points de conception notables :

- **`Scene` référence `Asset`** plutôt que d'embarquer un chemin de fichier : c'est ce qui
  permet à `assertRenderable(video)` de remonter tous les assets d'un storyboard et de
  vérifier leurs droits en une requête.
- **`RightsRecord` est séparé d'`Asset`** : un même fichier peut avoir une licence qui
  expire, un territoire, des restrictions. Un champ booléen ne suffirait pas et ne
  laisserait pas de trace d'audit.
- **`VideoVersion` porte la plateforme** : une master, N versions. Titre, description et
  hashtags vivent sur la version, pas sur la vidéo.
- **`AIJob` est la table de journalisation ET de suivi de job** : provider, modèle,
  version de prompt, durée, coût, résultat, erreur, progression. Une seule table sert §33
  (progression) et §34 (logs et coûts) — les dédoubler créerait une divergence.
- **`Scene.durationMs` en entiers** : le montage FFmpeg raisonne en millisecondes ; les
  flottants introduisent des dérives cumulées sur 15 scènes.

Le schéma complet et commenté est dans `prisma/schema.prisma`.

---

## 10. Plan d'implémentation par étapes

### Phase 1 — MVP (le chemin critique, réellement exécutable)

| Étape | Contenu | Critère d'acceptation |
|---|---|---|
| 1.1 | Socle : Next + TS strict + Tailwind + UI + Docker + Prisma + migration + seed | `docker compose up` → app accessible, DB migrée et peuplée |
| 1.2 | Auth, Workspace, shell de navigation | Inscription, connexion, isolation par workspace vérifiée par test |
| 1.3 | Abstractions providers + registry + mocks | `npm run test` vert sans aucune clé d'API |
| 1.4 | Ideas : CRUD, filtres, tri, duplication, archivage | Cycle complet dans l'UI |
| 1.5 | Génération d'idées IA + 5 scores | Le job renvoie N idées scorées, tracées dans `AIJob` |
| 1.6 | Assets + upload + thumbnail + métadonnées + RightsRecord | Un asset 🔴 est visuellement bloquant |
| 1.7 | Script Generator, 5 variantes, sections HOOK→CTA | L'utilisateur choisit une variante, elle devient le script actif |
| 1.8 | Fact-check + détection déterministe des sujets dangereux | Un script « prise électrique » porte un `SAFETY_WARNING` obligatoire |
| 1.9 | Storyboard : scènes générées, éditables, réordonnables | Durées cohérentes avec la durée cible |
| 1.10 | Voix : provider, génération, MP3/WAV, métadonnées | Un fichier audio réel est produit, même en mock |
| 1.11 | Sous-titres SRT/VTT/ASS + 5 styles animés | Les 3 formats sont téléchargeables |
| 1.12 | **Moteur FFmpeg** : 9:16, concat, voix, musique, captions brûlées, intro/outro, watermark | **MP4 1080×1920 lisible** |
| 1.13 | Templates (6 presets) | Un template pré-remplit structure, durées, style de captions |
| 1.14 | Quality Control + score /100 + rapport | Un asset interdit fait échouer l'export commercial |
| 1.15 | Anti-duplication | Similarité affichée avec sa méthode |
| 1.16 | Dashboard + coûts de production | Chiffres réels issus de la DB, aucun chiffre inventé |
| 1.17 | Create Video : workflow guidé 6 étapes | Idée → Export en une traversée |

**Sortie de phase 1 :** une personne installe, ne configure aucune clé, et obtient un MP4
vertical sous-titré. Avec une clé OpenAI, le même parcours produit du contenu réellement
généré.

### Phase 2
Calendrier éditorial · `PublishingProvider` + mode manuel · OAuth YouTube et publication ·
TikTok si approuvé · saisie/import d'analytics · `CONTENT_SCORE` · versions multi-plateformes.

### Phase 3
Instagram · Snapchat (manuel) · affiliation + UTM + EPC · **boucle d'apprentissage**
(analyse des performances → Next Best Ideas) · multi-workspace et multi-langue ·
`TrendProvider` avec sources officielles.

### Ordre imposé par les dépendances

```
socle → auth → providers → ideas → scripts → assets/rights → storyboard
      → voice → captions → RENDER → quality → create-flow
```

Le rendu est délibérément placé tôt : c'est le risque technique le plus élevé (R1) et
l'étape qui valide que toutes les précédentes produisent des données réellement
exploitables. Découvrir un problème de format à l'étape 1.12 coûte peu ; le découvrir en
phase 3 coûterait une refonte du modèle de scènes.
