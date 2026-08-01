[CmdletBinding()]
param(
  [string]$ZipPath = "",
  [ValidateSet("auto", "nueva", "actualizar")]
  [string]$Modo = "auto",
  [string]$ToolId = "",
  [string]$Name = "",
  [string]$Description = "",
  [switch]$ValidarSolo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$updatesRoot = Join-Path $projectRoot "ACTUALIZACIONES"
$pendingRoot = Join-Path $updatesRoot "PENDIENTES"
$processedRoot = Join-Path $updatesRoot "PROCESADAS"
$tempRoot = Join-Path $updatesRoot ".tmp"
$toolsRoot = Join-Path $projectRoot "tools"
$catalogPath = Join-Path $projectRoot "assets\data\tools.json"
$pendingMarkerPath = Join-Path $tempRoot "publicacion-pendiente.json"

function Write-Step([string]$Message) {
  Write-Host ([Environment]::NewLine + "==> $Message") -ForegroundColor Cyan
}

function Assert-ChildPath([string]$Path, [string]$Parent) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  if (-not $fullPath.StartsWith($fullParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Ruta fuera del area permitida: $fullPath"
  }
  return $fullPath
}

function Remove-SafeDirectory([string]$Path, [string]$Parent) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $safePath = Assert-ChildPath $Path $Parent
  [IO.Directory]::Delete($safePath, $true)
}

function Find-Version([string[]]$Values) {
  foreach ($value in $Values) {
    if ([string]::IsNullOrWhiteSpace($value)) { continue }
    $match = [regex]::Match($value, '(?i)(?:^|[^a-z0-9])v(?:(?:ersion)|(?:ersi\u00f3n))?[\s_-]*(\d+(?:[._-]\d+)+)')
    if ($match.Success) {
      return ($match.Groups[1].Value -replace '[_-]', '.')
    }
  }
  return ""
}

function Convert-ToSlug([string]$Value) {
  $normalized = $Value.Normalize([Text.NormalizationForm]::FormD)
  $builder = New-Object Text.StringBuilder
  foreach ($character in $normalized.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($character) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$builder.Append($character)
    }
  }

  $slug = $builder.ToString().ToLowerInvariant() -replace '[^a-z0-9]+', '-'
  $slug = $slug.Trim('-')
  if ($slug.StartsWith('herramienta-')) { return $slug }
  return "herramienta-$slug"
}

function Read-Catalog {
  if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) {
    throw "No existe la lista assets\data\tools.json."
  }

  $content = [IO.File]::ReadAllText($catalogPath)
  $parsed = ConvertFrom-Json -InputObject $content
  return @($parsed)
}

function Write-JsonFile([string]$Path, [object]$Value) {
  $utf8 = New-Object Text.UTF8Encoding($false)
  $json = ConvertTo-Json -InputObject $Value -Depth 8
  [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8)
}

