@echo off
"%~dp0..\runtime\node.exe" "%~dp0cli.js" diagnose %*
if not "%~1"=="--headless" pause
