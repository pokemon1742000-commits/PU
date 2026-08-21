[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Message
)

$ErrorActionPreference = 'Stop'
$remoteUrl = 'https://github.com/pokemon1742000-commits/PU.git'
$repository = 'pokemon1742000-commits/PU'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tokenLoadedFromGh = $false

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )
  Write-Host "`n==> $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE. Process stopped." }
}

function Invoke-Probe {
  param([Parameter(Mandatory = $true)][scriptblock]$Command)

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $Command 2>$null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  return [pscustomobject]@{
    Output = (($output | ForEach-Object { [string]$_ }) -join "`n").Trim()
    ExitCode = $exitCode
  }
}

function Get-Sha512Base64 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  $hasher = [System.Security.Cryptography.SHA512]::Create()
  try {
    return [Convert]::ToBase64String($hasher.ComputeHash($stream))
  } finally {
    $hasher.Dispose()
    $stream.Dispose()
  }
}

Set-Location -LiteralPath $projectRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git was not found. Install Git for Windows.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm was not found. Install Node.js LTS.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI was not found. Install GitHub CLI.' }

$repositoryProbe = Invoke-Probe { git rev-parse --is-inside-work-tree }
if ($repositoryProbe.ExitCode -ne 0 -or $repositoryProbe.Output -ne 'true') {
  Invoke-Checked 'Initialize Git repository in App' { git init -b main }
}

$originProbe = Invoke-Probe { git remote get-url origin }
$origin = $originProbe.Output
if ($originProbe.ExitCode -ne 0 -or -not $origin) {
  Invoke-Checked 'Connect GitHub repository' { git remote add origin $remoteUrl }
} elseif ($origin.TrimEnd('/') -ne $remoteUrl.TrimEnd('/')) {
  throw "Current origin is '$origin', expected '$remoteUrl'. Refusing to publish to a different repository."
}

$branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or -not $branch) { $branch = 'main' }
if ($branch -ne 'main') { throw "release:auto only publishes branch main; current branch is '$branch'." }

if (-not $env:GH_TOKEN) {
  $tokenProbe = Invoke-Probe { gh auth token }
  $env:GH_TOKEN = $tokenProbe.Output
  if ($tokenProbe.ExitCode -ne 0 -or -not $env:GH_TOKEN) { throw 'GitHub CLI is not signed in. Run gh auth login first.' }
  $tokenLoadedFromGh = $true
}

try {
  $packagePath = Join-Path $projectRoot 'package.json'
  $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
  $currentVersion = [version][string]$package.version
  $headPackageProbe = Invoke-Probe { git show 'HEAD:package.json' }
  $resumeVersion = $false
  if ($headPackageProbe.ExitCode -eq 0 -and $headPackageProbe.Output) {
    $headPackage = $headPackageProbe.Output | ConvertFrom-Json
    $headVersion = [version][string]$headPackage.version
    $candidateTag = "v$currentVersion"
    $localTagProbe = Invoke-Probe { git rev-parse -q --verify "refs/tags/$candidateTag" }
    $remoteTagProbe = Invoke-Probe { git ls-remote --exit-code --tags origin "refs/tags/$candidateTag" }
    $resumeVersion = (
      $currentVersion.Major -eq $headVersion.Major -and
      $currentVersion.Minor -eq $headVersion.Minor -and
      $currentVersion.Build -eq ($headVersion.Build + 1) -and
      $localTagProbe.ExitCode -ne 0 -and
      $remoteTagProbe.ExitCode -ne 0
    )
  }

  if ($resumeVersion) {
    Write-Host "`n==> Resume version v$currentVersion after the interrupted release" -ForegroundColor Yellow
  } else {
    Invoke-Checked 'Increase patch version' { npm version patch --no-git-tag-version }
    $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
  }
  $version = [string]$package.version
  $tag = "v$version"
  if (-not $Message) { $Message = "Release $tag" }

  $buildStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $buildOutput = Join-Path $projectRoot "dist\release-$version-$buildStamp"

  Invoke-Checked 'Run tests' { npm test }
  Invoke-Checked 'Check syntax' { npm run check }
  Invoke-Checked 'Build Windows updater installer' {
    npx electron-builder --win nsis --publish never "--config.directories.output=$buildOutput"
  }

  $releasePaths = @(
    '.gitignore', 'AGENTS.md', 'README.md', 'main.js', 'package.json', 'package-lock.json',
    'preload.js', 'publish-github.cmd', 'start-app.cmd', 'assets', 'renderer', 'src', 'test', 'scripts'
  ) | Where-Object { Test-Path -LiteralPath (Join-Path $projectRoot $_) }
  Invoke-Checked 'Stage application source' { git add -- $releasePaths }

  git diff --cached --quiet
  if ($LASTEXITCODE -eq 1) {
    Invoke-Checked "Commit $tag" { git commit -m $Message }
  } elseif ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect staged changes.'
  } else {
    throw 'No source changes were staged for this release.'
  }

  Invoke-Checked "Create tag $tag" { git tag -a $tag -m $Message }
  Invoke-Checked 'Push main to GitHub' { git push --set-upstream origin main }
  Invoke-Checked "Push tag $tag" { git push origin $tag }

  $releaseProbe = Invoke-Probe { gh release view $tag --repo $repository }
  if ($releaseProbe.ExitCode -ne 0) {
    Invoke-Checked "Create GitHub Release $tag" { gh release create $tag --repo $repository --verify-tag --title $tag --notes $Message }
  }

  $installer = Join-Path $buildOutput "Doi-Chieu-Setup-$version.exe"
  $blockMap = "$installer.blockmap"
  $latestMetadata = Join-Path $buildOutput 'latest.yml'
  foreach ($asset in @($installer, $blockMap, $latestMetadata)) {
    if (-not (Test-Path -LiteralPath $asset)) { throw "Release asset was not found: $asset" }
  }

  $installerSize = (Get-Item -LiteralPath $installer).Length
  $installerHash = Get-Sha512Base64 -Path $installer
  $latestContent = Get-Content -Raw -LiteralPath $latestMetadata
  $hashMatches = [regex]::Matches($latestContent, "(?m)^\s*sha512:\s+$([regex]::Escape($installerHash))\s*$").Count
  if ($latestContent -notmatch "(?m)^\s*size:\s+$installerSize\s*$" -or $hashMatches -lt 2) {
    throw 'latest.yml does not match the built installer. Refusing to publish an update that cannot be installed.'
  }
  Invoke-Checked "Upload installer assets for $tag" { gh release upload $tag $installer $blockMap $latestMetadata --repo $repository --clobber }

  Write-Host "`nDone: $tag was committed, built, pushed, and published to $remoteUrl." -ForegroundColor Green
  Write-Host "Installer: $installer" -ForegroundColor Green
} finally {
  if ($tokenLoadedFromGh) { Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue }
}
