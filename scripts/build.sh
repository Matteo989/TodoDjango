#!/usr/bin/env bash
# Compile le dashboard (React) puis le serveur (.NET) dans le dossier publish/.
set -euo pipefail
cd "$(dirname "$0")/.."
export DOTNET_CLI_TELEMETRY_OPTOUT=1
[ -x "$HOME/.dotnet/dotnet" ] && export PATH="$HOME/.dotnet:$PATH"

echo "==> Dashboard"
(cd dashboard && npm ci --no-audit --no-fund && npm run build)

echo "==> Serveur"
dotnet publish src/MNBot.Api -c Release -o publish --nologo

echo "==> Terminé. Lancez : ./scripts/mnbot.sh start"
