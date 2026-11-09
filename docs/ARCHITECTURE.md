# Architecture technique

## Vue d'ensemble

```
                 ┌──────────────────────── MNBot.Api (ASP.NET Core, un seul processus) ────────────────────────┐
 Kraken API ───► │ Market Data Engine ─► Analysis/Strategy Engine ─► Risk Management Engine ─► Execution Engine │ ──► Kraken (réel)
 (REST public)   │   (KrakenMarketData)    (TrendPullbackStrategy)     (RiskManager, PositionSizer)  (Paper | Kraken) │     ou simulation
                 │          │                         │                           │                      │           │
                 │          └──────────── TradingEngine (boucle 24h/24, toutes les 10 s) ─────────────────┘           │
                 │                                         │                                                         │
                 │   SQLite (data/mnbot.db)   EventHub (WebSocket /ws)   API REST /api/*   Backtest   Analyse (IA)    │
                 └──────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                            ▼
                                             Dashboard React (servi par le même processus)
```

| Projet | Rôle |
|---|---|
| `src/MNBot.Core` | Cœur indépendant de toute plateforme : modèles, indicateurs, stratégies, risque, exécution simulée, backtest, moteur, analyse. |
| `src/MNBot.Exchanges.Binance` | Connecteur Binance (plateforme par défaut) : données publiques, signature HMAC-SHA256, exécution réelle. |
| `src/MNBot.Exchanges.Kraken` | Connecteur Kraken : données publiques, signature des requêtes privées, exécution réelle. |
| `src/MNBot.Api` | Hébergement : configuration, SQLite, API REST, WebSocket, services (backtest, historique, IA, Telegram). |
| `tests/MNBot.Tests` | 62 tests xUnit (indicateurs, stratégies, absence de look-ahead, risque, backtest, moteur, Binance, Kraken). |
| `tools/MNBot.Research` | Banc de recherche : compare des stratégies sur 9 ans d'historique, avec variation des paramètres. |
| `dashboard` | Interface React + TypeScript + Vite, graphiques TradingView Lightweight Charts. |

### Choix techniques

- **C# / .NET 8** pour le moteur et le serveur : typage strict, calculs en `decimal` (pas d'erreurs d'arrondi sur les montants).
- **SQLite** (Dapper) : un seul fichier, aucune installation, suffisant pour ce volume.
- **API REST + WebSocket natif** : le dashboard reçoit les prix, signaux et alertes en temps réel.
- **Polling REST de Kraken** (prix toutes les 10 s, bougies toutes les 60 s) plutôt que le WebSocket Kraken :
  plus simple et robuste ; la stratégie décide sur des bougies d'1 h, une latence de quelques secondes est sans effet.
- **Python** n'a pas été nécessaire : le backtest est écrit en C# et réutilise exactement le code du moteur réel,
  ce qui évite deux implémentations divergentes.

### Multi-marchés

Le moteur ne connaît que des interfaces : `IMarketDataProvider` (données), `IExecutionVenue` (exécution) et
`IStrategy`. Ajouter des actions, ETF, Forex ou indices consiste à écrire un nouveau connecteur qui implémente ces
interfaces (`AssetClass` est déjà prévu), sans modifier le moteur.

## Stratégie active : cassure 20 bougies 4h (suivi de tendance)

Évaluée à la clôture de chaque bougie 4h (toutes les 4 heures), uniquement sur des bougies clôturées :

| Règle | Détail |
|---|---|
| Achat | la clôture dépasse le plus haut des 20 bougies 4h précédentes **et** est au-dessus de l'EMA 200 (4h) |
| Stop de protection | 3 ATR sous le prix d'entrée (sert aussi à calculer la taille : perte au stop ≤ 0,50 €) |
| Objectif | 3 fois le risque |
| Sortie de tendance | la clôture passe sous le plus bas des 10 bougies 4h précédentes |

Profil attendu : environ 35 à 45 % de trades gagnants, des petites pertes fréquentes et quelques gains de 2 à 3 fois
le risque. C'est ce profil qui résiste le mieux aux frais.

## Ancienne stratégie : Trend Following + Pullback (désactivée)

Évaluée à la clôture de chaque bougie 1h, avec uniquement des bougies clôturées :

| # | Condition d'achat | Détail |
|---|---|---|
| 1 | Tendance de fond | clôture 4h > EMA 200 (4h) |
| 2 | Tendance courte | EMA 20 > EMA 50 (1h) |
| 3 | Repli | une des 5 dernières bougies 1h a touché l'EMA 20 (tolérance 0,2 %) |
| 4 | Reprise | RSI 14 repasse au-dessus de 50 |
| 5 | Confirmation | volume ≥ moyenne des 20 volumes précédents |
| 6 | Validation | clôture au-dessus de l'EMA 20, bougie clôturée |

