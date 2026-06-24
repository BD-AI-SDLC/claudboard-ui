#!/usr/bin/env bash
# =============================================================================
# jira-add-labels.sh — Additively write labels to a Jira ticket via REST API.
#
# Why a script and not the MCP tool?
# ────────────────────────────────────────────────────────────────────────────
# mcp__atlassian__editJiraIssue only exposes the `fields` parameter, which is
# a DESTRUCTIVE write for the `labels` field (replaces the entire array). Any
# LLM-driven "read → merge → write" chain has a non-zero per-step skip rate;
# one skipped step silently destroys labels the user has accumulated.
#
# Jira's REST API supports a native additive operation on labels:
#   PUT /rest/api/3/issue/{key}  body: {"update":{"labels":[{"add":"L"},...}]}
# This operation cannot remove existing labels regardless of what the caller
# sends. Combined with a post-write verification step, label preservation is
# structural — no LLM judgment in the merge path.
#
# See: openspec/changes/jira-additive-labels/design.md for the full analysis.
#
# =============================================================================
# Usage:
#   jira-add-labels.sh --ticket <KEY> --add <label> [--add <label> ...]
#
# Required env vars (set before calling this script):
#   JIRA_EMAIL       — your Atlassian account email (e.g., dev@example.com)
#   JIRA_API_TOKEN   — your Jira API token (NOT your Atlassian password)
#                      Generate at: https://id.atlassian.com/manage-profile/security/api-tokens
#
# Config read at runtime from:
#   .claude/skills/feature-workflow/config.json  (jira.urlBase)
#
# Examples:
#   export JIRA_EMAIL=dev@example.com
#   export JIRA_API_TOKEN=your_api_token_here
#   jira-add-labels.sh --ticket MEAS-1234 --add AI --add AI_CLI
#   jira-add-labels.sh --ticket PLAT-100  --add AI --add AI_CLI --add BE
#
# Output on success (stdout, single JSON line):
#   {"ticket":"MEAS-1234","preLabels":["Existing"],"added":["AI","AI_CLI"],"postLabels":["Existing","AI","AI_CLI"]}
#
# Exit codes:
#   0 — success
#   1 — any failure (env vars missing, deps missing, Jira API error, label loss detected)
# =============================================================================

set -euo pipefail

# ── Env-var preflight ────────────────────────────────────────────────────────

missing_vars=""
[[ -z "${JIRA_EMAIL:-}" ]]      && missing_vars+=" JIRA_EMAIL"
[[ -z "${JIRA_API_TOKEN:-}" ]]  && missing_vars+=" JIRA_API_TOKEN"
if [[ -n "$missing_vars" ]]; then
  echo "Error: missing required env var(s):${missing_vars}" >&2
  echo "Remediation: export JIRA_EMAIL=you@example.com JIRA_API_TOKEN=<token>" >&2
  echo "  Get a Jira API token at: https://id.atlassian.com/manage-profile/security/api-tokens" >&2
  exit 1
fi

# ── Dependency preflight ─────────────────────────────────────────────────────

missing_deps=""
command -v curl >/dev/null 2>&1 || missing_deps+=" curl"
command -v jq   >/dev/null 2>&1 || missing_deps+=" jq"
if [[ -n "$missing_deps" ]]; then
  echo "Error: missing required tool(s):${missing_deps}" >&2
  echo "Install with: brew install${missing_deps}  (macOS) or apt-get install${missing_deps} (Debian/Ubuntu)" >&2
  exit 1
fi

# ── Parse CLI args ───────────────────────────────────────────────────────────

