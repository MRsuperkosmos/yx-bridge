@echo off
rem YX Bridge — удаление регистрации и расширения. Двойной клик.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-YXBridge.ps1" %*
