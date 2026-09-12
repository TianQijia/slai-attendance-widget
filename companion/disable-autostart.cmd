@echo off
"%~dp0..\runtime\node.exe" "%~dp0cli.js" remove-autostart %*
if not "%~1"=="--headless" pause