Sortie (règles symétriques pour une position Spot) : stop-loss à 1,5 ATR sous l'entrée, objectif à 2 × le risque,
sortie anticipée si l'EMA 20 repasse sous l'EMA 50 (1h) ou si la clôture 4h repasse sous l'EMA 200.
Jamais de renforcement d'une position, jamais de vente à découvert.

## Gestion du risque

- Taille de position = risque autorisé ÷ perte par unité au stop, **frais d'entrée et de sortie et glissement inclus**.
- Plafonds : 70 € engagés au maximum (même après des gains), 30 € de réserve + marge jamais utilisés.
- Refus si : quantité minimale Kraken trop risquée, montant sous le minimum, frais > 40 % du gain visé, rapport
  gain/risque net < 1,3, spread > 0,3 %, prix figés ou variation anormale (> 8 %), 5 erreurs API consécutives.
- Limites journalière (1,50 €) et hebdomadaire (3 €) calculées sur les pertes réalisées **et** latentes, fuseau Europe/Paris.
  Le budget du trade suivant est réduit pour ne jamais dépasser la limite restante.
- Anti-doublon : un identifiant d'ordre unique par stratégie/actif/bougie, vérifié en base avant tout envoi.

## Backtesting

- Moteur événementiel : signal à la clôture → exécution à l'**ouverture de la bougie suivante** (pas de look-ahead).
- Bougies 4h reconstruites à partir du 1h et utilisées seulement une fois **clôturées**.
- Coûts : frais 0,40 %, demi-spread 0,025 %, glissement 0,05 % à chaque ordre ; si stop et objectif sont touchés dans la
  même bougie, on suppose le stop (hypothèse pessimiste) ; gap sous le stop → sortie à l'ouverture.
- Séparation chronologique 70 % entraînement / 30 % validation.
- Biais du survivant : signalé dans chaque rapport (seuls BTC et ETH sont testés).

### Premiers résultats (backtest du 9 novembre 2026, BTC/EUR + ETH/EUR, déc. 2024 → nov. 2026, données Binance 1h)

| Variante | Période | Trades | Réussite | Profit factor | Résultat net | Drawdown max |
|---|---|---:|---:|---:|---:|---:|
| Référence (stop 1,5 ATR, 2R) | entraînement | 0 | — | — | 0,00 € | — |
| | validation | 0 | — | — | 0,00 € | — |
| Stop 3 ATR, 2R | entraînement | 9 | 56 % | 1,94 | +1,35 € | 1,03 € |
| | validation | 1 | 100 % | — | +0,17 € | 0,39 € |
| Stop 3 ATR, 3R, sans sortie anticipée | entraînement | 33 | 27 % | 0,73 | −3,19 € | 5,67 € |
| | validation | 15 | 20 % | 0,49 | −3,04 € | 4,00 € |
| Sans filtre volume | entraînement | 0 | — | — | 0,00 € | — |
| | validation | 0 | — | — | 0,00 € | — |

**Lecture :**
- La stratégie de référence détecte ~140 signaux sur la période mais **tous sont refusés** : avec un stop de 1,5 ATR
  sur des bougies 1h, l'écart entre l'entrée et le stop ne représente qu'environ 1 % du prix, alors qu'un aller-retour
  coûte 0,9 % (frais + glissement). Les frais absorberaient l'essentiel du gain : le garde-fou les écarte, comme demandé.
- Un stop plus large (3 ATR) laisse passer quelques trades, mais l'échantillon (10 trades) est bien trop petit pour
  conclure.
- Aucune variante n'est démontrée rentable à ce stade. Pistes à tester par backtest avant tout usage : ordres
  limites (frais *maker* de 0,25 %), unités de temps plus longues (4h/1j) où les mouvements dépassent largement les frais,
  palier de frais Kraken plus bas.

## Recherche de stratégie (novembre 2026)

Banc de recherche : `dotnet run --project tools/MNBot.Research -- data/mnbot.db 0.001 0.5` (frais, risque par trade).
Données Binance 1h d'octobre 2017 à novembre 2026, bougies 4h et 1j reconstruites. Frais 0,10 %, glissement 0,05 %,
demi-spread 0,025 % par ordre, capital 100, risque 0,50 par trade, une position à la fois, BTC + ETH.
Huit stratégies déclarées **avant** de regarder les résultats ; choix sur 2018-2022, contrôle sur 2023-2026.

