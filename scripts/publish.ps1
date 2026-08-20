[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Message,

  [Parameter(Position = 1)]
  [string]$RemoteUrl
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "`n==> $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE. Process stopped."
  }
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

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not $Message) {
  $Message = "Cap nhat ung dung $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git was not found. Install Git for Windows before publishing.'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  $nodeDirectory = 'C:\Program Files\nodejs'
  if (Test-Path -LiteralPath "$nodeDirectory\npm.cmd") {
    $env:Path = "$nodeDirectory;$env:Path"
  } else {
    throw 'npm was not found. Install Node.js LTS before publishing.'
  }
}

$repositoryProbe = Invoke-Probe { git rev-parse --is-inside-work-tree }
if ($repositoryProbe.ExitCode -ne 0 -or $repositoryProbe.Output -ne 'true') {
  Invoke-Checked 'Initialize Git repository' { git init -b main }
}

$originProbe = Invoke-Probe { git remote get-url origin }
$origin = $originProbe.Output
if ($originProbe.ExitCode -ne 0 -or -not $origin) {
  if (-not $RemoteUrl) {
    throw 'Remote origin is missing. Run again with the GitHub URL as the second argument.'
  }
  Invoke-Checked 'Connect GitHub repository' { git remote add origin $RemoteUrl }
} elseif ($RemoteUrl -and $RemoteUrl -ne $origin) {
  throw "Current origin is '$origin', which differs from the provided URL. Check it to avoid pushing to the wrong repository."
}

Invoke-Checked 'Run tests' { npm test }
Invoke-Checked 'Check syntax' { npm run check }
Invoke-Checked 'Build Windows portable app' { npm run dist }
Invoke-Checked 'Stage changes' { git add --all }

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "`nNo new source changes to commit; existing commits will still be pushed." -ForegroundColor Yellow
} elseif ($LASTEXITCODE -eq 1) {
  Invoke-Checked 'Create commit' { git commit -m $Message }
} else {
  throw 'Unable to inspect staged changes.'
}

$branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or -not $branch) {
  throw 'Current branch cannot be determined. Pushing from detached HEAD is not supported.'
}

Invoke-Checked "Push branch $branch to GitHub" { git push --set-upstream origin $branch }

Write-Host "`nDone: built, committed, and updated origin/$branch." -ForegroundColor Green
