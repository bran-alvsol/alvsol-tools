@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\desktop\scripts\crear-paquete-pc-principal.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo crear el paquete.
  pause
  exit /b 1
)
echo.
echo Paquete preparado correctamente.
pause
