# MNBot — bot de trading algorithmique autonome

MNBot analyse en continu les marchés crypto (BTC/EUR et ETH/EUR sur **Binance**, au comptant, sans levier ;
Kraken reste disponible), détecte des opportunités avec une stratégie de **suivi de tendance (cassure sur 4h)**,
applique des règles strictes de gestion du risque et exécute les transactions — **en simulation par défaut**.
Tout se pilote depuis un dashboard web : démarrer, arrêter, surveiller, comparer des stratégies.

> ⚠️ Aucun logiciel de trading ne garantit de gains. MNBot est conçu pour **protéger le capital** avant tout.
> La stratégie active a été gagnante sur 2018-2022 **et** sur 2023-2026 en backtest (frais Binance inclus), mais
> avec un risque de 0,50 € par trade le gain attendu reste modeste (quelques euros par an). Détails dans
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#recherche-de-stratégie-novembre-2026).

## Démarrage rapide (machine Linux ou macOS)

```bash
./scripts/build.sh          # compile le dashboard et le serveur (une seule fois, puis après chaque mise à jour)
./scripts/mnbot.sh start    # démarre le bot en mode simulation
```

Ouvrez ensuite **http://127.0.0.1:5080** dans votre navigateur.

| Commande                     | Effet                                   |
|------------------------------|-----------------------------------------|
| `./scripts/mnbot.sh start`   | démarre le bot                          |
| `./scripts/mnbot.sh stop`    | arrête le programme                     |
| `./scripts/mnbot.sh status`  | indique s'il tourne                     |
| `./scripts/mnbot.sh logs`    | affiche le journal en direct            |

Pour un serveur (VPS) qui tourne 24h/24 : `sudo ./scripts/install-vps.sh` — voir [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Documentation

| Document | Contenu |
|---|---|
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Installation sur un ordinateur ou un VPS Linux |
| [docs/GUIDE_UTILISATEUR.md](docs/GUIDE_UTILISATEUR.md) | Utiliser le dashboard, lire les écrans, modifier la configuration |
| [docs/PASSAGE_EN_REEL.md](docs/PASSAGE_EN_REEL.md) | Procédure (verrouillée) pour passer en argent réel |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture technique, stratégie, backtests, sécurité |

## Ce qui est en place

- **Données de marché** : prix, chandeliers 1h/4h/1j, volumes et carnet d'ordres Binance (ou Kraken) en temps réel.
- **Analyse** : EMA 20/50/200, RSI 14, ATR 14, canaux de Donchian, volume ; signal validé uniquement à la clôture de bougie.
- **Stratégies** : cassure 20 bougies 4h (active), 4 variantes et l'ancienne stratégie *Pullback* ; activation depuis le dashboard.
- **Risque** : 70 € max engagés, 30 € jamais touchés, 0,50 € de risque par trade, 1,50 €/jour et 3 €/semaine de perte max,
  une seule position, aucun levier, refus des trades rendus non pertinents par les frais.
- **Exécution** : simulation réaliste (prix acheteur/vendeur, glissement, frais 0,10 %), anti-doublon, vérification des soldes,
  arrêt d'urgence. Connecteurs d'ordres réels Binance et Kraken présents mais **verrouillés** (3 verrous + confirmation écrite).
- **Backtesting** : jusqu'à 9 ans d'historique, frais/spread/glissement inclus, séparation entraînement / validation,
  plus un banc de recherche (`tools/MNBot.Research`).
- **Analyse IA** : résumé de marché, anomalies, lecture des performances ; commentaire rédigé par Claude en option.
  L'IA n'a aucun accès aux ordres.
- **Dashboard** : mode sombre, graphiques TradingView Lightweight Charts, temps réel par WebSocket, utilisable sur mobile.
- **Tests** : 62 tests automatisés (`dotnet test`).

Configuration : `config/mnbot.json` (paramètres) et `.env` (secrets, à créer depuis `.env.example`).
