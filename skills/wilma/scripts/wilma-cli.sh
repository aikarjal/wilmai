#!/usr/bin/env bash
set -euo pipefail

# Wrapper for wilma CLI that prefers non-interactive JSON output.
# Usage: wilma-cli.sh <args>

if command -v wilma >/dev/null 2>&1; then
  wilma "$@"
elif command -v wilmai >/dev/null 2>&1; then
  wilmai "$@"
else
  # Not installed: run the published CLI without installing it globally.
  npx -y @wilm-ai/wilma-cli "$@"
fi