| Stratégie | 2018-2022 (USDT) | 2023-2026 (USDT) | 2023-2026 (EUR) |
|---|---|---|---|
| A · Pullback 1h/4h (ancienne) | 228 trades, −19,38 | 123 trades, −5,50 | 136 trades, −11,39 |
| B · Pullback 4h/1j | 46 trades, +2,31 | 54 trades, −5,34 | 56 trades, −5,74 |
| C · Cassure 20 jours | 3 trades, +4,25 | 15 trades, +1,48 | 14 trades, +2,16 |
| D · Cassure 55 jours | 3 trades, +2,33 | 11 trades, +2,14 | 8 trades, +3,23 |
| **E · Cassure 20 bougies 4h** | **137 trades, +26,80 (PF 2,09)** | **136 trades, +12,47 (PF 1,48)** | **130 trades, +12,37 (PF 1,49)** |
| F · Croisement EMA 20/50 (1j) | 1 trade | 6 trades, +1,73 | 9 trades, +2,64 |
| G · Croisement EMA 10/30 (1j) | 2 trades | 7 trades, +1,34 | 8 trades, +2,76 |
| H · Cassure 20 jours sans filtre | 5 trades, +3,38 | 18 trades, +3,61 | 19 trades, +2,72 |

*PF = profit factor (gains bruts ÷ pertes brutes).* Les stratégies journalières (C, D, F, G, H) font trop peu de
transactions pour conclure : avec un stop large et 0,50 € de risque, beaucoup de positions tombent sous le minimum
de 5 € de Binance.

