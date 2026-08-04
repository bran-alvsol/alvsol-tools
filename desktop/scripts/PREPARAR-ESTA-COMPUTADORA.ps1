$ErrorActionPreference = "Stop"

$packageRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$installer = Join-Path $packageRoot "ALVSOL-Tools-Instalador.exe"
$verification = Join-Path $packageRoot "VERIFICACION-INSTALADOR.txt"
$guide = Join-Path $packageRoot "LEEME-PRIMERO.txt"
$prompts = Join-Path $packageRoot "PROMPTS_PARA_CHATS"

foreach ($required in @($installer, $verification, $guide, $prompts)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Falta un archivo necesario del paquete: $required"
  }
}

$verificationText = Get-Content -LiteralPath $verification -Raw -Encoding UTF8
$expectedMatch = [regex]::Match($verificationText, "SHA256:\s*([A-Fa-f0-9]{64})")
if (-not $expectedMatch.Success) {
  throw "No se encontró el código de verificación del instalador."
}

$expectedHash = $expectedMatch.Groups[1].Value.ToUpperInvariant()
$actualHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) {
  throw "El instalador no coincide con el código de verificación. No se instalará."
}

$documents = if ($env:ALVSOL_PREPARE_DOCUMENTS_ROOT) {
  [System.IO.Path]::GetFullPath($env:ALVSOL_PREPARE_DOCUMENTS_ROOT)
} else {
  [Environment]::GetFolderPath("MyDocuments")
}
if ([string]::IsNullOrWhiteSpace($documents)) {
  $documents = Join-Path $env:USERPROFILE "Documents"
}
$migrationRoot = Join-Path $documents "ALVSOL Tools - Migracion"
New-Item -ItemType Directory -Path $migrationRoot -Force | Out-Null

Copy-Item -LiteralPath $guide -Destination (Join-Path $migrationRoot "LEEME-PRIMERO.txt") -Force
Copy-Item -LiteralPath $prompts -Destination (Join-Path $migrationRoot "PROMPTS_PARA_CHATS") -Recurse -Force

$toolFolders = @(
  "01-COMPRAS",
  "02-GASTOS-DE-BODEGA",
  "03-META-INDIVIDUAL",
  "04-PRESUPUESTO",
  "05-CUADRE",
  "06-METAS-BOX",
  "07-OTRAS"
)

foreach ($area in @("01_RESPALDOS_JSON_ORIGINALES", "02_HERRAMIENTAS_ACTUALES", "03_ACTUALIZACIONES_RECIBIDAS")) {
  foreach ($toolFolder in $toolFolders) {
    New-Item -ItemType Directory -Path (Join-Path $migrationRoot "$area\$toolFolder") -Force | Out-Null
  }
}

if ($env:ALVSOL_PREPARE_SKIP_INSTALL -ne "1") {
  $installProcess = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
  if ($installProcess.ExitCode -ne 0) {
    throw "El instalador terminó con el código $($installProcess.ExitCode)."
  }
}

$installedProgram = Join-Path $env:LOCALAPPDATA "Programs\ALVSOL Tools\ALVSOL Tools.exe"
if (-not (Test-Path -LiteralPath $installedProgram)) {
  throw "La instalación terminó, pero no se encontró ALVSOL Tools."
}

Set-Content -LiteralPath (Join-Path $migrationRoot "ESTADO-INSTALACION.txt") -Encoding UTF8 -Value @(
  "ALVSOL Tools instalado correctamente.",
  "Fecha: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))",
  "Programa: $installedProgram",
  "Carpeta de migración: $migrationRoot",
  "SHA256 verificado: $actualHash"
)

if ($env:ALVSOL_PREPARE_SKIP_INSTALL -ne "1") {
  Start-Process -FilePath $installedProgram | Out-Null
}

Write-Output "ALVSOL Tools instalado correctamente."
Write-Output "Carpeta de migración: $migrationRoot"
Write-Output "El programa quedó abierto en el panel principal."
