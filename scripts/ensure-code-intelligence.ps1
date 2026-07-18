param(
    [string]$Version = "v0.9.0",
    [string]$ExpectedSha256 = "92f96896f952e539f0d6cb34d7892a25064b677ccbf808b8f8310ad897e86f2c"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$resourceDir = Join-Path $repoRoot "resources\code-intelligence"
$cacheDir = Join-Path $repoRoot ".cache\code-intelligence"
$archivePath = Join-Path $cacheDir "codebase-memory-mcp-$Version-windows-amd64.zip"
$versionPath = Join-Path $resourceDir ".version"
$executablePath = Join-Path $resourceDir "codebase-memory-mcp.exe"
$downloadUrl = "https://github.com/DeusData/codebase-memory-mcp/releases/download/$Version/codebase-memory-mcp-windows-amd64.zip"

if ((Test-Path -LiteralPath $executablePath) -and (Test-Path -LiteralPath $versionPath)) {
    $installedVersion = (Get-Content -LiteralPath $versionPath -Raw).Trim()
    if ($installedVersion -eq $Version) {
        Write-Host "codebase-memory-mcp $Version is ready."
        exit 0
    }
}

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
    Write-Host "Downloading codebase-memory-mcp $Version..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
}

$actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    throw "codebase-memory-mcp SHA-256 mismatch. Expected $ExpectedSha256, received $actualSha256."
}

$extractDir = Join-Path $cacheDir "extract-$Version"
Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force

$sourceExecutable = Get-ChildItem -LiteralPath $extractDir -Recurse -File |
    Where-Object { $_.Name -eq "codebase-memory-mcp.exe" } |
    Select-Object -First 1
if (-not $sourceExecutable) {
    throw "The verified archive does not contain codebase-memory-mcp.exe."
}

New-Item -ItemType Directory -Force -Path $resourceDir | Out-Null
Copy-Item -LiteralPath $sourceExecutable.FullName -Destination $executablePath -Force

$licenseSource = Get-ChildItem -LiteralPath $extractDir -Recurse -File |
    Where-Object { $_.Name -match '^LICENSE(?:\..+)?$' } |
    Select-Object -First 1
if ($licenseSource) {
    Copy-Item -LiteralPath $licenseSource.FullName -Destination (Join-Path $resourceDir "LICENSE") -Force
} else {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/$Version/LICENSE" -OutFile (Join-Path $resourceDir "LICENSE") -UseBasicParsing
}

Set-Content -LiteralPath $versionPath -Value $Version -Encoding ascii
Write-Host "Prepared $executablePath"
