@echo off
if not exist "%~dp0..\runtime\node.exe" (
  echo RUNTIME_MISSING ^| Stage: launcher ^| Bundled runtime/node.exe was not found.
  echo Download the Windows companion ZIP ^(win-x64^) from https://github.com/TianQijia/slai-attendance-widget/releases/latest
  echo Extract the entire ZIP. Keep companion and runtime next to each other, then run companion\start.cmd.
  echo For source development, install Node.js 22+, run npm ci, then npm run start:companion from the repository root.
  if not "%~1"=="--headless" pause
  exit /b 1
)
"%~dp0..\runtime\node.exe" "%~dp0cli.js" start %*
if not "%~1"=="--headless" pause
