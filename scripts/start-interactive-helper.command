#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_DIR="$HOME/Library/Application Support/CodexUsage"
TOKEN_FILE="$TOKEN_DIR/sync-token"
SESSION_NAME="${CODEX_USAGE_TMUX_SESSION:-codex-usage-helper}"
PORT="${CODEX_USAGE_SYNC_PORT:-8787}"

mkdir -p "$TOKEN_DIR"
chmod 700 "$TOKEN_DIR"

if [[ ! -s "$TOKEN_FILE" ]]; then
  umask 077
  openssl rand -hex 24 >"$TOKEN_FILE"
fi

chmod 600 "$TOKEN_FILE"

export CODEX_USAGE_SYNC_HOST="${CODEX_USAGE_SYNC_HOST:-0.0.0.0}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required to keep the screenshot-capable helper running."
  exit 1
fi

launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.riverman.codexusage.sync.plist" 2>/dev/null || true
launchctl disable "gui/$(id -u)/com.riverman.codexusage.sync" 2>/dev/null || true

tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

existing_pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$existing_pids" ]]; then
  kill $existing_pids 2>/dev/null || true
  sleep 1
fi

tmux new-session -d -s "$SESSION_NAME" -c "$ROOT_DIR" \
  "env CODEX_USAGE_SYNC_HOST='$CODEX_USAGE_SYNC_HOST' CODEX_USAGE_SYNC_PORT='$PORT' PATH='$PATH' /opt/homebrew/bin/node scripts/sync-server.mjs >>/tmp/codex-usage-sync-helper.log 2>>/tmp/codex-usage-sync-helper.err"

sleep 1

if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "Codex Usage helper is running in tmux session '$SESSION_NAME' on port $PORT."
  echo "Phone refresh polling can now ask this Mac to open and OCR the Codex usage menu."
  echo "Logs: /tmp/codex-usage-sync-helper.log and /tmp/codex-usage-sync-helper.err"
else
  echo "Codex Usage helper did not answer its health check."
  echo "Try: tmux attach -t '$SESSION_NAME'"
  exit 1
fi
