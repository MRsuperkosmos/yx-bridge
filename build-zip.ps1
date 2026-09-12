# YX Bridge
# Copyright 2026 MRsuperkosmos. Created 12 September 2026.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

# Собирает yx-bridge.zip на рабочий стол без node_modules и тестовых артефактов.
$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path

# Safety guard: the extension must contain only its known pages and scripts.
# This blocks any throwaway/test/backdoor page (e.g. an "unpause" helper that clears
# the kill-switch) from ever shipping. Adding a real new page means updating this list.
$extAllowed = @('manifest.json', 'background.js', 'popup.html', 'popup.js', 'stats.html', 'stats.js', 'i18n.js', 'notranslate.js')
$extStray = Get-ChildItem (Join-Path $src 'extension') -File | Where-Object { $_.Extension -in @('.html', '.js', '.json') -and $_.Name -notin $extAllowed }
if ($extStray) { throw ("Refusing to build: unexpected file(s) in the extension folder: " + ($extStray.Name -join ', ') + ". Remove them, or add them to the allowlist in build-zip.ps1.") }

$stage = Join-Path $env:TEMP "yx-bridge-stage\yx-bridge"
if (Test-Path (Split-Path $stage)) { Remove-Item (Split-Path $stage) -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
Get-ChildItem $src -Recurse -File -Force | Where-Object {
  $_.FullName -notmatch '\\node_modules\\' -and
  $_.FullName -notmatch '\\media-test\\' -and
  $_.Name -ne '.token' -and
  $_.Name -notlike '*.bak*' -and
  $_.Extension -notin @('.pdf', '.jpg') -and
  -not ($_.Extension -eq '.png' -and $_.DirectoryName -notmatch '\\extension$')
} | ForEach-Object {
  $rel = $_.FullName.Substring($src.Length).TrimStart('\')
  $dst = Join-Path $stage $rel
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Copy-Item $_.FullName $dst
}
$zip = Join-Path ([Environment]::GetFolderPath('Desktop')) 'yx-bridge.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead($zip)
"entries: $($z.Entries.Count)  bytes: $((Get-Item $zip).Length)"
$z.Entries | Sort-Object Length -Descending | Select-Object -First 5 FullName, Length | Format-Table -AutoSize
$z.Dispose()
