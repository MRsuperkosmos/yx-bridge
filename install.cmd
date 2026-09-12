@echo off
rem YX Bridge — полностью автоматическая установка. Двойной клик.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-YXBridge.ps1" %*
