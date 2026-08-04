$ErrorActionPreference = "Stop"

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$desktopRoot = Join-Path $root "desktop"
$package = Get-Content (Join-Path $desktopRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $package.version
$installerSource = Join-Path $desktopRoot "dist\ALVSOL-Tools-$version-Windows-x64.exe"
$deliveryRoot = Join-Path $root "ENTREGA-PC-PRINCIPAL"
$zipPath = Join-Path $root "ALVSOL-Tools-PC-Principal-v$version.zip"

if (-not (Test-Path -LiteralPath $installerSource)) {
  throw "No se encontró el instalador. Ejecuta primero CONSTRUIR-INSTALADOR-WINDOWS.bat."
}

$expectedPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$resolvedDelivery = [System.IO.Path]::GetFullPath($deliveryRoot)
if (-not $resolvedDelivery.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "La carpeta de entrega quedó fuera del proyecto."
}

if (Test-Path -LiteralPath $deliveryRoot) {
  Remove-Item -LiteralPath $deliveryRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $deliveryRoot | Out-Null
Copy-Item -LiteralPath $installerSource -Destination (Join-Path $deliveryRoot "ALVSOL-Tools-Instalador.exe")
Copy-Item -LiteralPath (Join-Path $desktopRoot "GUIA-PC-PRINCIPAL.txt") -Destination (Join-Path $deliveryRoot "LEEME-PRIMERO.txt")
Copy-Item -LiteralPath (Join-Path $desktopRoot "ESPECIFICACION-HERRAMIENTAS-ALVSOL.md") -Destination (Join-Path $deliveryRoot "FORMATO-DE-HERRAMIENTAS.md")
Copy-Item -LiteralPath (Join-Path $desktopRoot "PROMPT-CODEX-PC-PRINCIPAL.txt") -Destination (Join-Path $deliveryRoot "PROMPT-CODEX-PC-PRINCIPAL.txt")
Copy-Item -LiteralPath (Join-Path $desktopRoot "prompts") -Destination (Join-Path $deliveryRoot "PROMPTS_PARA_CHATS") -Recurse
Copy-Item -LiteralPath (Join-Path $desktopRoot "scripts\PREPARAR-ESTA-COMPUTADORA.bat") -Destination (Join-Path $deliveryRoot "PREPARAR-ESTA-COMPUTADORA.bat")
Copy-Item -LiteralPath (Join-Path $desktopRoot "scripts\PREPARAR-ESTA-COMPUTADORA.ps1") -Destination (Join-Path $deliveryRoot "PREPARAR-ESTA-COMPUTADORA.ps1")

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
  $areaPath = Join-Path $deliveryRoot $area
  New-Item -ItemType Directory -Path $areaPath | Out-Null
  foreach ($toolFolder in $toolFolders) {
    $toolPath = Join-Path $areaPath $toolFolder
    New-Item -ItemType Directory -Path $toolPath | Out-Null
    Set-Content -LiteralPath (Join-Path $toolPath "COLOCA-AQUI-LOS-ARCHIVOS.txt") -Value "Conserva aquí únicamente los archivos correspondientes a esta herramienta." -Encoding UTF8
  }
}

$hash = (Get-FileHash -LiteralPath (Join-Path $deliveryRoot "ALVSOL-Tools-Instalador.exe") -Algorithm SHA256).Hash
Set-Content -LiteralPath (Join-Path $deliveryRoot "VERIFICACION-INSTALADOR.txt") -Encoding ASCII -Value @(
  "Archivo: ALVSOL-Tools-Instalador.exe",
  "Versión: $version",
  "SHA256: $hash"
)

Compress-Archive -Path (Join-Path $deliveryRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output "Carpeta: $deliveryRoot"
Write-Output "ZIP: $zipPath"
Write-Output "SHA256 instalador: $hash"
