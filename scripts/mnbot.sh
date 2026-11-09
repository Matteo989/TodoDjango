#!/usr/bin/env bash
# Pilotage simple du bot sans systemd : start | stop | restart | status | logs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/data/mnbot.pid"
OUT="$ROOT/logs/console.log"
export MNBOT_HOME="$ROOT"
[ -x "$HOME/.dotnet/dotnet" ] && export PATH="$HOME/.dotnet:$PATH"
mkdir -p "$ROOT/data" "$ROOT/logs"

running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "MNBot tourne déjà (PID $(cat "$PID_FILE"))."; exit 0; fi
    [ -f "$ROOT/publish/MNBot.Api.dll" ] || { echo "Programme non compilé : lancez d'abord ./scripts/build.sh"; exit 1; }
    cd "$ROOT"
    nohup dotnet "$ROOT/publish/MNBot.Api.dll" >> "$OUT" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 4
    if running; then echo "MNBot démarré (PID $(cat "$PID_FILE")). Dashboard : http://127.0.0.1:5080"; else echo "Échec du démarrage :"; tail -n 20 "$OUT"; exit 1; fi
    ;;
  stop)
    if running; then kill "$(cat "$PID_FILE")"; sleep 3; rm -f "$PID_FILE"; echo "MNBot arrêté."; else echo "MNBot n'est pas en marche."; fi
    ;;
  restart) "$0" stop; "$0" start ;;
  status)
    if running; then echo "MNBot en marche (PID $(cat "$PID_FILE"))."; else echo "MNBot arrêté."; fi
    ;;
  logs) tail -n 100 -f "$OUT" ;;
  *) echo "Usage : $0 {start|stop|restart|status|logs}"; exit 1 ;;
esac
