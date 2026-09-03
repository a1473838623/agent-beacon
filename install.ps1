<#
.SYNOPSIS
  One-command installer for Beacon (agent-beacon) on Windows.

  Installs the `beacon` CLI, the daemon and the dashboard, without needing Administrator
  rights (npm's global prefix often sits under C:\Program Files, which does).

  Claude Code users who only want the hooks do not need this script - install the plugin
  instead: /plugin marketplace add a1473838623/agent-beacon

.EXAMPLE
  irm https://raw.githubusercontent.com/a1473838623/agent-beacon/main/install.ps1 | iex

.EXAMPLE
  # with options (irm|iex cannot take parameters, so wrap it in a scriptblock):
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/a1473838623/agent-beacon/main/install.ps1))) -Project
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string] $Version    = $env:BEACON_VERSION,      # e.g. 'v0.8.7'; default = main
  [string] $InstallDir = $env:BEACON_INSTALL_DIR,  # default = %LOCALAPPDATA%\agent-beacon
  [switch] $Project,                               # scope the Claude hook to the current repo
  [switch] $NoInit,                                # skip 'beacon init'
  [switch] $NoStart,                               # skip 'beacon start -d'
  [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'a1473838623/agent-beacon'
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'agent-beacon' }
$ShimDir  = Join-Path $InstallDir '.bin'
$ShimCmd  = Join-Path $ShimDir 'beacon.cmd'
$ShimPs1  = Join-Path $ShimDir 'beacon.ps1'

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  [x]  $m" -ForegroundColor Red; exit 1 }

function Add-UserPath($dir) {
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $cur) { $cur = '' }
  $parts = $cur -split ';' | Where-Object { $_ }
  if ($parts -contains $dir) { return 'present' }

  # cmd.exe truncates the combined machine+user PATH at ~2047 characters, and the user
  # PATH comes last — so an entry appended to the end of a long PATH is silently cut off.
  # The command then "is not found" even though the shim exists and the registry entry is
  # right there, which is a genuinely baffling way to fail.
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  if (-not $machine) { $machine = '' }
  if ($machine.Length + $cur.Length + $dir.Length + 2 -gt 2047) { return 'too-long' }

  [Environment]::SetEnvironmentVariable('Path', (($parts + $dir) -join ';'), 'User')
  return 'added'
}

# A directory already on PATH beats a new entry when PATH is near the limit: it adds no
# length, and being earlier in the list it survives truncation.
function Find-ExistingBinOnPath {
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $cur) { return $null }
  foreach ($c in @((Join-Path $env:USERPROFILE ".local" | Join-Path -ChildPath "bin"),
                   (Join-Path $env:USERPROFILE "bin"))) {
    if (($cur -split ';') -contains $c) { return $c }
  }
  return $null
}

function Remove-UserPath($dir) {
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $cur) { return }
  $parts = $cur -split ';' | Where-Object { $_ -and $_ -ne $dir }
  [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
}

# Strip Beacon's hooks out of a Claude settings.json without touching anyone else's.
function Remove-BeaconHooks($file) {
  if (-not (Test-Path $file)) { return $false }
  try { $json = Get-Content $file -Raw | ConvertFrom-Json } catch { return $false }
  if (-not $json.hooks) { return $false }
  $changed = $false
  foreach ($event in @($json.hooks.PSObject.Properties.Name)) {
    $kept = @($json.hooks.$event | Where-Object {
      ($_ | ConvertTo-Json -Depth 20 -Compress) -notmatch 'agent-beacon|pretooluse\.js|userprompt\.js'
    })
    if ($kept.Count -ne @($json.hooks.$event).Count) { $changed = $true }
    if ($kept.Count -eq 0) { $json.hooks.PSObject.Properties.Remove($event) }
    else { $json.hooks.$event = $kept }
  }
  if ($changed) { $json | ConvertTo-Json -Depth 20 | Set-Content $file -Encoding UTF8 }
  return $changed
}

Write-Host ''
Write-Host '  Beacon - presence for parallel AI coding agents' -ForegroundColor White
Write-Host ''

