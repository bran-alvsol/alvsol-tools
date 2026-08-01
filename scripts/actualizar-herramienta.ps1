[CmdletBinding()]
param(
  [string]$ZipPath = "",
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
$targetRoot = Join-Path $toolsRoot "herramienta-compras"
$appPath = Join-Path $projectRoot "assets\js\app.js"
$readmePath = Join-Path $projectRoot "README.md"

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
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
    $match = [regex]::Match($value, '(?i)(?:^|[^a-z0-9])v(?:(?:ersion)|(?:ersi\u00f3n))?[\s_-]*(\d+(?:[._-]\d+)+)')
    if ($match.Success) {
      return ($match.Groups[1].Value -replace '[_-]', '.')
    }
  }
  return ""
}

function Add-PortalProtection([string]$HtmlPath) {
  $utf8 = New-Object Text.UTF8Encoding($false)
  $html = [IO.File]::ReadAllText($HtmlPath)

  if ($html -notmatch 'tool-auth-pending') {
    $htmlMatch = [regex]::Match($html, '<html\b[^>]*>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $htmlMatch.Success) { throw "El HTML no contiene la etiqueta <html>." }

    $tag = $htmlMatch.Value
    if ($tag -match 'class\s*=\s*"([^"]*)"') {
      $updatedTag = $tag.Replace($Matches[0], "class=`"$($Matches[1]) tool-auth-pending`"")
    } elseif ($tag -match "class\s*=\s*'([^']*)'") {
      $updatedTag = $tag.Replace($Matches[0], "class='$($Matches[1]) tool-auth-pending'")
    } else {
      $updatedTag = [regex]::Replace($tag, '^<html\b', '<html class="tool-auth-pending"', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }

    $html = $html.Remove($htmlMatch.Index, $htmlMatch.Length).Insert($htmlMatch.Index, $updatedTag)
  }

  if ($html -notmatch 'tool-guard\.js') {
    $guardMarkup = '<style>.tool-auth-pending body{visibility:hidden}</style>' + "`r`n" +
      '<script type="module" src="../../assets/js/tool-guard.js"></script>'
    $titleRegex = New-Object Text.RegularExpressions.Regex('</title>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $headRegex = New-Object Text.RegularExpressions.Regex('<head\b[^>]*>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)

    if ($titleRegex.IsMatch($html)) {
      $html = $titleRegex.Replace($html, "</title>`r`n$guardMarkup", 1)
    } elseif ($headRegex.IsMatch($html)) {
      $headMatch = $headRegex.Match($html)
      $html = $html.Insert($headMatch.Index + $headMatch.Length, "`r`n$guardMarkup")
    } else {
      throw "El HTML no contiene la etiqueta <head>."
    }
  }

  [IO.File]::WriteAllText($HtmlPath, $html, $utf8)
}

New-Item -ItemType Directory -Force -Path $pendingRoot, $processedRoot, $tempRoot | Out-Null

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $zipFiles = @(Get-ChildItem -LiteralPath $pendingRoot -File -Filter "*.zip" | Sort-Object LastWriteTime -Descending)
  if ($zipFiles.Count -eq 0) {
    throw "No hay ningun ZIP en ACTUALIZACIONES\PENDIENTES."
  }
  if ($zipFiles.Count -gt 1) {
    throw "Hay mas de un ZIP pendiente. Deja solamente la version que deseas preparar."
  }
  $zipFullPath = $zipFiles[0].FullName
} else {
  $zipFullPath = [IO.Path]::GetFullPath($ZipPath)
}

if (-not (Test-Path -LiteralPath $zipFullPath -PathType Leaf)) { throw "No existe el ZIP indicado." }
if ([IO.Path]::GetExtension($zipFullPath) -ine ".zip") { throw "El archivo debe tener extension ZIP." }

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
    if ($archive.Entries.Count -gt 500) { throw "El ZIP contiene demasiados archivos." }

    [long]$totalSize = 0
    foreach ($entry in $archive.Entries) {
      $totalSize += $entry.Length
      if ($entry.Length -gt 100MB) { throw "El ZIP contiene un archivo demasiado grande." }
      if ($totalSize -gt 250MB) { throw "El contenido del ZIP supera el limite permitido." }

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

  $mainHtml = $htmlFiles | Sort-Object `
    @{ Expression = { if ($_.Name -ieq "index.html") { 0 } elseif ($_.Name -match '(?i)compras|transferencias|herramienta|box') { 1 } else { 2 } } }, `
    @{ Expression = { $_.Length }; Descending = $true } | Select-Object -First 1

  $sourceRoot = $mainHtml.Directory.FullName
  Get-ChildItem -LiteralPath $sourceRoot -Force | Where-Object { $_.Name -ne "__MACOSX" } |
    Copy-Item -Destination $preparedRoot -Recurse -Force

  $preparedMain = Join-Path $preparedRoot $mainHtml.Name
  $indexPath = Join-Path $preparedRoot "index.html"
  if ($mainHtml.Name -ine "index.html") {
    if (Test-Path -LiteralPath $indexPath) { Remove-Item -LiteralPath $indexPath -Force }
    Move-Item -LiteralPath $preparedMain -Destination $indexPath
  }

  Add-PortalProtection $indexPath
  $preparedHtml = [IO.File]::ReadAllText($indexPath)
  $version = Find-Version @([IO.Path]::GetFileNameWithoutExtension($zipFullPath), $mainHtml.Name, $preparedHtml.Substring(0, [Math]::Min(5000, $preparedHtml.Length)))

  if ([string]::IsNullOrWhiteSpace($version) -and -not $ValidarSolo) {
    $version = (Read-Host "No se detecto la version. Escribe un valor como 5.22").Trim()
  }
  if (-not [string]::IsNullOrWhiteSpace($version) -and $version -notmatch '^\d+(?:\.\d+)+$') {
    throw "La version detectada no tiene un formato valido: $version"
  }

  Write-Host "HTML principal: $($mainHtml.Name)" -ForegroundColor Green
  Write-Host "Version detectada: $(if ($version) { $version } else { 'No detectada' })" -ForegroundColor Green
  Write-Host "Archivos preparados: $(@(Get-ChildItem -LiteralPath $preparedRoot -Recurse -File).Count)" -ForegroundColor Green

  if ($ValidarSolo) {
    if (-not [string]::IsNullOrWhiteSpace($version)) {
      $appPreview = [IO.File]::ReadAllText($appPath)
      $readmePreview = [IO.File]::ReadAllText($readmePath)

      $appVersionPattern = '(description:\s*"Compras, transferencias y cat\u00e1logo BOX\. Versi\u00f3n\s+)\d+(?:\.\d+)*(\.")'
      if (-not [regex]::IsMatch($appPreview, $appVersionPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        throw "No se encontro la version de Compras en assets/js/app.js."
      }

      $readmeVersionPattern = '(\*\*HERRAMIENTA COMPRAS:\*\* compras, transferencias y cat\u00e1logo BOX, versi\u00f3n\s+)\d+(?:\.\d+)*(\.)'
      if (-not [regex]::IsMatch($readmePreview, $readmeVersionPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        throw "No se encontro la version de Compras en README.md."
      }
    }

    Write-Host "`nVALIDACION COMPLETADA. La herramienta actual no fue modificada." -ForegroundColor Green
    return
  }

  $appOriginal = [IO.File]::ReadAllText($appPath)
  $readmeOriginal = [IO.File]::ReadAllText($readmePath)
  $currentVersion = Find-Version @($appOriginal)
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupName = "respaldo-compras-v$($currentVersion)-$timestamp.zip"
  $backupPath = Join-Path $processedRoot $backupName

  Write-Step "Guardando un respaldo de la version actual"
  if (Test-Path -LiteralPath $targetRoot) {
    [IO.Compression.ZipFile]::CreateFromDirectory($targetRoot, $backupPath, [IO.Compression.CompressionLevel]::Optimal, $false)
    Move-Item -LiteralPath $targetRoot -Destination $previousRoot
  }

  try {
    Move-Item -LiteralPath $preparedRoot -Destination $targetRoot

    $appUpdated = [regex]::Replace(
      $appOriginal,
      '(description:\s*"Compras, transferencias y cat\u00e1logo BOX\. Versi\u00f3n\s+)\d+(?:\.\d+)*(\.")',
      "`${1}$version`${2}",
      [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($appUpdated -eq $appOriginal -and $currentVersion -ne $version) {
      throw "No se pudo actualizar la version en assets/js/app.js."
    }

    $readmeUpdated = [regex]::Replace(
      $readmeOriginal,
      '(\*\*HERRAMIENTA COMPRAS:\*\* compras, transferencias y cat\u00e1logo BOX, versi\u00f3n\s+)\d+(?:\.\d+)*(\.)',
      "`${1}$version`${2}",
      [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($readmeUpdated -eq $readmeOriginal -and $currentVersion -ne $version) {
      throw "No se pudo actualizar la version en README.md."
    }

    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($appPath, $appUpdated, $utf8)
    [IO.File]::WriteAllText($readmePath, $readmeUpdated, $utf8)
  } catch {
    if (Test-Path -LiteralPath $targetRoot) { Remove-SafeDirectory $targetRoot $toolsRoot }
    if (Test-Path -LiteralPath $previousRoot) { Move-Item -LiteralPath $previousRoot -Destination $targetRoot }
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($appPath, $appOriginal, $utf8)
    [IO.File]::WriteAllText($readmePath, $readmeOriginal, $utf8)
    throw
  }

  if (Test-Path -LiteralPath $previousRoot) { Remove-SafeDirectory $previousRoot $sessionRoot }

  if ([IO.Path]::GetFullPath((Split-Path -Parent $zipFullPath)).TrimEnd('\') -eq [IO.Path]::GetFullPath($pendingRoot).TrimEnd('\')) {
    $processedZipName = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([IO.Path]::GetFileName($zipFullPath))"
    Move-Item -LiteralPath $zipFullPath -Destination (Join-Path $processedRoot $processedZipName)
  }

  Write-Host "`nVERSION V$version PREPARADA CORRECTAMENTE." -ForegroundColor Green
  Write-Host "Prueba la herramienta en http://localhost:8000 antes de publicarla." -ForegroundColor Yellow
} finally {
  if (Test-Path -LiteralPath $sessionRoot) { Remove-SafeDirectory $sessionRoot $tempRoot }
}
