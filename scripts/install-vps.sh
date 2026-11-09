#!/usr/bin/env bash
# Installation complète sur un VPS Ubuntu/Debian : dépendances, compilation, service systemd.
# Usage (depuis le dossier MNBot) :  sudo ./scripts/install-vps.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }

echo "==> Paquets système"
apt-get update -y
apt-get install -y curl ca-certificates nodejs npm libicu-dev

if ! command -v dotnet >/dev/null 2>&1; then
  echo "==> Installation de .NET 8"
  curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 8.0 --install-dir /opt/dotnet
  ln -sf /opt/dotnet/dotnet /usr/local/bin/dotnet
fi

echo "==> Compilation"
sudo -u "$RUN_USER" bash "$ROOT/scripts/build.sh"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  chown "$RUN_USER" "$ROOT/.env"
fi
chmod 600 "$ROOT/.env"
mkdir -p "$ROOT/data" "$ROOT/logs" && chown -R "$RUN_USER" "$ROOT/data" "$ROOT/logs"

echo "==> Service systemd"
sed -e "s#__ROOT__#$ROOT#g" -e "s#__USER__#$RUN_USER#g" -e "s#__DOTNET__#$(command -v dotnet)#g" \
  "$ROOT/deploy/mnbot.service" > /etc/systemd/system/mnbot.service
systemctl daemon-reload
systemctl enable --now mnbot
sleep 5
systemctl --no-pager status mnbot | head -n 12
echo
echo "MNBot est installé et démarre automatiquement avec le serveur."
echo "Dashboard (depuis votre ordinateur) : ssh -L 5080:127.0.0.1:5080 $RUN_USER@IP_DU_VPS  puis http://127.0.0.1:5080"