# ---------------------------------------------------------------- uninstall
if ($Uninstall) {
  if (Test-Path $ShimCmd) { & $ShimCmd stop 2>$null | Out-Null }
  if (Remove-BeaconHooks (Join-Path $env:USERPROFILE '.claude\settings.json')) { Ok 'Removed Claude hooks (global)' }
  if (Remove-BeaconHooks (Join-Path (Get-Location) '.claude\settings.json'))   { Ok 'Removed Claude hooks (project)' }
  Remove-UserPath $ShimDir
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  Ok "Removed $InstallDir"
  Warn "Local data kept at $env:USERPROFILE\.beacon (delete it by hand if you want it gone)"
  Write-Host ''
  exit 0
}

# ---------------------------------------------------------------- prereqs
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die 'Node.js 18+ is required and was not found on PATH. Install it from https://nodejs.org' }
$nodeMajor = [int](((& node -v) -replace '^v', '') -split '\.')[0]
if ($nodeMajor -lt 18) { Die "Node.js 18+ is required (found $(& node -v))" }
Ok "Node $(& node -v)"

# ---------------------------------------------------------------- download
if ($Version) { $ref = "refs/tags/$Version" } else { $ref = 'refs/heads/main' }
$zipUrl = "https://codeload.github.com/$Repo/zip/$ref"
$tmp    = Join-Path ([IO.Path]::GetTempPath()) ("beacon-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$zip    = "$tmp.zip"

Step "Downloading $Repo ($(if ($Version) { $Version } else { 'main' }))"
try { Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing }
catch { Die "Download failed: $($_.Exception.Message)" }

Step 'Extracting'
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$payload = Get-ChildItem $tmp -Directory | Select-Object -First 1

# ---------------------------------------------------------------- install
if (Test-Path $ShimCmd) { Step 'Stopping running daemon'; & $ShimCmd stop 2>$null | Out-Null }

if (Test-Path $InstallDir) {
  Get-ChildItem $InstallDir -Force | Where-Object { $_.Name -ne '.bin' } | Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Get-ChildItem $payload.FullName -Force | Move-Item -Destination $InstallDir -Force
Remove-Item $tmp -Recurse -Force; Remove-Item $zip -Force

$ver = (Get-Content (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
Ok "Installed v$ver to $InstallDir"

# ---------------------------------------------------------------- shim + PATH
# A .cmd shim beats 'npm i -g': no admin rights, and it survives Node version switches
# (nvm-windows puts the global prefix under C:\Program Files, which needs elevation).
New-Item -ItemType Directory -Path $ShimDir -Force | Out-Null
"@echo off`r`nnode `"$InstallDir\bin\beacon.js`" %*" | Set-Content $ShimCmd -Encoding ASCII
"node `"$InstallDir\bin\beacon.js`" @args"          | Set-Content $ShimPs1 -Encoding ASCII

$pathState = Add-UserPath $ShimDir
if ($pathState -eq 'too-long') {
  # Fall back to a bin directory already on PATH rather than adding an entry that would be
  # truncated away. Installing a command that cannot be found is worse than saying so.
  $existing = Find-ExistingBinOnPath
  if ($existing) {
    $ShimDir = $existing
    $ShimCmd = Join-Path $ShimDir 'beacon.cmd'
    $ShimPs1 = Join-Path $ShimDir 'beacon.ps1'
  "@echo off`r`nnode `"$InstallDir\bin\beacon.js`" %*" | Set-Content $ShimCmd -Encoding ASCII
  "node `"$InstallDir\bin\beacon.js`" @args"          | Set-Content $ShimPs1 -Encoding ASCII
    Ok "PATH is near Windows' 2047-character limit; put the shim in $ShimDir instead"
  } else {
    Warn "Your PATH is at Windows' 2047-character limit, so no entry was added."
    Warn "Run beacon as: $ShimCmd"
    Warn 'Or shorten your PATH and re-run this installer.'
  }
} elseif ($pathState -eq 'added') { Ok "Added $ShimDir to your PATH" }
else { Ok 'PATH already configured' }

$env:Path = "$ShimDir;$env:Path"   # so the rest of THIS script can call beacon

# ---------------------------------------------------------------- wire up
if (-not $NoInit) {
  if ($Project) { & $ShimCmd init --project } else { & $ShimCmd init }
}
if (-not $NoStart) { & $ShimCmd start -d }

Write-Host ''
Ok 'Done. Dashboard: http://127.0.0.1:4517'
if ($pathState -eq 'added') { Warn 'Open a NEW terminal for the `beacon` command to be on PATH.' }
Write-Host ''
