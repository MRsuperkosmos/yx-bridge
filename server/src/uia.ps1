# YX Bridge
# Copyright 2026 MRsuperkosmos. Created 12 September 2026.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

# UI Automation helper for the browser's own chrome (toolbar buttons, bubbles, menus).
# Usage:
#   uia.ps1 list  [-Pattern regex] [-Max N]          list matching elements in browser windows + popups
#   uia.ps1 click -Pattern regex [-Index 0]          invoke/toggle/select or click the element center
#   uia.ps1 wait  -Pattern regex [-TimeoutMs 5000]   wait until an element matching appears
# Output: JSON lines.
param(
  [Parameter(Position = 0)][ValidateSet("list", "click", "wait", "chain")][string]$Cmd = "list",
  [string]$Steps = "",         # chain: "click:regex[#idx];wait:regex;list:regex;sleep:ms;key:ESC" separated by ';'
  [string]$Pattern = ".",
  [int]$Index = 0,
  [int]$Max = 5000,
  [int]$TimeoutMs = 5000,
  [string]$ProcessName = "browser",
  [string]$Then = "",          # click: after clicking, wait and list elements matching this regex
  [int]$ThenDelayMs = 700,
  [switch]$IncludeWeb
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class U32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
}
"@
[void][U32]::SetProcessDPIAware()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ids = @((Get-Process $ProcessName -ErrorAction SilentlyContinue).Id)
if (-not $ids.Count) { Write-Output (@{ error = "process $ProcessName not running" } | ConvertTo-Json -Compress); exit 2 }
$root = [System.Windows.Automation.AutomationElement]::RootElement
$TS = [System.Windows.Automation.TreeScope]
$TRUE_COND = [System.Windows.Automation.Condition]::TrueCondition

function Get-BrowserWindows {
  $out = @()
  foreach ($w in $root.FindAll($TS::Children, $TRUE_COND)) {
    $c = $w.Current
    if ($ids -contains $c.ProcessId) { $out += $w }
  }
  return $out
}

function Describe($e, $win) {
  $c = $e.Current
  $r = $c.BoundingRectangle
  if ($r.IsEmpty -or [double]::IsInfinity($r.Width)) { $r = New-Object System.Windows.Rect 0, 0, 0, 0 }
  $t = if ($c.ControlType) { $c.ControlType.ProgrammaticName.Replace('ControlType.', '') } else { "?" }
  $checked = $null
  try { $tp = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $checked = ($tp.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) } catch {}
  [pscustomobject]@{
    type   = $t
    checked = $checked
    name   = $c.Name
    id     = $c.AutomationId
    class  = $c.ClassName
    window = $win.Current.Name
    x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height
    enabled = $c.IsEnabled
  }
}

function Is-WebElement($e) {
  # web content lives under a Document (RootWebArea); we skip it unless -IncludeWeb
  $c = $e.Current
  if ($c.AutomationId -eq "RootWebArea") { return $true }
  return $false
}

function Find-Matches {
  $found = @()
  foreach ($w in Get-BrowserWindows) {
    $n = 0
    $webWalker = @{}
    foreach ($e in $w.FindAll($TS::Descendants, $TRUE_COND)) {
      $n++; if ($n -gt $Max) { break }
      $c = $e.Current
      if (-not $IncludeWeb) {
        # heuristics: browser views have AutomationId like view_NNN or a Views class; web nodes have CSS-ish classes or none
        $isChrome = ($c.AutomationId -match '^view_') -or ($c.ClassName -match '^[A-Z][A-Za-z:_]*$' -and $c.ClassName -ne '')
        if (-not $isChrome) { continue }
      }
      if ($Pattern -eq '*' -or ($c.Name -replace "`n", " ") -match $Pattern -or $c.AutomationId -match $Pattern -or $c.ClassName -match $Pattern) {
        $found += [pscustomobject]@{ el = $e; win = $w }
      }
    }
  }
  return $found
}

function Click-Element($e) {
  $how = $null
  try { $p = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $p.Invoke(); $how = "invoke" } catch {}
  if (-not $how -and $e.Current.ClassName -eq "Button") {
    # native Win32 button (dialogs): BM_CLICK to its HWND, no focus/mouse needed
    $h = [IntPtr]$e.Current.NativeWindowHandle
    if ($h -ne [IntPtr]::Zero) { [void][U32]::SendMessage($h, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); $how = "bm_click" }
  }
  if (-not $how) { try { $p = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $p.Toggle(); $how = "toggle" } catch {} }
  if (-not $how) { try { $p = $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); $p.Select(); $how = "select" } catch {} }
  if (-not $how) {
    $r = $e.Current.BoundingRectangle
    if ($r.Width -gt 0) { [U32]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)); $how = "mouse" }
  }
  return $how
}

