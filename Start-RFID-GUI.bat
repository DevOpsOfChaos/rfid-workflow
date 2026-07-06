@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-RFID-GUI.ps1"
if errorlevel 1 pause
exit
