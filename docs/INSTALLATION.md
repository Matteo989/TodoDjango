# Installation

MNBot est un seul programme : le serveur .NET fait tourner le moteur de trading **et** sert le dashboard.
Les données (historique, transactions, journal) sont stockées dans `data/mnbot.db` (SQLite) et les journaux dans `logs/`.

## Option A — VPS Linux (recommandé pour fonctionner 24h/24)

Un petit VPS Ubuntu 22.04/24.04 (1 vCPU, 1 Go de RAM) suffit.

1. Connectez-vous au VPS et récupérez le projet :
   ```bash
   git clone https://github.com/matteo989/MNBot.git
   cd MNBot
   ```
2. Lancez l'installation automatique :
   ```bash
   sudo ./scripts/install-vps.sh
   ```
   Le script installe .NET 8 et Node.js, compile le programme, crée le fichier `.env` et installe un service
   `mnbot` qui démarre automatiquement avec le serveur et redémarre en cas de plantage.
3. Accédez au dashboard depuis **votre ordinateur** grâce à un tunnel SSH (le dashboard n'est volontairement
   pas exposé sur Internet) :
   ```bash
   ssh -L 5080:127.0.0.1:5080 utilisateur@IP_DU_VPS
   ```
   puis ouvrez http://127.0.0.1:5080. Laissez la fenêtre SSH ouverte pendant que vous consultez le dashboard.

Commandes utiles sur le VPS :

```bash
sudo systemctl status mnbot      # état
sudo systemctl restart mnbot     # redémarrer (après une modification de config/mnbot.json)
sudo systemctl stop mnbot        # arrêter le programme
journalctl -u mnbot -f           # journal en direct
```

### Mettre à jour

```bash
cd MNBot
git pull
./scripts/build.sh
sudo systemctl restart mnbot
```

### Accès au dashboard sans tunnel SSH (optionnel)

Si vous voulez ouvrir le dashboard directement par Internet :
1. définissez un mot de passe solide dans `.env` : `MNBOT_DASHBOARD_PASSWORD=...` ;
2. dans `config/mnbot.json`, remplacez `"Urls": "http://127.0.0.1:5080"` par `"http://0.0.0.0:5080"` ;
3. placez idéalement un reverse proxy HTTPS (Caddy, Nginx) devant.

Le programme **refuse de démarrer** s'il écoute sur Internet sans mot de passe.

## Option B — Ordinateur personnel (Linux / macOS)

Prérequis : [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) et [Node.js 18+](https://nodejs.org).

```bash
./scripts/build.sh
./scripts/mnbot.sh start
```

Le bot ne tourne que lorsque l'ordinateur est allumé : pour du 24h/24, préférez un VPS.

Sous Windows, utilisez WSL2 (Ubuntu) et suivez les mêmes commandes.

## Fichiers à connaître

| Fichier | Rôle |
|---|---|
| `config/mnbot.json` | Tous les paramètres (actifs, risque, stratégies, backtest). Redémarrer après modification. |
| `.env` | Secrets : mot de passe du dashboard, clés API. **Jamais** envoyé sur GitHub. |
| `data/mnbot.db` | Base de données (à sauvegarder de temps en temps). |
| `logs/` | Journaux quotidiens, conservés 30 jours. |

## Vérifier l'installation

```bash
dotnet test        # lance les 48 tests automatisés
```
