#!/usr/bin/env bash
# Relay CLI one-shot install + first-time auth (Linux/macOS).
#
# Idempotent: check Node.js -> install relay-cli -> set service URL ->
# log in -> verify -> show storage quota.
#
# Usage:
#   RELAY_URL="https://your-relay-service" RELAY_USER="username" ./setup.sh
#
# Steps 1-3 are safe to run unattended. Step 4 needs the user's password, so it
# signs in only when RELAY_USER is set and no session exists yet.
#
# Env vars: RELAY_URL / RELAY_USER / RELAY_CLI_SOURCE
# Exit codes: 0=ok; 1=generic; 2=missing node/npm; 3=install failed; 4=auth failed.

set -u

RELAY_URL="${RELAY_URL:-}"
RELAY_USER="${RELAY_USER:-}"
RELAY_CLI_SOURCE="${RELAY_CLI_SOURCE:-github:Telescop-Lab/Relay-CLI}"

# Disable ANSI colors when not writing to a terminal (CI / redirects).
if [ -t 1 ]; then
  _c_cyan='\033[36m'; _c_green='\033[32m'; _c_red='\033[31m'; _c_reset='\033[0m'
else
  _c_cyan=''; _c_green=''; _c_red=''; _c_reset=''
fi

step() { printf "${_c_cyan}==> %s${_c_reset}\n" "$1"; }
ok()   { printf "${_c_green}OK: %s${_c_reset}\n" "$1"; }
fail() {
  printf "${_c_red}FAIL: %s${_c_reset}\n" "$1" >&2
  exit "${2:-1}"
}

# ---------- 1/6 Check Node.js and npm ----------
step '1/6 Check Node.js environment'

if ! command -v node >/dev/null 2>&1; then
  fail 'Node.js not found. Install Node.js 20.x from https://nodejs.org/' 2
fi
if ! command -v npm >/dev/null 2>&1; then
  fail 'npm not found (normally ships with Node.js).' 2
fi

# relay-cli declares engines.node "20.x"; other majors are unsupported, so fail
# here with an actionable message instead of letting npm or the CLI break later.
node_version="$(node --version)"
case "$node_version" in
  v20.*) ;;
  *) fail "Node.js 20.x is required, found $node_version. Install it from https://nodejs.org/ or run: nvm install 20" 2 ;;
esac
ok "Node.js $node_version"

# ---------- 2/6 Install relay-cli (idempotent) ----------
step '2/6 Install relay-cli'

if command -v relay >/dev/null 2>&1; then
  ok "relay already installed (path: $(command -v relay))"
else
  echo "Install source: $RELAY_CLI_SOURCE"
  if ! npm install -g "$RELAY_CLI_SOURCE"; then
    fail 'relay-cli install failed.' 3
  fi
  # Refresh PATH: make the npm global bin dir available in the current session.
  export PATH="$(npm config get prefix)/bin:$PATH"
  if ! command -v relay >/dev/null 2>&1; then
    fail 'Installed but relay not found on PATH. Reopen the terminal and retry.' 3
  fi
  ok 'relay-cli installed'
fi

# ---------- 3/6 Set service URL ----------
step '3/6 Set service URL'

if [ -n "$RELAY_URL" ]; then
  if ! relay config set url "$RELAY_URL"; then
    fail "Failed to set service URL: $RELAY_URL"
  fi
  ok "Service URL set: $RELAY_URL"
else
  echo 'No RELAY_URL provided; assuming already configured (whoami will fail if not).'
fi

# ---------- 4/6 Log in ----------
step '4/6 Log in'

# Idempotent: an existing session is reused rather than authenticated again, so
# re-running this script on an already-configured machine never fails merely for
# want of credentials. Signing in itself is interactive by design.
if relay whoami >/dev/null 2>&1; then
  ok 'Already signed in; skipping login.'
elif [ -n "$RELAY_USER" ]; then
  echo 'Entering interactive login; enter your password when prompted.'
  if ! relay login --identifier "$RELAY_USER"; then
    fail 'Login failed.' 4
  fi
else
  fail 'Not signed in. Run "relay login --identifier <username>" in a terminal, or set RELAY_USER.' 4
fi

# ---------- 5/6 Verify ----------
step '5/6 Verify connection'

if ! relay whoami; then
  fail 'Verification failed: could not fetch identity (check the service URL and login).' 4
fi
ok 'Identity verified'

# ---------- 6/6 Show storage quota ----------
step '6/6 Show storage quota'

if ! relay storage stats; then
  echo 'Note: could not read storage quota (not fatal; run "relay storage stats" later).' >&2
fi

echo ''
printf "${_c_green}Relay CLI is ready. Useful commands:${_c_reset}\n"
echo '  relay bundle push <path> --note "<intent>"   # hand off files to another device'
echo '  relay bundle inbox                            # see pending handoffs'
echo '  relay history                                 # view the audit trail'
echo '  relay --help                                  # list all commands'
