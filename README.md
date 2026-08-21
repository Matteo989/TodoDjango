# IAvid

**Usine à contenu vertical self-hosted** — de l'idée au MP4 1080×1920 prêt à publier sur
TikTok, YouTube Shorts, Instagram Reels et Snapchat Spotlight.

Niche initiale : **bricolage / DIY / maison / rénovation**.

---

## Ce que fait cette application

```
IDÉE → RECHERCHE → SCRIPT → FACT CHECK → ASSETS → STORYBOARD → VOIX
     → MONTAGE → SOUS-TITRES → CONTRÔLE QUALITÉ → EXPORT MULTI-PLATEFORME
```

Chaque étape est **relançable indépendamment**, exécutée dans un worker séparé, et
journalisée avec son fournisseur, son modèle, sa durée et son coût.

## Ce qu'elle ne fait pas — par conception

IAvid est une usine à contenu **original**, pas une ferme de repost. Les workflows suivants
ne sont pas implémentés et ne le seront pas :

- télécharger des vidéos de plateformes pour les republier ;
- supprimer un filigrane pour masquer l'origine d'un contenu ;
- contourner les protections d'une plateforme ;
- publier automatiquement sans API officielle ;
- utiliser un asset dont les droits commerciaux sont inconnus dans un export monétisable.

Ces refus sont appliqués **côté serveur**, pas seulement dans l'interface — voir
[`docs/COMPLIANCE.md`](docs/COMPLIANCE.md).

---

## Démarrage rapide

### Avec Docker (recommandé)

```bash
cp .env.example .env
# Générez un secret de session :
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$(openssl rand -base64 48)\"|" .env

docker compose up --build
```

L'application applique ses migrations, peuple la base et démarre sur
**http://localhost:3000**.

Compte de démonstration créé par le seed :

```
demo@iavid.local  /  iavid-demo-2024
```

> **Aucune clé d'API n'est requise.** Sans fournisseur configuré, l'application bascule sur
> des providers simulés — clairement étiquetés dans l'interface — et **produit tout de même
> un MP4 1080×1920 réel** : le montage FFmpeg, les sous-titres et le contrôle qualité, eux,
> ne sont jamais simulés.

### En développement local

Prérequis : **Node 20+**, **PostgreSQL 16**, **Redis 7**, **FFmpeg 6+**.

```bash
# FFmpeg
sudo apt install ffmpeg fonts-dejavu-core   # Debian / Ubuntu
brew install ffmpeg                          # macOS

# Base et cache (ou via docker compose up postgres redis)
createdb iavid

cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed

npm run dev      # démarre l'app (port 3000) ET le worker
```

`npm run dev` lance les deux processus. Pour les séparer :

```bash
npm run dev:web     # serveur Next.js seul
npm run worker:dev  # worker BullMQ seul
```

---

## Variables d'environnement

Toutes les clés sont listées dans [`.env.example`](.env.example). **Aucun secret n'est
jamais écrit dans le dépôt**, et l'API n'expose que l'état de configuration
(`configured: true|false`), jamais les valeurs.

### Indispensables

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL |
| `REDIS_URL` | File de jobs BullMQ |
| `AUTH_SECRET` | Signature des sessions — `openssl rand -base64 48` |

### Fournisseurs — tous optionnels

| Variable | Effet si absente |
|---|---|
| `AI_PROVIDER` · `OPENAI_API_KEY` | Idées, scripts et storyboards simulés (déterministes, étiquetés) |
| `VOICE_PROVIDER` · `ELEVENLABS_API_KEY` | Voix silencieuse à la durée correcte, pour que le montage reste exploitable |
| `VIDEO_PROVIDER` · `RUNWAY_API_KEY` / `KLING_API_KEY` | Plans rendus en ardoises lisibles portant leur description |
| `PUBLISHING_PROVIDER` · `YOUTUBE_*` / `TIKTOK_*` / `META_*` | « Publication manuelle requise » : fichier + métadonnées à copier |
| `S3_*` | Stockage sur disque local |

### Réglages

