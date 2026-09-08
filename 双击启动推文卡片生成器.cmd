@echo off
set "APP_DIR=%~dp0"
set "LAUNCHER=%APP_DIR%launch-portable.ps1"

if not exist "%APP_DIR%index.html" (
  echo ERROR: index.html was not found.
  echo Extract or copy the complete folder before launching.
  pause
  exit /b 1
)

if not exist "%LAUNCHER%" (
  echo ERROR: launch-portable.ps1 was not found.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%"
if errorlevel 1 (
  echo.
  echo Launch failed. Please send a screenshot of this window.
  pause
  exit /b 1
)

exit /b 0
