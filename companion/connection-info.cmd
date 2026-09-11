@echo off
"%~dp0..\runtime\node.exe" "%~dp0cli.js" info %*
if not "%~1"=="--headless" pause
