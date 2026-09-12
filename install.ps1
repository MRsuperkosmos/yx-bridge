# YX Bridge
# Copyright 2026 MRsuperkosmos. Created 12 September 2026.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

# Установка MCP-сервера в Claude Code (Windows). Запуск: правой кнопкой -> Run with PowerShell,
# либо в терминале:  powershell -ExecutionPolicy Bypass -File install.ps1
# "Continue": in PowerShell 5.1 a native program writing to stderr under 2>$null would otherwise abort the script.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root "server\src\server.js"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js не найден. Установите с https://nodejs.org (LTS) и запустите скрипт снова." -ForegroundColor Red
  exit 1
}

Write-Host "1/3 npm install..." -ForegroundColor Cyan
Push-Location (Join-Path $root "server")
npm install --no-audit --no-fund
Pop-Location

Write-Host "2/3 Регистрация MCP в Claude Code..." -ForegroundColor Cyan
if (Get-Command claude -ErrorAction SilentlyContinue) {
  claude mcp remove yx-bridge -s user 2>$null | Out-Null
  claude mcp add yx-bridge -s user -- node "$server"
  if ($LASTEXITCODE -ne 0) { Write-Host "   claude mcp add завершился с ошибкой (см. вывод выше); можно прописать вручную, см. README" -ForegroundColor Yellow }
} else {
  # Claude CLI нет в PATH — правим ~/.claude.json напрямую
  $cfg = Join-Path $env:USERPROFILE ".claude.json"
  $j = if (Test-Path $cfg) { Get-Content $cfg -Raw -Encoding utf8 | ConvertFrom-Json } else { [pscustomobject]@{} }
  if (-not $j.mcpServers) { $j | Add-Member -MemberType NoteProperty -Name mcpServers -Value ([pscustomobject]@{}) }
  $entry = [pscustomobject]@{ type = "stdio"; command = "node"; args = @($server); env = [pscustomobject]@{} }
  if ($j.mcpServers.PSObject.Properties["yx-bridge"]) { $j.mcpServers."yx-bridge" = $entry }
  else { $j.mcpServers | Add-Member -MemberType NoteProperty -Name "yx-bridge" -Value $entry }
  # UTF-8 without BOM: Node/Claude Code cannot parse a JSON file that starts with a BOM.
  [IO.File]::WriteAllText($cfg, ($j | ConvertTo-Json -Depth 50), (New-Object System.Text.UTF8Encoding $false))
  Write-Host "   записано в $cfg"
}

Write-Host "3/3 Самопроверка..." -ForegroundColor Cyan
Push-Location (Join-Path $root "server")
node src/selftest.js
Pop-Location

Write-Host ""
Write-Host "Готово. Осталось загрузить расширение в браузер:" -ForegroundColor Green
Write-Host "  1) открыть chrome://extensions (в Яндекс Браузере набрать именно так: browser://extensions откроет каталог)"
Write-Host "  2) включить «Режим разработчика»"
Write-Host "  3) «Загрузить распакованное расширение» -> папка:"
Write-Host "     $(Join-Path $root 'extension')"
Write-Host "  4) перезапустить Claude Code"
