@echo off
setlocal
cd /d "%~dp0"

echo =============================================
echo   PREPARAR ACTUALIZACION DE HERRAMIENTA
echo =============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar-herramienta.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo preparar la actualizacion.
  pause
  exit /b 1
)

call "%~dp0ABRIR-ALVSOL-TOOLS.bat"
echo.
echo Prueba la nueva version con reportes reales.
echo Cuando todo funcione, ejecuta PUBLICAR-ALVSOL-TOOLS.bat.
pause

endlocal
