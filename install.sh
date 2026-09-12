#!/usr/bin/env bash
# YX Bridge
# Copyright 2026 MRsuperkosmos. Created 12 September 2026.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

# Установка MCP-сервера в Claude Code (macOS / Linux). Запуск: bash install.sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER="$ROOT/server/src/server.js"

command -v node >/dev/null || { echo "Node.js не найден: https://nodejs.org"; exit 1; }

echo "1/3 npm install..."
(cd "$ROOT/server" && npm install --no-audit --no-fund)

echo "2/3 Регистрация MCP в Claude Code..."
if command -v claude >/dev/null; then
  claude mcp remove yx-bridge -s user >/dev/null 2>&1 || true
  claude mcp add yx-bridge -s user -- node "$SERVER"
else
  echo "   claude CLI не найден. Добавьте в ~/.claude.json вручную:"
  echo "   \"yx-bridge\": {\"type\":\"stdio\",\"command\":\"node\",\"args\":[\"$SERVER\"]}"
fi

echo "3/3 Самопроверка..."
(cd "$ROOT/server" && node src/selftest.js)

echo
echo "Готово. Загрузите расширение: browser://extensions -> Режим разработчика ->"
echo "Загрузить распакованное расширение -> $ROOT/extension, затем перезапустите Claude Code."
