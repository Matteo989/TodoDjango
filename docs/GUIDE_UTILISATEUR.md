# Guide utilisateur

Ce guide explique comment utiliser MNBot au quotidien, sans écrire de code.

## 1. Le principe en deux phrases

Toutes les 4 heures, à la clôture d'une bougie, le bot vérifie si BTC/EUR ou ETH/EUR cassent leur plus haut des
20 dernières bougies alors que la tendance de fond est haussière. Si c'est le cas **et** que les règles de risque
l'autorisent, il achète sur Binance, place un stop-loss, puis surveille la position toutes les 10 secondes. Il revend
quand le prix passe sous le plus bas des 10 dernières bougies, touche le stop-loss ou atteint l'objectif.
Attendez-vous à peu de transactions (environ 3 par mois) et à davantage de petites pertes que de gains :
ce sont quelques grosses tendances qui font le résultat.

Par défaut, tout se passe **en simulation** (« paper trading ») : les prix sont réels, l'argent ne l'est pas.

## 2. Les écrans du dashboard

### Vue générale
Capital total, capital disponible, gains/pertes du jour, de la semaine et depuis le début, nombre de transactions,
courbe du capital, prix des marchés surveillés et dernières alertes.

### Trading
- Graphique en chandeliers (1h, 4h ou 1 jour) avec les moyennes mobiles (EMA 20 en jaune, EMA 50 en bleu, EMA 200 en violet)
  et le RSI en dessous. Les achats et ventes passés apparaissent sous forme de flèches ; une position ouverte affiche
  ses lignes d'entrée, de stop (rouge) et d'objectif (vert).
- **Dernière analyse de la stratégie** : la liste des conditions, cochées ✔ ou non ✘, avec les valeurs exactes.
  C'est ici que l'on comprend *pourquoi* le bot achète ou non.
- Carnet d'ordres, signaux détectés (et la suite donnée par le moteur), historique des transactions.

### Bot
- **Démarrer / Arrêter** : « Arrêter » empêche tout nouvel achat, mais les positions ouvertes restent protégées par
  leur stop-loss et leur objectif.
- **Arrêt d'urgence** : vend immédiatement toutes les positions au prix du marché et bloque le bot. Il faut ensuite
  cliquer sur « Réarmer », puis « Démarrer ».
- **Stratégies** : cochez la ou les stratégies utilisées par le moteur.
- Dernier signal, dernière transaction, erreurs éventuelles.

Les boutons Démarrer / Arrêter / Urgence sont aussi disponibles en haut de chaque page.

### Risque
Capital exposé, risque des positions ouvertes, jauges des pertes du jour et de la semaine, et la liste des limites.
Un bandeau indique si une nouvelle position est autorisée et, sinon, pourquoi.

### Backtesting
1. Cliquez sur **Importer 2 ans** (une fois ; recommencez de temps en temps pour mettre à jour l'historique).
2. Cliquez sur **Comparer toutes les variantes**.
3. Lisez le tableau : chaque variante est testée sur une période d'**entraînement** (les 70 % les plus anciens)
   puis de **validation** (les 30 % les plus récents). **Seule la ligne « Validation » compte vraiment** : c'est une
   période que la variante n'a pas servi à choisir.

Indicateurs : *réussite* = part des trades gagnants ; *profit factor* = gains ÷ pertes (au-dessus de 1 = gagnant) ;
*drawdown max* = la plus forte baisse du capital depuis un sommet ; *signaux / refusés* = signaux détectés et ceux
écartés par la gestion du risque (souvent à cause des frais).

### Analyse IA
Résumé automatique des conditions de chaque marché, anomalies détectées, analyse des résultats et pistes
d'amélioration. Avec une clé `ANTHROPIC_API_KEY` dans `.env`, un bouton génère en plus un commentaire rédigé par Claude.
Ce module **ne peut pas** passer d'ordre ni modifier les règles.

### Journal & réglages
Toutes les alertes, tous les ordres envoyés, la progression de la validation du paper trading, la configuration
active et la procédure de passage en réel.

## 3. Modifier les paramètres

Tous les réglages sont dans `config/mnbot.json`. Après modification : redémarrez (`sudo systemctl restart mnbot`
sur un VPS, ou `./scripts/mnbot.sh restart`).

Réglages les plus utiles :

| Section | Paramètre | Signification |
|---|---|---|
| `Bot` | `Symbols` | Actifs surveillés (ex. `"BTC/EUR"`, `"ETH/EUR"`, `"SOL/EUR"`) |
| `Risk` | `RiskPerTrade` | Perte maximale visée par transaction (€) |
| `Risk` | `MaxDailyLoss` / `MaxWeeklyLoss` | Limites de perte |
| `Risk` | `MaxTradingCapital` | Capital maximum engagé |
| `Risk` | `MaxFeeShareOfReward` | Refuse un trade si les frais dépassent cette part du gain visé (0,40 = 40 %) |
| `Strategies` | `Parameters` | Paramètres de chaque variante (EMA, RSI, multiple d'ATR du stop, objectif en R…) |

Bonne pratique : **ne changez jamais un paramètre de la stratégie active sans l'avoir d'abord testé** dans une
variante désactivée, puis comparé dans l'écran Backtesting. Le bot ne modifie jamais ses paramètres tout seul.

## 4. Être prévenu sur son téléphone (optionnel)

Créez un bot Telegram (avec @BotFather), récupérez votre identifiant de discussion, puis renseignez dans `.env` :
`TELEGRAM_BOT_TOKEN=...` et `TELEGRAM_CHAT_ID=...`. Les transactions et alertes importantes vous seront envoyées.

## 5. Questions fréquentes

**Le bot ne fait aucune transaction, est-ce normal ?**
Oui. La stratégie n'achète qu'en tendance haussière et sur une cassure : en marché baissier ou sans direction,
elle peut rester plusieurs semaines sans rien faire. C'est voulu. L'écran Trading montre en permanence quelles
conditions manquent.

**Que se passe-t-il si le serveur redémarre ?**
Le bot reprend automatiquement : positions ouvertes, soldes simulés et historique sont conservés dans la base.

**Que se passe-t-il si Binance ne répond plus ?**
Après 5 erreurs consécutives, les nouveaux achats sont suspendus et une alerte est émise. Ils reprennent automatiquement
quand la connexion revient.

**Comment remettre la simulation à zéro ?**
Arrêtez le bot, supprimez le fichier `data/mnbot.db`, redémarrez. (Vous perdez l'historique simulé et les backtests.)
