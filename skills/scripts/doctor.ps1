<#
.SYNOPSIS
  Relay CLI readiness check (Windows).

.DESCRIPTION
  Verify the Relay CLI is installed, logged in, and reachable.
  Exit 0 = ready to transfer; 1 = relay not installed; 2 = not logged in / unreachable.
#>

if (-not (Get-Command relay -ErrorAction SilentlyContinue)) {
    Write-Host 'FAIL: relay CLI not found on PATH. Install with: npm install -g github:Telescop-Lab/Relay-CLI' -ForegroundColor Red
    exit 1
}

relay whoami *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'FAIL: not logged in (or service unreachable). Run: relay login --identifier <username-or-email>' -ForegroundColor Red
    exit 2
}

Write-Host 'OK: relay CLI ready.'
relay whoami