| Variable | Défaut | Rôle |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` ou `s3` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Chemins des binaires |
| `DUPLICATION_THRESHOLD` | `80` | Seuil de similarité au-delà duquel un script est signalé |

---

## Migrations et seed

```bash
npm run prisma:migrate      # créer une migration (développement)
npm run prisma:deploy       # appliquer les migrations (production)
npm run db:seed             # peupler : compte, workspace, 6 templates, idées, tendances
npm run db:reset            # réinitialiser complètement (destructif)
```

Le seed **n'insère aucune statistique fictive** : le dashboard ne montre que vos données
réelles.

---

## Tests

```bash
npm run test
```

| Suite | Couvre |
|---|---|
| `tests/unit/` | Scoring, détection des sujets à risque, similarité, graphe FFmpeg, sous-titres |
| `tests/rights/` | Validation des droits et blocage effectif de l'export |
| `tests/api/` | Sessions, isolation entre workspaces, storyboard, contrôle qualité |
| `tests/pipeline/` | Parcours complet idée → MP4, avec FFmpeg réel |

Les suites `rights`, `api` et `pipeline` ont besoin d'une base PostgreSQL accessible via
`DATABASE_URL` ; elles créent et détruisent leur propre workspace jetable.

Autres commandes : `npm run typecheck`, `npm run lint`, `npm run build`.

---

## Production

```bash
npm run build
npx prisma migrate deploy
npm start          # serveur Next.js
npm run worker:dev # worker (process séparé, obligatoire)
```

Le worker **doit** tourner : sans lui, les jobs restent en file et rien n'est produit.

Points d'attention :

- passer `STORAGE_DRIVER=s3` et renseigner les `S3_*` ;
- `AUTH_SECRET` doit être un secret réel, différent de celui de développement ;
- FFmpeg et une police TrueType doivent être présents sur la machine du worker ;
- définir un plafond IA mensuel dans **Settings** pour borner la dépense.

---

## Étendre l'application

Les points d'extension sont documentés en détail dans
[`docs/PROVIDERS.md`](docs/PROVIDERS.md). En résumé :

### Ajouter un fournisseur IA

1. Implémenter `AIProvider` (`src/server/providers/ai/types.ts`) dans un nouveau fichier.
2. L'enregistrer dans `src/server/providers/registry.ts`.
3. Ajouter sa valeur à l'enum `AI_PROVIDER` de `src/lib/env.ts`.

Aucun autre fichier ne change : rien n'importe un SDK propriétaire en dehors de son
implémentation.

### Ajouter une plateforme de publication

1. Étendre l'enum `Platform` dans `prisma/schema.prisma`, puis migrer.
2. Ajouter son profil à `PLATFORM_PROFILES` (`src/server/services/versions.ts`).
3. Implémenter `PublishingProvider` — ou laisser le mode manuel si aucune API officielle
   ne couvre l'opération. **Ne contournez jamais une plateforme.**

### Ajouter un template

Insérer une ligne `Template` (voir `prisma/seed.ts`). Sa `structure` JSON décrit les
sections et leurs poids ; les durées en découlent au prorata.

---

## Architecture

Le document d'architecture complet — analyse de la spécification, arborescence, APIs
externes, risques techniques, points restant manuels, schéma Prisma et plan
d'implémentation — se trouve dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

En bref :

- **Route Handlers fins** : ils authentifient, valident avec Zod, appellent un service.
  Toute la logique métier vit dans `src/server/services/`, ce qui permet au worker
  d'exécuter exactement le même code sans passer par HTTP.
- **Providers résolus par l'environnement** : changer de fournisseur = changer une
  variable.
- **Rendu = graphe de filtres construit programmatiquement** : testable sans exécuter
  FFmpeg, et la commande exacte est loggée en cas d'échec.
- **Les droits sont vérifiés au rendu**, pas à l'affichage : contourner l'interface ne
  contourne pas la règle.

---

## État d'avancement

**Phase 1 — livrée et fonctionnelle**

Dashboard · Ideas · génération d'idées IA + scoring · génération de scripts (5 variantes) ·
fact check + détection déterministe des sujets dangereux · Assets + upload + métadonnées ·
Rights Management · storyboard · voix · sous-titres SRT/VTT/ASS (5 styles) · **montage
FFmpeg → MP4 1080×1920** · templates · contrôle qualité · anti-duplication · coûts et ROI ·
workflow guidé Create Video · export multi-plateforme.

**Phase 2 — partiellement livrée**

Calendrier éditorial ✅ · abstraction de publication + mode manuel ✅ · saisie et calcul des
analytics ✅ · `CONTENT_SCORE` ✅ · **OAuth YouTube et TikTok : non implémenté** (la
publication passe en mode manuel).

**Phase 3 — partiellement livrée**

Affiliation avec UTM et EPC ✅ · boucle d'apprentissage (écarts mesurés en base + génération
de « Next Best Ideas ») ✅ · schéma multi-workspace ✅ · **`TrendProvider` avec sources
officielles : non implémenté** (saisie et import manuels).

Rien de ce qui n'est pas implémenté n'est présenté comme fonctionnel dans l'interface :
chaque fournisseur simulé est étiqueté, et chaque limitation est affichée à l'endroit où
elle se manifeste.

---

## Licence

Projet privé. Vous êtes responsable des droits sur les médias que vous importez et des
conditions d'utilisation des API que vous configurez.
