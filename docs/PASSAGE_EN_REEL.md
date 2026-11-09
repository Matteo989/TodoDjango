# Passage en trading réel

> **À lire en entier avant toute chose.** Le trading réel peut faire perdre de l'argent. Ne l'activez que si la
> simulation a tourné au moins 30 jours, avec au moins 20 transactions et un résultat positif, et uniquement avec de
> l'argent que vous pouvez vous permettre de perdre.

Le bot ne passe **jamais** en réel tout seul. Il faut ouvrir quatre verrous indépendants, et chacun est vérifié.

| Verrou | Où | Ce qui se passe s'il manque |
|---|---|---|
| 1. `"Mode": "Live"` | `config/mnbot.json` | Le bot reste en simulation. |
| 2. `MNBOT_LIVE_TRADING_ENABLED=true` | `.env` | Le programme refuse de démarrer. |
| 3. Clés API Kraken | `.env` | Le programme refuse de démarrer. |
| 4. Confirmation écrite | Dashboard → Journal & réglages | Aucun ordre réel n'est envoyé. |

De plus, en mode réel, le moteur **démarre toujours arrêté** : il faut cliquer sur « Démarrer ».
La confirmation écrite n'est acceptée que si la validation du paper trading est atteinte
(sauf si `AllowLiveWithoutValidation` est mis à `true`, ce qui est déconseillé).

## Étape 1 — Vérifier la simulation

Dans **Journal & réglages**, la carte « Validation avant trading réel » doit afficher ✔. Regardez aussi l'écran
Backtesting : la variante utilisée doit être positive sur la période de **validation**.

## Étape 2 — Créer une clé API Kraken (sans droit de retrait)

1. Kraken → *Settings* → *API* → *Create API key*.
2. Cochez **uniquement** :
   - *Funds permissions* : **Query Funds**
   - *Orders and trades* : **Query Open Orders & Trades**, **Query Closed Orders & Trades**, **Create & Modify Orders**
3. **Ne cochez JAMAIS** *Withdraw Funds* (retraits). Les autres permissions (dépôts, staking, export…) sont inutiles : laissez-les décochées.
4. Si possible, limitez la clé à l'adresse IP de votre VPS (*IP whitelist*).
5. Copiez la clé et le secret privé.

## Étape 3 — Renseigner `.env`

```
KRAKEN_API_KEY=votre_cle
KRAKEN_API_SECRET=votre_secret
MNBOT_LIVE_TRADING_ENABLED=true
MNBOT_DASHBOARD_PASSWORD=un_mot_de_passe_solide
```

Le fichier `.env` doit rester privé (`chmod 600 .env`). Ne l'envoyez jamais à personne, ni sur GitHub.

## Étape 4 — Essai à blanc (recommandé)

Dans `config/mnbot.json`, section `Kraken`, mettez `"ValidateOrdersOnly": true` et `"Mode": "Live"` dans `Bot`.
Redémarrez. Les ordres seront **vérifiés par Kraken sans être exécutés** : cela permet de valider les clés et les
permissions. Les tentatives apparaissent dans « Ordres envoyés » avec la mention « Mode validation ».

## Étape 5 — Activer

1. Approvisionnez le compte Kraken avec le capital prévu (100 €). Le bot garde toujours 30 € de côté.
2. `config/mnbot.json` : `"Mode": "Live"` et `"ValidateOrdersOnly": false`.
3. Redémarrez le bot.
4. Dashboard → **Journal & réglages** → tapez `JE CONFIRME LE TRADING REEL` et votre mot de passe → *Confirmer*.
5. Dashboard → **Démarrer**.

Le bandeau rouge « ARGENT RÉEL » s'affiche en haut de chaque page.

## Revenir en simulation

`"Mode": "Paper"` dans `config/mnbot.json`, puis redémarrer. En cas de doute : **Arrêt d'urgence**, qui vend tout et
bloque le bot.

## Limites connues du mode réel (à lire)

- Le connecteur d'ordres réels a été écrit selon la documentation Kraken et sa signature est vérifiée par un test
  automatique, mais il **n'a pas pu être testé avec un vrai compte** pendant le développement. L'étape 4 (essai à blanc)
  sert précisément à le vérifier, puis surveillez de près les premières transactions.
- Le stop-loss et l'objectif sont surveillés par le bot toutes les 10 secondes. Si le serveur est éteint, ils ne sont
  plus surveillés : gardez le bot sur un VPS fiable.
- Les ordres sont « au marché » : frais Kraken de 0,40 % par ordre au palier de départ.
