#!/usr/bin/env bash
# relay doctor: verify the Relay CLI is installed, logged in, and reachable.
# Exit 0 = ready to transfer; non-zero = a precondition is missing (see message).
set -euo pipefail

if ! command -v relay >/dev/null 2>&1; then
  echo "FAIL: relay CLI not found on PATH. Install with: npm install -g github:Telescop-Lab/Relay-CLI" >&2
  exit 1
fi

if ! relay whoami >/dev/null 2>&1; then
  echo "FAIL: not logged in (or service unreachable). Run: relay login --identifier <username-or-email>" >&2
  exit 2
fi

echo "OK: relay CLI ready."
relay whoami
