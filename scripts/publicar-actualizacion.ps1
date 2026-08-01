Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$appPath = Join-Path $projectRoot "assets\js\app.js"
$publicUrl = "https://bran-alvsol.github.io/alvsol-tools/"

function Run-Git([string[]]$GitArguments) {
  & git @GitArguments
  if ($LASTEXITCODE -ne 0) { throw "Git no pudo completar: git $($GitArguments -join ' ')" }
}

Push-Location $projectRoot
try {
  $changes = @(& git status --short -- "assets/js/app.js" "README.md" "tools/herramienta-compras")
  if ($LASTEXITCODE -ne 0) { throw "No se pudo revisar el estado del proyecto." }
  if ($changes.Count -eq 0) {
    Write-Host "No hay una actualizacion preparada para publicar." -ForegroundColor Yellow
    return
  }

  Write-Host "Cambios listos para publicar:" -ForegroundColor Cyan
  $changes | ForEach-Object { Write-Host "  $_" }
  $answer = (Read-Host "Escribe PUBLICAR si ya probaste reportes, analisis y exportaciones").Trim()
  if ($answer -cne "PUBLICAR") {
    Write-Host "Publicacion cancelada. Los cambios siguen guardados localmente." -ForegroundColor Yellow
    return
  }

  & node --check "assets/js/app.js"
  if ($LASTEXITCODE -ne 0) { throw "assets/js/app.js contiene un error." }

  $appText = [IO.File]::ReadAllText($appPath)
  $versionMatch = [regex]::Match($appText, 'Versi\u00f3n\s+(\d+(?:\.\d+)+)')
  $version = if ($versionMatch.Success) { $versionMatch.Groups[1].Value } else { "nueva" }

  Run-Git @("add", "--", "assets/js/app.js", "README.md", "tools/herramienta-compras")
  $staged = @(& git diff --cached --name-only)
  if ($staged.Count -eq 0) { throw "No hay cambios preparados para guardar en Git." }

  Run-Git @("commit", "-m", "Actualizar HERRAMIENTA COMPRAS a V$version")
  $env:GCM_INTERACTIVE = "Never"
  Run-Git @("push")

  Write-Host "`nPUBLICACION ENVIADA A GITHUB." -ForegroundColor Green
  Write-Host "GitHub Pages puede tardar unos minutos en mostrar la nueva version." -ForegroundColor Yellow
  Start-Process $publicUrl
} finally {
  Pop-Location
}
