#!/usr/bin/env bash
# Shared helpers for feature-workflow scripts.
# Source this file: `source "$(dirname "$0")/lib.sh"`
#
# Provides:
#   detect_main_branch  — echoes "main" or "master" (or whatever origin/HEAD points at)
#   load_ticket_regex   — echoes the ticket regex from config.json, with fallback
#   resolve_repo_root   — echoes the repo root to operate in (workspace mode support)
#
# Workspace mode: if REPO_PATH env var is set, all git and path operations
# use that directory instead of the current working directory.
# Example: REPO_PATH=/workspace/datahandler bash prepare-commit.sh

# Resolve the directory where git commands should run.
# Returns $REPO_PATH if set, else current directory.
resolve_repo_root() {
  if [ -n "${REPO_PATH:-}" ]; then
    echo "$REPO_PATH"
  else
    pwd
  fi
}

detect_main_branch() {
  local repo_root
  repo_root="$(resolve_repo_root)"
  local main
  main=$(git -C "$repo_root" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
  if [ -z "$main" ]; then
    if git -C "$repo_root" show-ref --verify --quiet refs/heads/main; then
      main="main"
    elif git -C "$repo_root" show-ref --verify --quiet refs/heads/master; then
      main="master"
    else
      echo "ERROR: Could not detect main branch (no origin/HEAD, no local main/master)" >&2
      return 1
    fi
  fi
  echo "$main"
}

load_ticket_regex() {
  local config=".claude/skills/feature-workflow/config.json"
  if [ -f "$config" ] && command -v jq >/dev/null 2>&1; then
    jq -r '.git.ticketRegex // "[A-Z]+-[0-9]+"' "$config"
  else
    echo "[A-Z]+-[0-9]+"
  fi
}
