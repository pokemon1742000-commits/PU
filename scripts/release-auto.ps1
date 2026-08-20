[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Message
)

$ErrorActionPreference = 'Stop'
$remoteUrl = 'https://github.com/pokemon1742000-commits/PU.git'
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

Set-Location -LiteralPath $projectRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git was not found. Install Git for Windows.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm was not found. Install Node.js LTS.' }

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
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GH_TOKEN is missing and GitHub CLI is not installed.' }
  $tokenProbe = Invoke-Probe { gh auth token }
  $env:GH_TOKEN = $tokenProbe.Output
  if ($tokenProbe.ExitCode -ne 0 -or -not $env:GH_TOKEN) { throw 'GitHub CLI is not signed in. Run gh auth login first.' }
  $tokenLoadedFromGh = $true
}

try {
  Invoke-Checked 'Increase patch version' { npm version patch --no-git-tag-version }
  $package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
  $version = [string]$package.version
  $tag = "v$version"
  if (-not $Message) { $Message = "Release $tag" }

  Invoke-Checked 'Run tests' { npm test }
  Invoke-Checked 'Check syntax' { npm run check }
  Invoke-Checked 'Build Windows updater installer' { npx electron-builder --win nsis --publish never }

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
  Invoke-Checked "Publish installer $tag to GitHub Releases" { npx electron-builder --win nsis --publish always }

  Write-Host "`nDone: $tag was committed, built, pushed, and published to $remoteUrl." -ForegroundColor Green
} finally {
  if ($tokenLoadedFromGh) { Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue }
}