function Add-PortalProtection([string]$HtmlPath) {
  $utf8 = New-Object Text.UTF8Encoding($false)
  $html = [IO.File]::ReadAllText($HtmlPath)

  if ($html -notmatch 'tool-auth-pending') {
    $htmlMatch = [regex]::Match($html, '<html\b[^>]*>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $htmlMatch.Success) { throw "El HTML no contiene la etiqueta <html>." }

    $tag = $htmlMatch.Value
    if ($tag -match 'class\s*=\s*"([^"]*)"') {
      $updatedTag = $tag.Replace($Matches[0], ('class="{0} tool-auth-pending"' -f $Matches[1]))
    } elseif ($tag -match "class\s*=\s*'([^']*)'") {
      $updatedTag = $tag.Replace($Matches[0], ("class='{0} tool-auth-pending'" -f $Matches[1]))
    } else {
      $updatedTag = [regex]::Replace($tag, '^<html\b', '<html class="tool-auth-pending"', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }

    $html = $html.Remove($htmlMatch.Index, $htmlMatch.Length).Insert($htmlMatch.Index, $updatedTag)
  }

  if ($html -notmatch 'tool-guard\.js') {
    $guardMarkup = '<style>.tool-auth-pending body{visibility:hidden}</style>' +
      [Environment]::NewLine + '<script type="module" src="../../assets/js/tool-guard.js"></script>'
    $titleRegex = New-Object Text.RegularExpressions.Regex('</title>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $headRegex = New-Object Text.RegularExpressions.Regex('<head\b[^>]*>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)

    if ($titleRegex.IsMatch($html)) {
      $html = $titleRegex.Replace($html, ("</title>{0}{1}" -f [Environment]::NewLine, $guardMarkup), 1)
    } elseif ($headRegex.IsMatch($html)) {
      $headMatch = $headRegex.Match($html)
      $html = $html.Insert($headMatch.Index + $headMatch.Length, ([Environment]::NewLine + $guardMarkup))
    } else {
      throw "El HTML no contiene la etiqueta <head>."
    }
  }

  if ($html -notmatch 'data-alvsol-portal-link' -and $html -notmatch 'href\s*=\s*["'']\.\./\.\./(?:index\.html)?["'']') {
    $navCloseRegex = New-Object Text.RegularExpressions.Regex('</nav>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($navCloseRegex.IsMatch($html)) {
      $portalLink = '<a href="../../" data-alvsol-portal-link style="display:block;margin:12px 0;padding:9px 12px;border:1px solid rgba(255,255,255,.25);border-radius:6px;color:inherit;font-weight:700;text-align:center;text-decoration:none">&larr; Volver al portal</a>'
      $html = $navCloseRegex.Replace($html, ("</nav>{0}{1}" -f [Environment]::NewLine, $portalLink), 1)
    }
  }

  [IO.File]::WriteAllText($HtmlPath, $html, $utf8)
}

function Select-Tool([object[]]$Catalog) {
  if ($Modo -eq "nueva") { return $null }

  if (-not [string]::IsNullOrWhiteSpace($ToolId)) {
    $selected = $Catalog | Where-Object { $_.id -eq $ToolId } | Select-Object -First 1
    if ($Modo -eq "actualizar" -and $null -eq $selected) {
      throw "No existe la herramienta $ToolId en el panel."
    }
    return $selected
  }

  Write-Host ([Environment]::NewLine + "QUE DESEAS HACER?") -ForegroundColor Cyan
  Write-Host "  0. Agregar una herramienta nueva"
  for ($index = 0; $index -lt $Catalog.Count; $index++) {
    Write-Host "  $($index + 1). Actualizar $($Catalog[$index].name) (V$($Catalog[$index].version))"
  }

  $choiceText = (Read-Host "Escribe el numero").Trim()
  [int]$choice = -1
  if (-not [int]::TryParse($choiceText, [ref]$choice) -or $choice -lt 0 -or $choice -gt $Catalog.Count) {
    throw "La opcion elegida no es valida."
  }
  if ($choice -eq 0) { return $null }
  return $Catalog[$choice - 1]
}

New-Item -ItemType Directory -Force -Path $pendingRoot, $processedRoot, $tempRoot, $toolsRoot | Out-Null

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $zipFiles = @(Get-ChildItem -LiteralPath $pendingRoot -File -Filter "*.zip" | Sort-Object LastWriteTime -Descending)
  if ($zipFiles.Count -eq 0) { throw "No hay ningun ZIP en ACTUALIZACIONES\PENDIENTES." }
  if ($zipFiles.Count -gt 1) { throw "Hay mas de un ZIP pendiente. Deja solamente el que deseas preparar." }
  $zipFullPath = $zipFiles[0].FullName
} else {
  $zipFullPath = [IO.Path]::GetFullPath($ZipPath)
}

if (-not (Test-Path -LiteralPath $zipFullPath -PathType Leaf)) { throw "No existe el ZIP indicado." }
if ([IO.Path]::GetExtension($zipFullPath) -ine ".zip") { throw "El archivo debe ser ZIP." }

$catalogOriginal = [IO.File]::ReadAllText($catalogPath)
$catalog = @(Read-Catalog)
$selectedTool = Select-Tool $catalog
$isNew = $null -eq $selectedTool

if ($isNew) {
  if ([string]::IsNullOrWhiteSpace($Name)) {
    $Name = (Read-Host "Escribe el nombre que aparecera en el panel").Trim()
  }
  if ([string]::IsNullOrWhiteSpace($Name)) { throw "La herramienta necesita un nombre." }

  if ([string]::IsNullOrWhiteSpace($ToolId)) { $ToolId = Convert-ToSlug $Name }
  if ($ToolId -notmatch '^herramienta-[a-z0-9]+(?:-[a-z0-9]+)*$') {
    throw "El nombre interno de la herramienta no es valido: $ToolId"
  }
  if ($catalog | Where-Object { $_.id -eq $ToolId }) { throw "Ya existe una herramienta llamada $ToolId." }

  if ([string]::IsNullOrWhiteSpace($Description)) {
    $Description = (Read-Host "Escribe una descripcion corta").Trim()
  }
  if ([string]::IsNullOrWhiteSpace($Description)) { $Description = "Herramienta interna ALVSOL." }
} else {
  $ToolId = $selectedTool.id
  $Name = $selectedTool.name
  $Description = $selectedTool.description
}

$targetRoot = Assert-ChildPath (Join-Path $toolsRoot $ToolId) $toolsRoot
if ($isNew -and (Test-Path -LiteralPath $targetRoot)) { throw "Ya existe la carpeta $ToolId y no se reemplazara." }
if (-not $isNew -and -not (Test-Path -LiteralPath $targetRoot)) { throw "No existe la carpeta de $Name." }

$sessionRoot = Join-Path $tempRoot ([guid]::NewGuid().ToString("N"))
$extractRoot = Join-Path $sessionRoot "extraido"
$preparedRoot = Join-Path $sessionRoot "preparado"
$previousRoot = Join-Path $sessionRoot "anterior"
New-Item -ItemType Directory -Force -Path $extractRoot, $preparedRoot | Out-Null

try {
  Write-Step "Validando el ZIP"
  $archive = [IO.Compression.ZipFile]::OpenRead($zipFullPath)
  try {
    if ($archive.Entries.Count -eq 0) { throw "El ZIP esta vacio." }
    if ($archive.Entries.Count -gt 1000) { throw "El ZIP contiene demasiados archivos." }

    [long]$totalSize = 0
    foreach ($entry in $archive.Entries) {
      $totalSize += $entry.Length
      if ($entry.Length -gt 100MB) { throw "El ZIP contiene un archivo demasiado grande." }
      if ($totalSize -gt 300MB) { throw "El contenido del ZIP supera el limite permitido." }

      $destination = [IO.Path]::GetFullPath((Join-Path $extractRoot $entry.FullName))
      $extractPrefix = [IO.Path]::GetFullPath($extractRoot).TrimEnd('\') + '\'
      if (-not $destination.StartsWith($extractPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "El ZIP contiene una ruta no permitida: $($entry.FullName)"
      }

      if ([string]::IsNullOrEmpty($entry.Name)) {
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
        continue
      }

      $destinationDirectory = Split-Path -Parent $destination
      New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
      $inputStream = $entry.Open()
      $outputStream = [IO.File]::Create($destination)
      try { $inputStream.CopyTo($outputStream) }
      finally { $outputStream.Dispose(); $inputStream.Dispose() }
    }
  } finally {
    $archive.Dispose()
  }

  $htmlFiles = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File | Where-Object {
    $_.Extension -ieq ".html" -and $_.FullName -notmatch '[\\/]__MACOSX[\\/]'
  })
  if ($htmlFiles.Count -eq 0) { throw "El ZIP no contiene ningun archivo HTML." }

  $sortRules = @(
    @{ Expression = { if ($_.Name -ieq "index.html") { 0 } else { 1 } } },
    @{ Expression = { $_.Length }; Descending = $true }
  )
  $mainHtml = $htmlFiles | Sort-Object -Property $sortRules | Select-Object -First 1

  $sourceRoot = $mainHtml.Directory.FullName
  Get-ChildItem -LiteralPath $sourceRoot -Force | Where-Object { $_.Name -ne "__MACOSX" } |
    Copy-Item -Destination $preparedRoot -Recurse -Force

  Get-ChildItem -LiteralPath $preparedRoot -Recurse -File | Where-Object {
    $_.Extension -in @('.bat', '.cmd', '.ps1', '.py', '.exe', '.msi')
  } | Remove-Item -Force

  $preparedMain = Join-Path $preparedRoot $mainHtml.Name
  $indexPath = Join-Path $preparedRoot "index.html"
  if ($mainHtml.Name -ine "index.html") {
    if (Test-Path -LiteralPath $indexPath) { Remove-Item -LiteralPath $indexPath -Force }
    Move-Item -LiteralPath $preparedMain -Destination $indexPath
  }

  Add-PortalProtection $indexPath
  $preparedHtml = [IO.File]::ReadAllText($indexPath)
  $version = Find-Version @(
    [IO.Path]::GetFileNameWithoutExtension($zipFullPath),
    $mainHtml.Name,
    $preparedHtml.Substring(0, [Math]::Min(8000, $preparedHtml.Length))
  )

  if ([string]::IsNullOrWhiteSpace($version) -and -not $ValidarSolo) {
    $version = (Read-Host "No se detecto la version. Escribe un valor como 1.4").Trim()
  }
  if ([string]::IsNullOrWhiteSpace($version)) { $version = "sin identificar" }
  if ($version -ne "sin identificar" -and $version -notmatch '^\d+(?:\.\d+)+$') {
    throw "La version detectada no tiene un formato valido: $version"
  }

  Write-Host "Accion: $(if ($isNew) { 'Agregar nueva' } else { 'Actualizar existente' })" -ForegroundColor Green
  Write-Host "Herramienta: $Name" -ForegroundColor Green
  Write-Host "Version detectada: $version" -ForegroundColor Green
  Write-Host "Archivos preparados: $(@(Get-ChildItem -LiteralPath $preparedRoot -Recurse -File).Count)" -ForegroundColor Green

  if ($ValidarSolo) {
    Write-Host ([Environment]::NewLine + "VALIDACION COMPLETADA. El portal no fue modificado.") -ForegroundColor Green
    return
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
  if (-not $isNew) {
    $backupName = "respaldo-$ToolId-v$($selectedTool.version)-$timestamp.zip"
    $backupPath = Join-Path $processedRoot $backupName
    Write-Step "Guardando un respaldo de $Name"
    [IO.Compression.ZipFile]::CreateFromDirectory($targetRoot, $backupPath, [IO.Compression.CompressionLevel]::Optimal, $false)
    Move-Item -LiteralPath $targetRoot -Destination $previousRoot
  }

  try {
    Move-Item -LiteralPath $preparedRoot -Destination $targetRoot

    if ($isNew) {
      $catalog += [pscustomobject][ordered]@{
        id = $ToolId
        name = $Name.ToUpperInvariant()
        description = $Description.Trim().TrimEnd('.')
        version = $version
        status = "Abrir"
        url = "./tools/$ToolId/"
        migrated = $true
      }
    } else {
      $selectedTool.version = $version
      $selectedTool.url = "./tools/$ToolId/"
      $selectedTool.migrated = $true
    }

    Write-JsonFile $catalogPath @($catalog)
    Write-JsonFile $pendingMarkerPath ([pscustomobject]@{
      action = $(if ($isNew) { "Agregar" } else { "Actualizar" })
      id = $ToolId
      name = $Name.ToUpperInvariant()
      version = $version
    })
  } catch {
    if (Test-Path -LiteralPath $targetRoot) { Remove-SafeDirectory $targetRoot $toolsRoot }
    if (Test-Path -LiteralPath $previousRoot) { Move-Item -LiteralPath $previousRoot -Destination $targetRoot }
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($catalogPath, $catalogOriginal, $utf8)
    throw
  }

  if (Test-Path -LiteralPath $previousRoot) { Remove-SafeDirectory $previousRoot $sessionRoot }

  if ([IO.Path]::GetFullPath((Split-Path -Parent $zipFullPath)).TrimEnd('\') -eq [IO.Path]::GetFullPath($pendingRoot).TrimEnd('\')) {
    $processedZipName = "$timestamp-$ToolId-v$version.zip"
    Move-Item -LiteralPath $zipFullPath -Destination (Join-Path $processedRoot $processedZipName)
  }

  Write-Host ([Environment]::NewLine + "$Name V$version QUEDO PREPARADA CORRECTAMENTE.") -ForegroundColor Green
  Write-Host "Pruebala en http://localhost:8000 antes de publicarla." -ForegroundColor Yellow
} finally {
  if (Test-Path -LiteralPath $sessionRoot) { Remove-SafeDirectory $sessionRoot $tempRoot }
}
