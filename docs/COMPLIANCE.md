# Conformité — ce qu'IAvid refuse de faire, et pourquoi

Ce document énumère les opérations volontairement hors périmètre. Ce ne sont pas des
fonctionnalités manquantes : ce sont des décisions de conception, appliquées **côté
serveur**, et testées.

---

## Le principe

> IAvid produit du contenu **original et transformé**. Ce n'est pas un outil de
> téléchargement ou de repost.

L'objectif est une usine à contenu légitime et monétisable. Un contenu dont vous ne
possédez pas les droits n'est ni monétisable ni défendable, et met en danger le compte qui
le publie.

---

## Opérations non implémentées

| Opération | Pourquoi elle est refusée |
|---|---|
| **Téléchargement massif de vidéos de plateformes** | C'est le cœur d'une ferme de repost. Aucun module d'ingestion par URL de plateforme n'existe. |
| **Suppression de filigrane** | Un filigrane indique l'origine d'un contenu. Le retirer sert à masquer que le contenu n'est pas le vôtre. |
| **Contournement des protections de plateformes** | Rate limits, DRM, signature de requêtes : les contourner viole les conditions d'utilisation et expose le compte à une suspension. |
| **Publication automatisée sans API officielle** | Automatiser une interface non prévue pour ça est un contournement. Quand l'API ne couvre pas l'opération, IAvid affiche « publication manuelle requise ». |
| **Usage d'un asset aux droits inconnus dans un export monétisable** | L'absence d'information n'est pas une autorisation. |

Ces opérations sont centralisées dans `src/lib/compliance/guards.ts`
(`UNSUPPORTED_OPERATIONS`) afin que le refus soit une décision documentée, et non un oubli
d'implémentation.

---

## Comment les règles sont appliquées

### 1. À l'import d'un asset

`assertNotPlatformDownload()` refuse toute URL appartenant à une plateforme sociale
(TikTok, YouTube, Instagram, Snapchat, Facebook, X, Reddit, Twitch, Vimeo, Dailymotion,
Pinterest — sous-domaines compris).

L'erreur renvoyée **propose une alternative légitime** plutôt qu'un simple refus :

> Enregistrez cette URL comme référence (`EXTERNAL_REFERENCE`) pour vous en inspirer, puis
> filmez ou générez votre propre plan. Pour réutiliser un extrait, importez le fichier
> fourni par son ayant droit avec sa preuve de licence.

Un asset `EXTERNAL_REFERENCE` est documentaire : il est conservé pour l'inspiration et
**ne peut jamais entrer dans un montage**.

### 2. Au moment du rendu

`assertRenderable()` est appelée par le service de rendu lui-même, **avant toute dépense
CPU** :

- un asset 🔴 **BLOCKED** dans le storyboard → le rendu est refusé, quel que soit le mode ;
- un asset 🟠 **NEEDS_REVIEW** → le rendu de travail reste possible, mais l'export marqué
  `MONETIZATION_READY` est refusé.

Contourner l'interface ne contourne pas la règle : la vérification est dans le service, pas
dans le composant React.

### 3. Au contrôle qualité

Avant tout export, `runQualityControl()` inspecte le fichier réel avec `ffprobe` et vérifie
les droits de chaque asset et de la musique. Un contrôle `fail` bloque l'export.

### 4. Sur la musique

Une piste dont l'usage commercial n'est pas **explicitement confirmé** n'est jamais
sélectionnée automatiquement pour un montage (`musicSelectableForAutoPick`).

---

## Le tri-état des droits

```
🟢 CLEARED       Commercialement utilisable
🟠 NEEDS_REVIEW  Vérification nécessaire  ← le défaut
🔴 BLOCKED       Interdit
```

**Le défaut est 🟠, jamais 🟢.** Un booléen `commercialUse` aurait forcé à choisir entre
« autorisé » et « interdit » ; le tri-état permet de dire « je ne sais pas », ce qui est la
situation réelle la plus fréquente et la plus dangereuse.

Passer un asset sous licence en 🟢 exige :

1. une licence **nommée** (« Pexels License », « contrat du 12/03 »…) ;
2. une **preuve** (URL ou fichier joint) ;
3. une confirmation **explicite** de l'usage commercial.

Sans les trois, le statut reste 🟠.

Une licence expirée repasse automatiquement en 🔴 — c'est pour cela que `RightsRecord` est
une entité séparée avec son propre `expiresAt`, et non un champ sur `Asset`.

---

## Sécurité des contenus DIY

Le bricolage touche à l'électricité, au gaz, aux structures porteuses, aux outils
dangereux, aux produits chimiques et au travail en hauteur. Un mauvais conseil peut blesser
quelqu'un.

**La détection est déterministe et s'exécute avant tout appel à un modèle**
(`src/lib/safety.ts`). Elle ne dépend pas du fait qu'un LLM ait pensé à prévenir :

- huit familles de risques, avec leurs termes en français et en anglais ;
- comparaison sur du texte normalisé, insensible aux accents ;
- chaque famille impose un **plafond au `SAFETY_SCORE`** (le gaz plafonne à 40, l'amiante à
  30) ;
- une `FactClaim` de statut `SAFETY_WARNING` est créée automatiquement sur le script ;
- le contrôle qualité signale la vidéo tant que l'avertissement n'a pas été traité.

Un LLM peut **enrichir** un avertissement. Il ne peut jamais décider qu'il est inutile.

De plus, le statut `VERIFIED` d'une affirmation **n'est atteignable que par une validation
humaine explicite** : l'API ne l'accepte que via `PATCH`, et le schéma de sortie du modèle
ne l'autorise même pas comme valeur.

---

## Ce qui reste manuel, par conception

1. **Publication Snapchat Spotlight** — aucune API publique de publication n'existe.
2. **Publication TikTok** tant que votre application n'est pas approuvée par TikTok.
3. **Saisie des liens d'affiliation** — l'app n'en fabrique jamais un ; elle n'ajoute que
   les paramètres UTM.
4. **Validation des droits d'un asset** — décision humaine, avec preuve.
5. **Validation finale du fact check** — l'IA propose, l'humain valide.
6. **Import des analytics** tant qu'aucun OAuth n'est configuré.
7. **Approbation d'une vidéo portant un `SAFETY_WARNING`** avant publication.
8. **Choix de la variante de script** — l'IA en propose cinq, l'humain choisit.

---

## Votre responsabilité

IAvid vous donne les outils pour tracer vos droits. Il ne les vérifie pas à votre place :

- vous êtes responsable des médias que vous importez ;
- vous êtes responsable du respect des conditions d'utilisation des API que vous
  configurez ;
- vous êtes responsable de la véracité et de la sécurité des conseils que vous publiez.

Les avertissements générés automatiquement sont une **aide**, pas un audit juridique ni une
validation technique.
