# MNBot — bot de trading algorithmique autonome

MNBot analyse en continu les marchés crypto (BTC/EUR et ETH/EUR sur **Kraken**, au comptant, sans levier),
détecte des opportunités avec une stratégie *Trend Following + Pullback*, applique des règles strictes de
gestion du risque et exécute les transactions — **en simulation par défaut**.
Tout se pilote depuis un dashboard web : démarrer, arrêter, surveiller, comparer des stratégies.

> ⚠️ Aucun logiciel de trading ne garantit de gains. MNBot est conçu pour **protéger le capital** avant tout ;
> les premiers backtests (voir plus bas) montrent qu'avec 100 € et les frais Kraken, la stratégie de référence
> refuse la plupart des trades parce que les frais mangeraient le gain espéré.

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

- **Données de marché** : prix, chandeliers 1h/4h, volumes et carnet d'ordres Kraken en temps réel (API publique).
- **Analyse** : EMA 20/50/200, RSI 14, ATR 14, volume ; signal validé uniquement à la clôture de bougie.
- **Stratégies** : Trend Following + Pullback et 3 variantes comparables ; activation/désactivation depuis le dashboard.
- **Risque** : 70 € max engagés, 30 € jamais touchés, 0,50 € de risque par trade, 1,50 €/jour et 3 €/semaine de perte max,
  une seule position, aucun levier, refus des trades rendus non pertinents par les frais.
- **Exécution** : simulation réaliste (prix acheteur/vendeur, glissement, frais 0,40 %), anti-doublon, vérification des soldes,
  arrêt d'urgence. Connecteur d'ordres réels Kraken présent mais **verrouillé** (3 verrous + confirmation écrite).
- **Backtesting** : 2 ans d'historique, frais/spread/glissement inclus, séparation entraînement / validation.
- **Analyse IA** : résumé de marché, anomalies, lecture des performances ; commentaire rédigé par Claude en option.
  L'IA n'a aucun accès aux ordres.
- **Dashboard** : mode sombre, graphiques TradingView Lightweight Charts, temps réel par WebSocket, utilisable sur mobile.
- **Tests** : 48 tests automatisés (`dotnet test`).

Configuration : `config/mnbot.json` (paramètres) et `.env` (secrets, à créer depuis `.env.example`).