switch ($Cmd) {
  "chain" {
    $results = @()
    foreach ($step in ($Steps -split ';')) {
      if (-not $step.Trim()) { continue }
      $parts = $step.Split(':', 2)
      $action = $parts[0].Trim().ToLower()
      $arg = if ($parts.Count -gt 1) { $parts[1] } else { "" }
      $idx = 0
      if ($arg -match '^(.*)#(\d+)$') { $arg = $Matches[1]; $idx = [int]$Matches[2] }
      switch ($action) {
        "sleep" { Start-Sleep -Milliseconds ([int]$arg); $results += @{ step = $step; ok = $true } }
        "shot" {
          Add-Type -AssemblyName System.Drawing
          $sb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
          $bmp = New-Object System.Drawing.Bitmap $sb.Width, $sb.Height
          $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
          $bmp.Save($arg, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
          $results += @{ step = $step; ok = $true; file = $arg }
        }
        "set" {
          # set:<regex>=<value> — ValuePattern.SetValue on the first matching element (text fields, file dialogs)
          $eq = $arg.IndexOf('=')
          $Pattern = $arg.Substring(0, $eq); $val = $arg.Substring($eq + 1)
          $t0 = Get-Date; $m = @()
          do { $m = @(Find-Matches); if ($m.Count) { break }; Start-Sleep -Milliseconds 150 } while (((Get-Date) - $t0).TotalMilliseconds -lt $TimeoutMs)
          if (-not $m.Count) { $results += @{ step = $step; ok = $false; error = "no match" }; break }
          $done = $false
          try {
            $vp = $m[0].el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $vp.SetValue($val); $done = "valuepattern"
          } catch {}
          if (-not $done) {
            # native controls (file dialogs): WM_SETTEXT straight to the HWND, works without focus
            $h = [IntPtr]$m[0].el.Current.NativeWindowHandle
            if ($h -ne [IntPtr]::Zero) { [void][U32]::SendMessage($h, 0x000C, [IntPtr]::Zero, [string]$val); $done = "wm_settext" }
          }
          if (-not $done) {
            try { $m[0].el.SetFocus() } catch {}
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait("^a"); [System.Windows.Forms.SendKeys]::SendWait($val -replace '([+^%~(){}\[\]])', '{$1}')
            $done = "sendkeys"
          }
          $results += @{ step = $step; ok = $true; via = $done; target = (Describe $m[0].el $m[0].win) }
          Start-Sleep -Milliseconds 200
        }
        "mouse" {
          $xy = $arg -split ','
          [U32]::Click([int]$xy[0], [int]$xy[1])
          $results += @{ step = $step; ok = $true }
          Start-Sleep -Milliseconds 400
        }
        "key" {
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.SendKeys]::SendWait("{" + $arg.Trim('{}') + "}")
          $results += @{ step = $step; ok = $true }
        }
        "wait" {
          $Pattern = $arg; $t0 = Get-Date; $m = @()
          do { $m = @(Find-Matches); if ($m.Count) { break }; Start-Sleep -Milliseconds 150 } while (((Get-Date) - $t0).TotalMilliseconds -lt $TimeoutMs)
          $results += @{ step = $step; ok = ($m.Count -gt 0); found = @($m | ForEach-Object { Describe $_.el $_.win }) }
          if (-not $m.Count) { break }
        }
        "list" {
          $Pattern = $arg; $m = @(Find-Matches)
          $results += @{ step = $step; ok = $true; found = @($m | ForEach-Object { Describe $_.el $_.win }) }
        }
        "click" {
          $Pattern = $arg; $t0 = Get-Date; $m = @()
          do { $m = @(Find-Matches); if ($m.Count -gt $idx) { break }; Start-Sleep -Milliseconds 150 } while (((Get-Date) - $t0).TotalMilliseconds -lt $TimeoutMs)
          if ($m.Count -le $idx) { $results += @{ step = $step; ok = $false; error = "no match (found $($m.Count))" }; break }
          $how = Click-Element $m[$idx].el
          $d = Describe $m[$idx].el $m[$idx].win
          $results += @{ step = $step; ok = $true; clicked = $how; target = $d }
          Start-Sleep -Milliseconds 400
        }
        default { $results += @{ step = $step; ok = $false; error = "unknown action" }; break }
      }
    }
    $results | ConvertTo-Json -Compress -Depth 5
  }
  "list" {
    $m = @(Find-Matches)
    $m | ForEach-Object { Describe $_.el $_.win } | ConvertTo-Json -Compress -Depth 3
    if (-not $m.Count) { Write-Output "[]" }
  }
  "wait" {
    $t0 = Get-Date
    do {
      $m = @(Find-Matches)
      if ($m.Count) { $m | ForEach-Object { Describe $_.el $_.win } | ConvertTo-Json -Compress -Depth 3; exit 0 }
      Start-Sleep -Milliseconds 200
    } while (((Get-Date) - $t0).TotalMilliseconds -lt $TimeoutMs)
    Write-Output (@{ error = "timeout waiting for $Pattern" } | ConvertTo-Json -Compress); exit 3
  }
  "click" {
    $m = @(Find-Matches)
    if ($m.Count -le $Index) { Write-Output (@{ error = "no match for $Pattern (found $($m.Count))" } | ConvertTo-Json -Compress); exit 4 }
    $e = $m[$Index].el
    $d = Describe $e $m[$Index].win
    $how = $null
    try { $p = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $p.Invoke(); $how = "invoke" } catch {}
    if (-not $how) { try { $p = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $p.Toggle(); $how = "toggle" } catch {} }
    if (-not $how) { try { $p = $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); $p.Select(); $how = "select" } catch {} }
    if (-not $how) {
      $r = $e.Current.BoundingRectangle
      if ($r.Width -gt 0) { [U32]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)); $how = "mouse" }
    }
    $d | Add-Member -NotePropertyName clicked -NotePropertyValue $how
    $d | ConvertTo-Json -Compress -Depth 3
    if ($Then) {
      Start-Sleep -Milliseconds $ThenDelayMs
      $Pattern = $Then
      $m2 = @(Find-Matches)
      Write-Output "THEN:"
      if ($m2.Count) { $m2 | ForEach-Object { Describe $_.el $_.win } | ConvertTo-Json -Compress -Depth 3 } else { Write-Output "[]" }
    }
  }
}