ticket=""
raw_labels=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ticket)
      [[ $# -lt 2 ]] && { echo "Error: --ticket requires a value" >&2; exit 1; }
      ticket="$2"; shift 2 ;;
    --add)
      [[ $# -lt 2 ]] && { echo "Error: --add requires a value" >&2; exit 1; }
      raw_labels+=("$2"); shift 2 ;;
    -h|--help)
      grep '^#' "$0" | head -45 | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Error: unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$ticket" ]]           && { echo "Error: --ticket <KEY> is required" >&2; exit 1; }
[[ ${#raw_labels[@]} -eq 0 ]] && { echo "Error: at least one --add <label> is required" >&2; exit 1; }

# Deduplicate --add labels (preserve first-seen order, bash 3 compatible)
labels_to_add=()
for label in "${raw_labels[@]}"; do
  is_dup=false
  if [[ ${#labels_to_add[@]} -gt 0 ]]; then
    for seen in "${labels_to_add[@]}"; do
      if [[ "$label" == "$seen" ]]; then is_dup=true; break; fi
    done
  fi
  if ! $is_dup; then labels_to_add+=("$label"); fi
done

# ── Read config at runtime ───────────────────────────────────────────────────

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_file="$script_dir/../config.json"

[[ -f "$config_file" ]] || {
  echo "Error: config.json not found at $config_file" >&2
  echo "  Expected path: .claude/skills/feature-workflow/config.json" >&2
  exit 1
}

url_base="$(jq -r '.jira.urlBase // empty' "$config_file")"
[[ -z "$url_base" ]] && {
  echo "Error: jira.urlBase is not set in config.json" >&2; exit 1
}
url_base="${url_base%/}"  # strip trailing slash if present

auth="${JIRA_EMAIL}:${JIRA_API_TOKEN}"

# ── Step 1: Read current labels ───────────────────────────────────────────────

get_tmp=$(mktemp)
get_code=$(curl -s -o "$get_tmp" -w "%{http_code}" \
  -u "$auth" \
  -H "Accept: application/json" \
  "${url_base}/rest/api/3/issue/${ticket}?fields=labels")
get_body=$(cat "$get_tmp"); rm -f "$get_tmp"

[[ "$get_code" == "200" ]] || {
  echo "Error: GET /rest/api/3/issue/${ticket}?fields=labels returned HTTP $get_code" >&2
  echo "$get_body" >&2
  exit 1
}

pre_labels="$(echo "$get_body" | jq -c '.fields.labels // []')"

# ── Step 2: Write additive labels via Jira update.labels[{add:...}] ──────────
# Using Jira's native additive operation — cannot remove existing labels.

adds_body="$(printf '%s\n' "${labels_to_add[@]}" \
  | jq -Rc '{"add":.}' \
  | jq -sc '{"update":{"labels":.}}')"

put_tmp=$(mktemp)
put_code=$(curl -s -o "$put_tmp" -w "%{http_code}" \
  -X PUT \
  -u "$auth" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$adds_body" \
  "${url_base}/rest/api/3/issue/${ticket}")
put_body=$(cat "$put_tmp"); rm -f "$put_tmp"

[[ "$put_code" == "204" ]] || {
  echo "Error: PUT /rest/api/3/issue/${ticket} returned HTTP $put_code" >&2
  echo "$put_body" >&2
  exit 1
}

# ── Step 3: Verify post-write labels ─────────────────────────────────────────

verify_tmp=$(mktemp)
verify_code=$(curl -s -o "$verify_tmp" -w "%{http_code}" \
  -u "$auth" \
  -H "Accept: application/json" \
  "${url_base}/rest/api/3/issue/${ticket}?fields=labels")
verify_body=$(cat "$verify_tmp"); rm -f "$verify_tmp"

[[ "$verify_code" == "200" ]] || {
  echo "Error: verify GET returned HTTP $verify_code (post-write check)" >&2
  exit 1
}

post_labels="$(echo "$verify_body" | jq -c '.fields.labels // []')"
adds_array="$(printf '%s\n' "${labels_to_add[@]}" | jq -Rc '.' | jq -sc '.')"

# Assert (pre ∪ adds) ⊆ post
missing="$(jq -cn \
  --argjson pre   "$pre_labels" \
  --argjson adds  "$adds_array" \
  --argjson post  "$post_labels" \
  '[( ($pre + $adds) | unique )[] | select(. as $e | ($post | map(. == $e) | any) | not)]')"

missing_count="$(echo "$missing" | jq 'length')"
if [[ "$missing_count" -gt "0" ]]; then
  jq -cn \
    --arg   ticket   "$ticket" \
    --argjson pre    "$pre_labels" \
    --argjson adds   "$adds_array" \
    --argjson post   "$post_labels" \
    --argjson missing "$missing" \
    '{"error":"label-loss-detected","ticket":$ticket,"preLabels":$pre,"requested":$adds,"postLabels":$post,"missing":$missing}' >&2
  exit 1
fi

# ── Success ───────────────────────────────────────────────────────────────────

jq -cn \
  --arg    ticket     "$ticket" \
  --argjson preLabels  "$pre_labels" \
  --argjson added      "$adds_array" \
  --argjson postLabels "$post_labels" \
  '{"ticket":$ticket,"preLabels":$preLabels,"added":$added,"postLabels":$postLabels}'
