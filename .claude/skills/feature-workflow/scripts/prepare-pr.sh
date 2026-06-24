#!/usr/bin/env bash
# Extracts branch info, ticket number, commit message, and commit hash
# for PR creation in Azure DevOps.

set -euo pipefail

# Load shared helpers (detect_main_branch, load_ticket_regex)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

MAIN_BRANCH=$(detect_main_branch)
TICKET_REGEX=$(load_ticket_regex)

# 1. Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 2. Ensure we're not on the main branch
if [ "$BRANCH" = "$MAIN_BRANCH" ]; then
  echo "ERROR: Cannot create a PR from the $BRANCH branch."
  exit 1
fi

# 3. Extract ticket number from branch name
if [[ "$BRANCH" =~ ($TICKET_REGEX) ]]; then
  TICKET="${BASH_REMATCH[1]}"
else
  TICKET="UNKNOWN"
fi

# 4. Count commits ahead of origin/<main>
COMMIT_COUNT=$(git rev-list --count "origin/$MAIN_BRANCH..HEAD" 2>/dev/null || echo "0")

if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "ERROR: No commits ahead of origin/$MAIN_BRANCH. Nothing to create a PR for."
  exit 1
fi

# 5. Get the commit hash and message
COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_MESSAGE=$(git log -1 --format=%s)
COMMIT_BODY=$(git log -1 --format=%b)

# 6. Get the diff stat against main
DIFF=$(git diff "origin/$MAIN_BRANCH..HEAD" --stat)

# 7. Check if branch is pushed to remote
REMOTE_STATUS="not_pushed"
if git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
  LOCAL_HASH=$(git rev-parse HEAD)
  REMOTE_HASH=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
  if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    REMOTE_STATUS="up_to_date"
  else
    REMOTE_STATUS="behind"
  fi
fi

# 8. Output structured context
cat <<CONTEXT
=== TICKET ===
$TICKET

=== BRANCH ===
$BRANCH

=== MAIN_BRANCH ===
$MAIN_BRANCH

=== COMMIT_COUNT ===
$COMMIT_COUNT

=== COMMIT_HASH ===
$COMMIT_HASH

=== COMMIT_MESSAGE ===
$COMMIT_MESSAGE

=== COMMIT_BODY ===
$COMMIT_BODY

=== REMOTE_STATUS ===
$REMOTE_STATUS

=== DIFF_STAT ===
$DIFF
CONTEXT