**Robustesse de E** : 36 variantes voisines (cassure sur 15/20/30 bougies, sortie sur 5/10/15, avec ou sans stop
suiveur) sont **toutes** positives sur les trois périodes (PF entre 1,21 et 2,09). Détail par année (EUR) :
2023 +8,40 · 2024 +1,79 · 2025 +1,92 · 2026 +0,32 (jusqu'au 9 novembre).

**Effet des frais sur E** (2023-2026, EUR) : 0,10 % → +12,37 · 0,25 % → +6,78 · 0,40 % → +2,16 (négatif depuis 2024).
D'où le passage sur Binance.

**Ce qu'il faut en retenir honnêtement :**
- Résultat attendu au réglage actuel : environ **+3 à +6 € par an** pour 100 €, avec des baisses temporaires de 5 €.
  Les gains et les pertes sont proportionnels au risque par trade (`RiskPerTrade`) : doubler ce risque double les deux.
- Sur 2023-2026, simplement acheter et conserver du BTC a rapporté beaucoup plus (+333 %) ; en contrepartie, la
  stratégie reste hors du marché pendant les baisses (BTC a perdu plus de 70 % en 2018 puis en 2022).
- Le passé ne garantit pas l'avenir : la validation en simulation (30 jours minimum) reste obligatoire.

## Comparaison des familles de robots (novembre 2026)

Commande : `dotnet run --project tools/MNBot.Research -- data/mnbot.db 0.001 0.5 portfolio`.
Capital 100, 70 maximum investis, frais + glissement + demi-spread = 0,175 % par ordre, décision à la clôture et
exécution à l'ouverture suivante. Résultats annualisés (« par an ») et pire baisse depuis un sommet.

| Famille (exemple représentatif) | 2018-2022 (entraînement) | 2023-2026 (test) | Pire baisse |
|---|---|---|---|
| Livret 3 % | +3 %/an | +3 %/an | 0 % |
| Achat-conservation BTC | +14 %/an | +38 %/an | −73 % |
| **Filtre de tendance BTC (investi si prix > moyenne 100 j)** | **+45 %/an** | **+25 %/an** | **−29 %** |
| Filtre de tendance BTC (moyennes 50 j / 200 j) | +35 % / +26 %/an | +36 % / +24 %/an | −46 % / −47 % |
| Filtre de tendance BTC+ETH (100 j) | +43 %/an | +22 %/an | −40 % |
| Rotation sur les cryptos les plus fortes, univers choisi en 2026 | +81 %/an | +22 %/an | −57 % |
| **Même rotation, univers réaliste de début 2018** | +38 %/an | **−2 %/an** | −73 % |
| Robot de grille BTC (type Pionex) | −14 à +5 %/an | −6 à +7 %/an | jusqu'à −64 % |
| Robot DCA type 3Commas (sans stop) | +6 à +16 %/an | +10 à +13 %/an | −27 à −56 % |
| Cassure 4h actuelle (0,50 € de risque par trade) | ≈ +6 €/an | ≈ +3 €/an | ≈ −5 € |

Lecture :
- La rotation sur les « meilleures » cryptos n'est spectaculaire que parce que la liste a été choisie avec la
  connaissance de 2026 (biais du survivant). Avec les cryptos dominantes de 2018 (EOS, NEO, IOTA… qui se sont
  effondrées), elle ne gagne plus rien sur 2023-2026 : **rejetée**.
- Les robots de grille, très populaires, gagnent en marché sans direction mais perdent dans les tendances : **rejetés**.
- Les robots DCA rapportent ~10 %/an mais n'ont pas de stop : une crypto qui s'effondre bloque tout le capital.
- Le **filtre de tendance sur BTC** est la seule approche positive sur les deux périodes, pour les trois longueurs de
  moyenne testées, avec des baisses plus faibles que l'achat-conservation. C'est aussi l'approche la mieux documentée
  dans la littérature (« time-series momentum »). Contrepartie : 70 € investis d'un coup et une baisse temporaire
  de 20 à 30 € possible, ce qui dépasse les limites actuelles (0,50 € par trade, 3 € par semaine).

## Plus de cryptos, actions, ETF et or (novembre 2026)

Commande : `dotnet run --project tools/MNBot.Research -- data/mnbot.db 0.001 0.5 assets`.
ETF journaliers Yahoo Finance (cours ajustés des dividendes) ; mêmes coûts et même méthode que ci-dessus.

| Portefeuille (filtre de tendance) | 2018-2022 | 2023-2026 | Pire baisse |
|---|---|---|---|
| BTC seul (100 j) | +45 %/an | +25 %/an | −29 % |
| 14 cryptos dominantes en 2018 (100 j) | +26 %/an | +8 %/an | −57 % |
| 6 grandes cryptos (100 j) | +43 %/an | +13 %/an | −55 % |
| Achat-conservation S&P 500 / MSCI World € | +7 % / +6 %/an | +15 % / +12 %/an | −25 % |
| Tendance S&P 500 (200 j) | +3 %/an | +9 %/an | −16 % |
| Multi-actifs ETF + or + obligations (200 j) | +3 %/an | +8 %/an | −10 % |
| **Mix tendance BTC / or (moitié-moitié)** | **+22 %/an** | **+22 %/an** | **−20 %** |
| Mix tendance BTC / S&P 500 / or (tiers) | +16 %/an | +18 %/an | −18 % |

Lecture :
- Multiplier les cryptos **dégrade** le résultat quand on choisit la liste honnêtement (sans connaître l'avenir) :
  les petites cryptos baissent plus et remontent moins que BTC.
- Les actions et ETF seuls rapportent moins mais baissent beaucoup moins ; leur intérêt est la diversification.
- Le mélange **BTC + or**, chacun avec son filtre de tendance, est le plus régulier : environ +22 %/an sur les deux
  périodes, pire baisse −20 %. Les deux s'achètent sur Binance (l'or via le jeton PAXG, coté en USDT).
- Les actions/ETF nécessitent un courtier avec API (ce n'est pas possible sur Binance) : piste pour plus tard.

## Sécurité

- Secrets uniquement dans `.env` (jamais dans le code ni sur GitHub) ; permissions de retrait jamais demandées.
- Mode réel protégé par 4 verrous (voir PASSAGE_EN_REEL.md) ; démarrage toujours manuel en réel.
- Dashboard en écoute locale par défaut ; refus de démarrer s'il est exposé sans mot de passe ; limitation des
  tentatives de connexion.
- Vérification des soldes avant chaque ordre, journalisation de chaque ordre, signal et alerte en base et dans `logs/`.
- Arrêt d'urgence persistant (survit à un redémarrage).
- L'IA reçoit un résumé textuel et renvoie du texte : aucune référence au moteur d'exécution.

## API (pour information)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/status` | statut du moteur |
| POST | `/api/bot/start` · `/stop` · `/emergency-stop` · `/rearm` | commandes |
| GET | `/api/overview` · `/api/risk` · `/api/positions` · `/api/trades` · `/api/orders` · `/api/signals` · `/api/alerts` | consultation |
| GET | `/api/market/symbols` · `/api/market/candles` · `/api/market/orderbook` | marché |
| POST | `/api/data/import` · `/api/backtest/run` | historique et backtest |
| GET | `/api/analysis/market` · `/api/analysis/performance` ; POST `/api/analysis/ai` | analyse |
| GET | `/api/validation` ; POST `/api/live/confirm` | passage en réel |
| WS | `/ws` | événements temps réel |
