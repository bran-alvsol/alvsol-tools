@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -Command "$projectPath = [System.IO.Path]::GetFullPath('%~dp0'); $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue; if (-not $listener) { Start-Process -FilePath 'python' -ArgumentList '-m','http.server','8000' -WorkingDirectory $projectPath -WindowStyle Hidden }; Start-Sleep -Milliseconds 800; Start-Process 'http://localhost:8000/'"

endlocal
