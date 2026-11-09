# Passage en trading réel

> **À lire en entier avant toute chose.** Le trading réel peut faire perdre de l'argent. Ne l'activez que si la
> simulation a tourné au moins 30 jours, avec au moins 20 transactions et un résultat positif, et uniquement avec de
> l'argent que vous pouvez vous permettre de perdre.

Le bot ne passe **jamais** en réel tout seul. Il faut ouvrir quatre verrous indépendants, et chacun est vérifié.

| Verrou | Où | Ce qui se passe s'il manque |
|---|---|---|
| 1. `"Mode": "Live"` | `config/mnbot.json` | Le bot reste en simulation. |
| 2. `MNBOT_LIVE_TRADING_ENABLED=true` | `.env` | Le programme refuse de démarrer. |
| 3. Clés API Binance (ou Kraken) | `.env` | Le programme refuse de démarrer. |
| 4. Confirmation écrite | Dashboard → Journal & réglages | Aucun ordre réel n'est envoyé. |

De plus, en mode réel, le moteur **démarre toujours arrêté** : il faut cliquer sur « Démarrer ».
La confirmation écrite n'est acceptée que si la validation du paper trading est atteinte
(sauf si `AllowLiveWithoutValidation` est mis à `true`, ce qui est déconseillé).

## Étape 1 — Vérifier la simulation

Dans **Journal & réglages**, la carte « Validation avant trading réel » doit afficher ✔. Regardez aussi l'écran
Backtesting : la variante utilisée doit être positive sur la période de **validation**.

## Étape 2 — Créer une clé API Binance (sans droit de retrait)

1. Binance → *Profil* → *Gestion des API* → *Créer une API* → *Clé générée par le système*.
2. Cochez **uniquement** :
   - **Enable Reading** (lecture) ;
   - **Enable Spot & Margin Trading** (trading au comptant). Le bot n'utilise jamais la marge ni l'emprunt.
3. **Ne cochez JAMAIS** *Enable Withdrawals* (retraits), ni *Enable Margin Loan*, *Futures*, *Universal Transfer*.
4. Choisissez **Restrict access to trusted IPs only** et indiquez l'adresse IP de votre VPS.
5. Copiez la clé et le secret (le secret n'est affiché qu'une fois).

Conseil : si vous détenez du BNB et activez « payer les frais en BNB », les frais passent de 0,10 % à 0,075 %.
Le bot reste prudent et compte 0,10 % dans ses calculs.

## Étape 3 — Renseigner `.env`

```
BINANCE_API_KEY=votre_cle
BINANCE_API_SECRET=votre_secret
MNBOT_LIVE_TRADING_ENABLED=true
MNBOT_DASHBOARD_PASSWORD=un_mot_de_passe_solide
```

Le fichier `.env` doit rester privé (`chmod 600 .env`). Ne l'envoyez jamais à personne, ni sur GitHub.

## Étape 4 — Essai à blanc (recommandé)

Dans `config/mnbot.json`, section `Binance`, mettez `"ValidateOrdersOnly": true`, et `"Mode": "Live"` dans `Bot`.
Redémarrez. Les ordres seront **vérifiés par Binance sans être exécutés** : cela permet de valider les clés et les
permissions. Les tentatives apparaissent dans « Ordres envoyés » avec la mention « Mode validation ».

## Étape 5 — Activer

1. Placez le capital prévu **en EUR** sur votre portefeuille Spot Binance (100 €). Le bot n'engage jamais plus de 70 €,
   même si le solde EUR est plus élevé, et ne revend que les quantités qu'il a lui-même achetées : vos autres
   cryptomonnaies ne sont pas touchées. Pour un suivi plus lisible, l'idéal reste de n'avoir sur le portefeuille Spot
   que l'argent destiné au bot (les montants affichés dans le dashboard partent du principe que le solde EUR vaut ~100 €).
2. `config/mnbot.json` : `"Mode": "Live"` et, dans `Binance`, `"ValidateOrdersOnly": false`.
3. Redémarrez le bot.
4. Dashboard → **Journal & réglages** → tapez `JE CONFIRME LE TRADING REEL` et votre mot de passe → *Confirmer*.
5. Dashboard → **Démarrer**.

Le bandeau rouge « ARGENT RÉEL » s'affiche en haut de chaque page.

## Revenir en simulation

`"Mode": "Paper"` dans `config/mnbot.json`, puis redémarrer. En cas de doute : **Arrêt d'urgence**, qui vend tout et
bloque le bot.

## Limites connues du mode réel (à lire)

- Les connecteurs d'ordres réels (Binance et Kraken) ont été écrits selon la documentation officielle et leur signature
  est vérifiée par un test automatique sur l'exemple publié, mais ils **n'ont pas pu être testés avec un vrai compte**
  pendant le développement. L'étape 4 (essai à blanc) sert précisément à le vérifier ; surveillez ensuite de près les
  premières transactions.
- Le stop-loss et l'objectif sont surveillés par le bot toutes les 10 secondes. Si le serveur est éteint, ils ne sont
  plus surveillés : gardez le bot sur un VPS fiable.
- Les ordres sont « au marché » : frais Binance de 0,10 % par ordre (0,40 % sur Kraken, ce qui rend la stratégie non rentable).
