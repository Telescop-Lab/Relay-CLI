<#
.SYNOPSIS
  Relay CLI one-shot install + first-time auth (Windows).

.DESCRIPTION
  Idempotent setup: check Node.js -> install relay-cli -> set service URL ->
  log in -> verify -> show storage quota.

  Usage:
    .\setup.ps1 -RelayUrl "https://your-relay-service" -RelayUser "username"

  Steps 1-3 are safe to run unattended. Step 4 needs the user's password, so it
  signs in only when -RelayUser is passed and no session exists yet.

  Parameters can also come from env vars: RELAY_URL / RELAY_USER / RELAY_CLI_SOURCE.

  Exit codes: 0=ok; 1=generic; 2=missing Node/npm; 3=install failed; 4=auth failed.
#>

[CmdletBinding()]
param(
    [string]$RelayUrl       = $env:RELAY_URL,
    [string]$RelayUser      = $env:RELAY_USER,
    [string]$RelayCliSource = $env:RELAY_CLI_SOURCE
)

$ErrorActionPreference = 'Stop'

# Default install source: git direct install (override for offline/air-gapped tgz).
if (-not $RelayCliSource) {
    $RelayCliSource = 'github:Telescop-Lab/Relay-CLI'
}

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "OK: $Message" -ForegroundColor Green
}

function Fail {
    param([string]$Message, [int]$Code = 1)
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit $Code
}

# Refresh PATH so a just-installed global npm binary is found in this session.
function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ($machine, $user) -join ';'
}

# ---------- 1/6 Check Node.js and npm ----------
Write-Step '1/6 Check Node.js environment'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'Node.js not found. Install Node.js 20.x from https://nodejs.org/' -Code 2
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail 'npm not found (normally ships with Node.js).' -Code 2
}

# relay-cli declares engines.node "20.x"; other majors are unsupported, so fail
# here with an actionable message instead of letting npm or the CLI break later.
$nodeVersion = (& node --version).Trim()
if ($nodeVersion -notmatch '^v20\.') {
    Fail "Node.js 20.x is required, found $nodeVersion. Install it from https://nodejs.org/ or run: nvm install 20" -Code 2
}
Write-Ok "Node.js $nodeVersion"

# ---------- 2/6 Install relay-cli (idempotent) ----------
Write-Step '2/6 Install relay-cli'

$relayCmd = Get-Command relay -ErrorAction SilentlyContinue
if ($relayCmd) {
    Write-Ok "relay already installed (path: $($relayCmd.Source))"
} else {
    Write-Host "Install source: $RelayCliSource"
    npm install -g $RelayCliSource
    if ($LASTEXITCODE -ne 0) {
        Fail 'relay-cli install failed.' -Code 3
    }
    Refresh-Path
    if (-not (Get-Command relay -ErrorAction SilentlyContinue)) {
        Fail 'Installed but relay not found on PATH. Reopen the terminal and retry.' -Code 3
    }
    Write-Ok 'relay-cli installed'
}

# ---------- 3/6 Set service URL ----------
Write-Step '3/6 Set service URL'

if ($RelayUrl) {
    & relay config set url $RelayUrl
    if ($LASTEXITCODE -ne 0) { Fail "Failed to set service URL: $RelayUrl" }
    Write-Ok "Service URL set: $RelayUrl"
} else {
    Write-Host 'No -RelayUrl provided; assuming already configured (whoami will fail if not).'
}

# ---------- 4/6 Log in ----------
Write-Step '4/6 Log in'

# Idempotent: an existing session is reused rather than authenticated again, so
# re-running this script on an already-configured machine never fails merely for
# want of credentials. Signing in itself is interactive by design.
& relay whoami *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Ok 'Already signed in; skipping login.'
} elseif ($RelayUser) {
    Write-Host 'Entering interactive login; enter your password when prompted.'
    & relay login --identifier $RelayUser
    if ($LASTEXITCODE -ne 0) { Fail 'Login failed.' -Code 4 }
} else {
    Fail 'Not signed in. Run "relay login --identifier <username>" in a terminal, or pass -RelayUser.' -Code 4
}

# ---------- 5/6 Verify ----------
Write-Step '5/6 Verify connection'

& relay whoami
if ($LASTEXITCODE -ne 0) {
    Fail 'Verification failed: could not fetch identity (check the service URL and login).' -Code 4
}
Write-Ok 'Identity verified'

# ---------- 6/6 Show storage quota ----------
Write-Step '6/6 Show storage quota'

& relay storage stats
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Note: could not read storage quota (not fatal; run "relay storage stats" later).' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Relay CLI is ready. Useful commands:' -ForegroundColor Green
Write-Host '  relay bundle push <path> --note "<intent>"   # hand off files to another device'
Write-Host '  relay bundle inbox                            # see pending handoffs'
Write-Host '  relay history                                 # view the audit trail'
Write-Host '  relay --help                                  # list all commands'
