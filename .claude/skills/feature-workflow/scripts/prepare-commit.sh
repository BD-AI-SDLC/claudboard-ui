#!/usr/bin/env bash
# Stages modified/deleted files, extracts ticket info from the branch name,
# and outputs the staged diff — all in one shot so the calling agent has
# everything it needs to write the commit message.

set -euo pipefail

# Load shared helpers (load_ticket_regex)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

TICKET_REGEX=$(load_ticket_regex)

# 1. Stage modified and deleted files
git add -u

# 2. Resolve ticket from branch name  (e.g. feature/PLAT-25986/description)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" =~ ($TICKET_REGEX) ]]; then
  TICKET="${BASH_REMATCH[1]}"
else
  TICKET=""
fi

# 3. Collect staged diff
DIFF=$(git diff --staged)

if [ -z "$DIFF" ]; then
  echo "ERROR: No staged changes found."
  exit 1
fi

# 4. Output structured context
cat <<CONTEXT
=== TICKET ===
${TICKET:-UNKNOWN}

=== BRANCH ===
$BRANCH

=== STAGED DIFF ===
$DIFF
CONTEXT
