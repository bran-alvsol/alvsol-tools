Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$catalogPath = Join-Path $projectRoot "assets\data\tools.json"
$markerPath = Join-Path $projectRoot "ACTUALIZACIONES\.tmp\publicacion-pendiente.json"
$publicUrl = "https://bran-alvsol.github.io/alvsol-tools/"

function Run-Git([string[]]$GitArguments) {
  & git @GitArguments
  if ($LASTEXITCODE -ne 0) { throw "Git no pudo completar: git $($GitArguments -join ' ')" }
}

function Test-Catalog {
  $catalog = @((ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($catalogPath))))
  if ($catalog.Count -eq 0) { throw "La lista de herramientas esta vacia." }

  $ids = @{}
  foreach ($tool in $catalog) {
    foreach ($property in @("id", "name", "description", "version", "url")) {
      if ([string]::IsNullOrWhiteSpace([string]$tool.$property)) {
        throw "Una herramienta no tiene el dato $property."
      }
    }
    if ($ids.ContainsKey($tool.id)) { throw "La herramienta $($tool.id) aparece repetida." }
    $ids[$tool.id] = $true

    $indexPath = Join-Path $projectRoot ("tools\{0}\index.html" -f $tool.id)
    if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
      throw "No existe el archivo principal de $($tool.name)."
    }
  }
}

Push-Location $projectRoot
try {
  $changes = @(& git status --short -- "assets/data/tools.json" "tools")
  if ($LASTEXITCODE -ne 0) { throw "No se pudo revisar el estado del proyecto." }
  if ($changes.Count -eq 0) {
    Write-Host "No hay una herramienta preparada para publicar." -ForegroundColor Yellow
    return
  }

  $previouslyStaged = @(& git diff --cached --name-only)
  $unexpectedStaged = @($previouslyStaged | Where-Object {
    $_ -ne "assets/data/tools.json" -and $_ -notlike "tools/*"
  })
  if ($unexpectedStaged.Count -gt 0) {
    throw "Hay otros cambios preparados en Git. Publicalos o retiralos antes de continuar."
  }

  Write-Host "Cambios listos para publicar:" -ForegroundColor Cyan
  $changes | ForEach-Object { Write-Host "  $_" }
  $answer = (Read-Host "Escribe PUBLICAR si ya probaste la herramienta").Trim()
  if ($answer -cne "PUBLICAR") {
    Write-Host "Publicacion cancelada. Los cambios siguen guardados localmente." -ForegroundColor Yellow
    return
  }

  Test-Catalog
  & node --check "assets/js/app.js"
  if ($LASTEXITCODE -ne 0) { throw "El panel contiene un error." }
  & node --check "assets/js/tool-guard.js"
  if ($LASTEXITCODE -ne 0) { throw "La proteccion de acceso contiene un error." }

  $message = "Actualizar herramientas de ALVSOL Tools"
  if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
    $marker = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($markerPath))
    $message = "$($marker.action) $($marker.name) V$($marker.version)"
  }

  Run-Git @("add", "--", "assets/data/tools.json", "tools")
  $staged = @(& git diff --cached --name-only)
  if ($staged.Count -eq 0) { throw "No hay cambios preparados para guardar en Git." }

  Run-Git @("commit", "-m", $message)
  $env:GCM_INTERACTIVE = "Never"
  Run-Git @("push")

  if (Test-Path -LiteralPath $markerPath) { Remove-Item -LiteralPath $markerPath -Force }

  Write-Host ([Environment]::NewLine + "PUBLICACION ENVIADA A GITHUB.") -ForegroundColor Green
  Write-Host "GitHub Pages puede tardar unos minutos en mostrar la nueva version." -ForegroundColor Yellow
  Start-Process $publicUrl
} finally {
  Pop-Location
}
