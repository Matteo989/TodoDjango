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
| `src/MNBot.Exchanges.Kraken` | Connecteur Kraken : données publiques, signature des requêtes privées, exécution réelle. |
| `src/MNBot.Api` | Hébergement : configuration, SQLite, API REST, WebSocket, services (backtest, historique, IA, Telegram). |
| `tests/MNBot.Tests` | 48 tests xUnit (indicateurs, stratégie, absence de look-ahead, risque, backtest, moteur, Kraken). |
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

## Stratégie Trend Following + Pullback

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
