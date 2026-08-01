@echo off
setlocal
cd /d "%~dp0"

echo =============================================
echo   PUBLICAR ACTUALIZACION APROBADA
echo =============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publicar-actualizacion.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo publicar la actualizacion.
  pause
  exit /b 1
)

pause
endlocal
