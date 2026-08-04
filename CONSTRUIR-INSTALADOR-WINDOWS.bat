@echo off
setlocal
cd /d "%~dp0desktop"
if not exist node_modules (
  echo Instalando componentes necesarios...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run dist
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Instalador creado dentro de desktop\dist
pause
