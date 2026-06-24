#!/usr/bin/env bash
# Gathers context for squashing: extracts ticket info from the branch name,
# counts commits ahead of the main branch, and captures the combined diff —
# all in one shot so the calling agent has everything it needs.

set -euo pipefail

# Load shared helpers (detect_main_branch, load_ticket_regex)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

MAIN_BRANCH=$(detect_main_branch)
TICKET_REGEX=$(load_ticket_regex)

# 1. Pull latest main to ensure we're working against an up-to-date base
if ! git pull origin "$MAIN_BRANCH" --rebase; then
  echo "ERROR: Rebase conflicts detected while pulling $MAIN_BRANCH."
  echo "Aborting rebase to restore your branch to its original state."
  git rebase --abort 2>/dev/null
  echo "Please resolve conflicts with $MAIN_BRANCH manually, then retry."
  exit 1
fi

# 2. Resolve branch and ticket
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" =~ ($TICKET_REGEX) ]]; then
  TICKET="${BASH_REMATCH[1]}"
else
  TICKET=""
fi

# 3. Count commits ahead of main
COMMIT_COUNT=$(git rev-list --count "$MAIN_BRANCH..HEAD")

if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "ERROR: No commits to squash — branch is not ahead of $MAIN_BRANCH."
  exit 1
fi

# 4. Collect combined diff against main
DIFF=$(git diff "$MAIN_BRANCH..HEAD")

if [ -z "$DIFF" ]; then
  echo "ERROR: No diff found between $MAIN_BRANCH and HEAD."
  exit 1
fi

# 5. Output structured context
cat <<CONTEXT
=== TICKET ===
${TICKET:-UNKNOWN}

=== BRANCH ===
$BRANCH

=== MAIN_BRANCH ===
$MAIN_BRANCH

=== COMMIT_COUNT ===
$COMMIT_COUNT

=== COMBINED DIFF ===
$DIFF
CONTEXT
