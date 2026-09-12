# YX Bridge
# Copyright 2026 MRsuperkosmos. Created 12 September 2026.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
#
# Полностью автоматическая установка (Windows):
#   1. Node.js (ставится через winget, если нет)
#   2. зависимости сервера (npm install)
#   3. регистрация MCP-сервера в Claude Code (~/.claude.json)
#   4. загрузка расширения в Яндекс Браузер / Chrome / Edge через UI Automation
#      (открывает chrome://extensions в НОВОМ окне, включает режим разработчика,
#       нажимает «Загрузить распакованное расширение», вводит путь, подтверждает)
#   5. проверка связи расширение ⇄ сервер
# Запуск: двойной клик по install.cmd, либо
#   powershell -ExecutionPolicy Bypass -File Install-YXBridge.ps1 [-Browser yandex|chrome|edge] [-NoBrowser]
param(
  [ValidateSet("auto", "yandex", "chrome", "edge")][string]$Browser = "auto",
  [switch]$NoBrowser,     # только сервер + регистрация, расширение не трогать
  [switch]$NoNode         # не пытаться ставить Node.js
)
# "Continue", not "Stop": in Windows PowerShell 5.1 a native program (claude, node, npm) writing to
# stderr under 2>$null / 2>&1 becomes a terminating error and would abort the whole install.
# Every important step below checks its own result explicitly instead.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ext = Join-Path $root "extension"
$server = Join-Path $root "server\src\server.js"
$uia = Join-Path $root "server\src\uia.ps1"
$log = @()
function Step($n, $msg) { Write-Host ""; Write-Host "[$n] $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    ✓ $msg" -ForegroundColor Green; $script:log += "OK  $msg" }
function Warn($msg) { Write-Host "    ! $msg" -ForegroundColor Yellow; $script:log += "WARN $msg" }
function Fail($msg) { Write-Host "    ✗ $msg" -ForegroundColor Red; $script:log += "FAIL $msg" }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

Write-Host "YX Bridge — установка" -ForegroundColor White
Write-Host "Папка: $root"
if ($root -match '\\Temp\\|\\AppData\\Local\\Temp') { Warn "Похоже, архив запущен прямо из временной папки. Распакуйте его в постоянное место (например C:\tools\yx-bridge) и запустите снова: путь прописывается в браузер и в Claude Code." ; Read-Host "Enter для выхода" | Out-Null; exit 1 }

# ---------------------------------------------------------------- 1. Node.js
Step 1 "Node.js"
RefreshPath
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node -and -not $NoNode) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "    Node.js не найден, ставлю через winget (может занять пару минут)…"
    & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent | Out-Null
    RefreshPath
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
}
if (-not $node) { Fail "Node.js не установлен. Скачайте LTS с https://nodejs.org и запустите установщик снова."; Read-Host "Enter для выхода" | Out-Null; exit 1 }
Ok "node $(& node --version)"

# ---------------------------------------------------------------- 2. npm install
Step 2 "Зависимости сервера"
Push-Location (Join-Path $root "server")
& npm install --omit=dev --no-audit --no-fund --loglevel=error
Pop-Location
if (Test-Path (Join-Path $root "server\node_modules\ws")) { Ok "npm install" } else { Fail "npm install не удался"; exit 1 }

