@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\PREPARAR-ESTA-COMPUTADORA.ps1"
if errorlevel 1 (
  echo.
  echo La preparacion no pudo completarse. Revisa el mensaje anterior.
  pause
  exit /b 1
)
echo.
echo La computadora principal quedo preparada.
pause
