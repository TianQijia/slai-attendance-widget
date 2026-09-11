@echo off
"%~dp0..\runtime\node.exe" "%~dp0cli.js" stop %*
if not "%~1"=="--headless" pause
