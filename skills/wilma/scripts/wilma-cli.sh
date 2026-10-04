#!/usr/bin/env bash
set -euo pipefail

# Runs the WilmAI CLI for the skill. The skill is written for CLI 2.x: an
# installed `wilma` (or `wilmai`) is used when it is 2.x or newer; otherwise
# (not installed, or still 1.x) the latest 2.x release runs through npx.
# Usage: wilma-cli.sh <args>

is_v2() {
  local version
  version=$("$1" --version 2>/dev/null) || return 1
  [[ "${version%%.*}" =~ ^[0-9]+$ ]] && (( ${version%%.*} >= 2 ))
}

if command -v wilma >/dev/null 2>&1 && is_v2 wilma; then
  wilma "$@"
elif command -v wilmai >/dev/null 2>&1 && is_v2 wilmai; then
  wilmai "$@"
else
  npx -y @wilm-ai/wilma-cli@2 "$@"
fi
