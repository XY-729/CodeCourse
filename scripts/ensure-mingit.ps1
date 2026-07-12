$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$target = Join-Path $root "resources\git"
$gitExe = Join-Path $target "cmd\git.exe"

if (Test-Path $gitExe) {
  Write-Host "MinGit already exists: $gitExe"
  exit 0
}

if ($env:MINGIT_SOURCE -and (Test-Path (Join-Path $env:MINGIT_SOURCE "cmd\git.exe"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  if (Test-Path $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  Copy-Item -LiteralPath $env:MINGIT_SOURCE -Destination $target -Recurse
  Write-Host "Copied portable Git from MINGIT_SOURCE: $env:MINGIT_SOURCE"
  exit 0
}

$version = if ($env:MINGIT_VERSION) { $env:MINGIT_VERSION } else { "2.45.2" }
$tag = "v$version.windows.1"
$fileName = "MinGit-$version-64-bit.zip"
$url = "https://github.com/git-for-windows/git/releases/download/$tag/$fileName"
$downloadDir = Join-Path $root ".cache"
$zipPath = Join-Path $downloadDir $fileName

New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null

Write-Host "Downloading MinGit from $url"
Invoke-WebRequest -Uri $url -OutFile $zipPath

if (Test-Path $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $target -Force

if (!(Test-Path $gitExe)) {
  throw "MinGit was extracted, but git.exe was not found at $gitExe"
}

Write-Host "MinGit ready: $gitExe"
