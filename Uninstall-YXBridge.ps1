# YX Bridge
# Copyright 2026 MRsuperkosmos. Created 12 September 2026.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
#
# Удаление: снимает регистрацию MCP в Claude Code и удаляет расширение из браузера
# через UI Automation (карточка → «Удалить» → подтверждение). Файлы проекта не трогает.
param([ValidateSet("auto", "yandex", "chrome", "edge")][string]$Browser = "auto", [switch]$NoBrowser)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$uia = Join-Path $root "server\src\uia.ps1"
function Ok($m) { Write-Host "  ✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

Write-Host "YX Bridge — удаление" -ForegroundColor White
# 1. Claude Code
$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) { & claude mcp remove yx-bridge -s user 2>$null | Out-Null }
$cfg = Join-Path $env:USERPROFILE ".claude.json"
if (Test-Path $cfg) {
  try {
    $j = Get-Content $cfg -Raw -Encoding utf8 | ConvertFrom-Json
    if ($j.mcpServers -and $j.mcpServers.PSObject.Properties["yx-bridge"]) { $j.mcpServers.PSObject.Properties.Remove("yx-bridge"); $j | ConvertTo-Json -Depth 60 | Set-Content $cfg -Encoding utf8 }
    Ok "регистрация в Claude Code снята"
  } catch { Warn "не удалось править $cfg : $_" }
}

# 2. Расширение
if ($NoBrowser) { Warn "браузер пропущен"; exit 0 }
$browsers = @(
  @{ key = "yandex"; proc = "browser"; exe = @("$env:ProgramFiles\Yandex\YandexBrowser\Application\browser.exe", "${env:ProgramFiles(x86)}\Yandex\YandexBrowser\Application\browser.exe", "$env:LOCALAPPDATA\Yandex\YandexBrowser\Application\browser.exe") },
  @{ key = "chrome"; proc = "chrome"; exe = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
  @{ key = "edge"; proc = "msedge"; exe = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") }
)
$target = $null
foreach ($b in $browsers) { if ($Browser -ne "auto" -and $b.key -ne $Browser) { continue }; $f = $b.exe | Where-Object { Test-Path $_ } | Select-Object -First 1; if ($f) { $target = $b; $target.path = $f; break } }
if (-not $target) { Warn "браузер не найден"; exit 0 }
$extPage = if ($target.key -eq "edge") { "edge://extensions" } else { "chrome://extensions" }
Start-Process $target.path -ArgumentList "--new-window", $extPage | Out-Null
Start-Sleep -Seconds 4
function Chain($steps, $timeout = 10000, $web = $true) {
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $uia, "chain", "-Steps", $steps, "-TimeoutMs", $timeout, "-ProcessName", $target.proc)
  if ($web) { $args += "-IncludeWeb" }
  $raw = & powershell @args 2>$null
  try { return ($raw | Out-String | ConvertFrom-Json) } catch { return @() }
}
$r = Chain 'wait:^(Расширения|Extensions)$;list:^YX Bridge$;list:^(Удалить|Remove)$' 15000
$names = $r | Where-Object { $_.step -eq 'list:^YX Bridge$' } | ForEach-Object { $_.found } | Where-Object { $_.type -eq "Text" }
$removes = $r | Where-Object { $_.step -like 'list:^(Удалить*' } | ForEach-Object { $_.found } | Where-Object { $_.type -eq "Button" }
if (-not $names) { Ok "расширение в браузере не найдено (уже удалено)"; exit 0 }
# кнопка «Удалить» той же карточки: ближайшая ниже названия в той же колонке
$name = $names[0]
$btn = $removes | Where-Object { [Math]::Abs($_.x - $name.x) -lt 400 -and $_.y -gt $name.y -and $_.y - $name.y -lt 500 } | Sort-Object y | Select-Object -First 1
if (-not $btn) { Warn "не нашёл кнопку «Удалить» у карточки; удалите вручную на $extPage"; exit 1 }
$idx = [Array]::IndexOf(@($removes | ForEach-Object { "$($_.x),$($_.y)" }), "$($btn.x),$($btn.y)")
Chain "click:^(Удалить|Remove)$#$idx;sleep:900" 8000 | Out-Null
# подтверждение — нативный диалог браузера (без веб-элементов)
Chain 'click:^(Удалить|Remove)$;sleep:2500' 8000 $false | Out-Null
$check = Chain 'list:^YX Bridge$' 5000
$still = ($check | ForEach-Object { $_.found } | Where-Object { $_.type -eq "Text" }).Count
if ($still -eq 0) { Ok "расширение удалено из браузера" } else { Warn "расширение всё ещё в списке; подтвердите удаление вручную" }
Write-Host "Готово. Папку проекта можно удалить вручную." -ForegroundColor Green
if (-not $env:CLAUDE_BRIDGE_NOPAUSE) { Read-Host "Enter для выхода" | Out-Null }