# ---------------------------------------------------------------- 3. Claude Code
Step 3 "Регистрация MCP в Claude Code"
$claude = Get-Command claude -ErrorAction SilentlyContinue
$registered = $false
if ($claude) {
  & claude mcp remove yx-bridge -s user 2>$null | Out-Null
  & claude mcp add yx-bridge -s user -- node "$server" 2>&1 | Out-Null
  $registered = $LASTEXITCODE -eq 0
}
if (-not $registered) {
  $cfg = Join-Path $env:USERPROFILE ".claude.json"
  try {
    $j = if (Test-Path $cfg) { Get-Content $cfg -Raw -Encoding utf8 | ConvertFrom-Json } else { [pscustomobject]@{} }
    if (-not $j.PSObject.Properties["mcpServers"]) { $j | Add-Member -MemberType NoteProperty -Name mcpServers -Value ([pscustomobject]@{}) }
    $entry = [pscustomobject]@{ type = "stdio"; command = "node"; args = @($server); env = [pscustomobject]@{} }
    if ($j.mcpServers.PSObject.Properties["yx-bridge"]) { $j.mcpServers."yx-bridge" = $entry } else { $j.mcpServers | Add-Member -MemberType NoteProperty -Name "yx-bridge" -Value $entry }
    if (Test-Path $cfg) { Copy-Item $cfg "$cfg.bak-yx-bridge" -Force }
    # UTF-8 without BOM: Node/Claude Code cannot parse a JSON file that starts with a BOM.
    [IO.File]::WriteAllText($cfg, ($j | ConvertTo-Json -Depth 60), (New-Object System.Text.UTF8Encoding $false))
    $registered = $true
  } catch { Fail "не удалось записать $cfg : $_" }
}
if ($registered) { Ok "сервер yx-bridge прописан в Claude Code (вступит в силу после перезапуска Claude Code)" }
# Подсказка для других агентов
$other = @()
if (Test-Path (Join-Path $env:USERPROFILE ".cursor")) { $other += "Cursor: ~/.cursor/mcp.json" }
if (Test-Path (Join-Path $env:USERPROFILE ".config\opencode")) { $other += "OpenCode: ~/.config/opencode/opencode.json" }
if (Test-Path (Join-Path $env:USERPROFILE ".codex")) { $other += "Codex: ~/.codex/config.toml" }
if ($other) { Warn ("найдены другие агенты, для них команда та же: node `"$server`" — " + ($other -join "; ")) }

# ---------------------------------------------------------------- 4. Расширение
Step 4 "Расширение в браузере"
$browsers = @(
  @{ key = "yandex"; name = "Яндекс Браузер"; proc = "browser"; exe = @("$env:ProgramFiles\Yandex\YandexBrowser\Application\browser.exe", "${env:ProgramFiles(x86)}\Yandex\YandexBrowser\Application\browser.exe", "$env:LOCALAPPDATA\Yandex\YandexBrowser\Application\browser.exe") },
  @{ key = "chrome"; name = "Google Chrome"; proc = "chrome"; exe = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
  @{ key = "edge"; name = "Microsoft Edge"; proc = "msedge"; exe = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") }
)
$target = $null
foreach ($b in $browsers) {
  if ($Browser -ne "auto" -and $b.key -ne $Browser) { continue }
  $found = $b.exe | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($found) { $target = $b; $target.path = $found; break }
}
if ($NoBrowser) { Warn "пропущено по -NoBrowser" }
elseif (-not $target) { Fail "браузер не найден (Яндекс/Chrome/Edge)" }
else {
  Write-Host "    браузер: $($target.name)"
  $extPage = if ($target.key -eq "edge") { "edge://extensions" } else { "chrome://extensions" }
  # Новое окно, чтобы не мешать открытым вкладкам пользователя
  Start-Process $target.path -ArgumentList "--new-window", $extPage | Out-Null
  Start-Sleep -Seconds 4
  $chain = {
    param($steps, $timeout)
    $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File $uia chain -Steps $steps -TimeoutMs $timeout -ProcessName $target.proc -IncludeWeb 2>$null
    try { return ($raw | Out-String | ConvertFrom-Json) } catch { return @() }
  }
  $NAME = '^YX Bridge$'
  $DEV = '^(Режим разработчика|Developer mode)$'
  $LOAD = '^(Загрузить распакованное расширение|Load unpacked)$'
  $PICK = '^(Выбор папки|Select Folder)$'
  # уже установлено?
  $have = & $chain "wait:^(Расширения|Extensions)$;list:$NAME" 15000
  $present = ($have | Where-Object { $_.step -like "list:*" } | ForEach-Object { $_.found } | Where-Object { $_.type -eq "Text" }).Count -gt 0
  if ($present) { Ok "расширение YX Bridge уже загружено в браузер" }
  else {
    $r = & $chain "wait:$DEV;list:$DEV" 15000
    $toggle = $r | Where-Object { $_.step -like "list:*" } | ForEach-Object { $_.found } | Where-Object { $_.type -eq "Button" } | Select-Object -First 1
    if ($toggle -and $toggle.checked -ne $true) { & $chain "click:$DEV;sleep:800" 8000 | Out-Null; Write-Host "    включил режим разработчика" }
    $r = & $chain "click:$LOAD;wait:^1152$;sleep:400;set:^1152$=$ext;sleep:300;click:$PICK;sleep:3000;list:$NAME" 15000
    $loaded = ($r | Where-Object { $_.step -like "list:*" } | ForEach-Object { $_.found } | Where-Object { $_.type -eq "Text" }).Count -gt 0
    if ($loaded) { Ok "расширение загружено автоматически" }
    else {
      Fail "автоматическая загрузка не удалась. Вручную: $extPage → «Режим разработчика» → «Загрузить распакованное расширение» → папка:`n      $ext"
      & $chain "click:^(Отмена|Cancel)$" 2000 | Out-Null
    }
  }
  # Закрыть служебное окно (только если в нём одна вкладка — та, что мы открыли)
  try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -Name WinMsg -Namespace CB -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);'
    $ids = @((Get-Process $target.proc -ErrorAction SilentlyContinue).Id)
    $rootEl = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($w in $rootEl.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
      $c = $w.Current
      if ($ids -notcontains $c.ProcessId -or $c.ClassName -notmatch 'WidgetWin' -or $c.Name -notmatch 'Расширения|Extensions') { continue }
      $tabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)))
      if ($tabs.Count -le 1) { [void][CB.WinMsg]::PostMessage([IntPtr]$c.NativeWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); Write-Host "    служебное окно закрыто"; break }
    }
  } catch {}
}

# ---------------------------------------------------------------- 5. Проверка связи
Step 5 "Проверка связи расширение ⇄ сервер"
Push-Location (Join-Path $root "server")
$ping = & node src/cli.js ping 2>$null | Out-String
Pop-Location
if ($ping -match '"pong": true') { Ok ("расширение отвечает, версия " + ($ping | Select-String -Pattern '"version": "([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value })) }
else { Warn "расширение не ответило за 20 с. Если Claude Code уже запущен, порт занят им — это нормально. Иначе после перезапуска Claude Code посмотрите на кружок в углу иконки-лампочки: зелёный = подключено." }

Write-Host ""
Write-Host "Готово. Перезапустите Claude Code — появятся инструменты browser_*." -ForegroundColor Green
Write-Host "Отчёт:"; $log | ForEach-Object { "  $_" }
if (-not $env:YX_BRIDGE_NOPAUSE) { Read-Host "Enter для выхода" | Out-Null }
