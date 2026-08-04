@echo off
setlocal
cd /d "%~dp0desktop"
if not exist node_modules (
  echo Preparando ALVSOL Tools Windows por primera vez...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm start
