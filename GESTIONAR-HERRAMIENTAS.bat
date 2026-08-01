@echo off
setlocal
cd /d "%~dp0"

echo =============================================
echo   GESTIONAR HERRAMIENTAS DE ALVSOL TOOLS
echo =============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar-herramienta.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo preparar la herramienta.
  echo La version que ya funcionaba sigue protegida.
  pause
  exit /b 1
)

call "%~dp0ABRIR-ALVSOL-TOOLS.bat"
echo.
echo Prueba bien la herramienta antes de publicarla.
echo Cuando todo funcione, ejecuta PUBLICAR-ALVSOL-TOOLS.bat.
pause

endlocal
