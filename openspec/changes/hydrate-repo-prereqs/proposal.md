## Why

Two production "Start feature" entry points are permanently disabled for every user on every session:

1. **The Dashboard ("Overview") TopBar button** (`ui/src/components/Dashboard/Dashboard.tsx:41-43`, gated by `App.tsx:205-213`).
2. **The Sidebar "Start feature" nav item** (`ui/src/components/primitives/Sidebar.tsx:100-110`).

Both compute an enablement boolean from `repo.prereqs` on each `Repo` in their `repos` array:

```ts
// App.tsx — feeds Dashboard
const anyRepoReady = repos.some((r) => foundationExists(r.prereqs))
// Sidebar.tsx — inline copy of the same check
const setupReady = targetRepo !== null && FOUNDATION_IDS.every((id) => {
  const s = targetRepo.prereqs[id]?.state
  return s === 'done' || s === 'stale'
})
```

Both consumers receive `Repo` records sourced from `GET /api/repos` (server/src/registry/routes.ts:132-138) and `GET /api/repos/:id` (lines 140-145). Both endpoints map rows via `mapRepoRow` in `server/src/registry/project-config.ts:73-85`, which hard-codes:

```ts
export function mapRepoRow(row: RepoRow): Repo {
  return {
    ...
    prereqs: {},   // ← always empty
    ...
  }
}
```

The third endpoint, `GET /api/repos/:id/prereqs` (routes.ts:147-180), DOES hydrate prereqs by calling `detectPrereqs(repo.path)` and joining the `prereqs` cache table. The Project view fetches that endpoint separately on mount (`Project.tsx:62`), which is why the Project TopBar's "Start feature" button works correctly: it operates on real data fetched out-of-band.

The Dashboard and Sidebar do not perform the secondary fetch — they trust the `prereqs` field on the `Repo` records they already have, which the protocol type (`protocol/src/types.ts:40`) declares non-optional (`prereqs: Record<string, PrereqRecord>`). The server is breaking its own type. `foundationExists({})` always returns `false`. `anyRepoReady` is always `false`. `setupReady` is always `false`. Both UIs render the button disabled with tooltips ("Foundation is missing — run setup first" / "Complete foundation setup on at least one project first") for users whose foundations are in fact complete.

The user-facing cost is direct: the Overview and Sidebar entry points to the Kickoff flow are unreachable. Users must navigate to a Project page to find a working button. The bug surface is wider than two buttons — any future consumer that reads `Repo.prereqs` from the list/single endpoints will silently inherit the same broken behaviour.

## What Changes

### Server (`server/src/registry/project-config.ts`, `server/src/registry/routes.ts`)

- Replace the `prereqs: {}` hard-coding in `mapRepoRow` with a hydrated map computed from `detectPrereqs(row.path)` plus the `prereqs` cache table — mirroring the logic of `/api/repos/:id/prereqs`. The hydration is REQUIRED for both `GET /api/repos` (list) and `GET /api/repos/:id` (single).
- Extract the prereq-record-building loop currently inlined at `routes.ts:154-178` into a shared helper (working name: `buildPrereqMap(repoId, repoPath, db)`) co-located with the registry module. Both `mapRepoRow`'s new path AND the existing `/api/repos/:id/prereqs` handler SHALL call this helper, so there is exactly one source of truth for "given a repo, what does its prereq map look like?".
- `mapRepoRow`'s signature SHALL accept the database handle (or the prereq map) as an additional argument so it can stay pure. The two existing call sites in `routes.ts` (lines 137, 144) update accordingly. No other module imports `mapRepoRow` today (verified by grep).

### UI (`ui/src/components/primitives/Sidebar.tsx`)

- Delete the inline `FOUNDATION_IDS` constant (line 56) and the inline `setupReady` computation (lines 57-60). Replace with `import { foundationExists } from '../Project/setup-utils.js'` and `const setupReady = targetRepo !== null && foundationExists(targetRepo.prereqs)`.
- The intent of this replacement is solely deduplication — the helper in `setup-utils.ts:127-132` is byte-for-byte the same predicate the sidebar inlines today. After the server fix, the sidebar receives populated prereqs and the helper returns the correct answer. No behaviour change beyond the deduplication.

### UI (`ui/src/App.tsx`)

- The `startFeature()` function (lines 141-151) currently picks the navigation target as `repos.find(r => r.id === lastVisitedRepoId) ?? repos[0]`. After the server fix, this can still land users in Kickoff for a repo whose foundation is missing — because the *enablement* check is "any repo ready" but the *target* check is "any repo at all".
- Update the target-selection rule to prefer a foundation-ready repo:
  1. `lastVisitedRepoId` IF that repo is foundation-ready (per `foundationExists(repo.prereqs)`)
  2. Else the first foundation-ready repo in `repos` (insertion order — same as `repos[0]` is today)
  3. Else (no ready repo): do nothing. This branch is unreachable in practice because the button is disabled in that case, but defending it keeps the function honest if a future caller bypasses the gate.

### UI (`ui/src/components/primitives/Sidebar.tsx`) — target selection

- The Sidebar's `targetRepo` constant (lines 53-54) is used for BOTH the "Project · health" nav item AND the "Start feature" nav item. The two items have different correctness requirements:
  - "Project · health" only needs any active repo (the page handles a foundation-incomplete repo gracefully — that's its primary job).
  - "Start feature" needs a foundation-ready target for the same reason as `App.tsx::startFeature()`.
- Introduce a separate `startFeatureTargetRepo` computation (parallel to the existing `targetRepo`): prefer last-visited if ready, else first ready, else `null`. The Sidebar's existing `enabled: repos.length >= 1 && setupReady` then naturally becomes `enabled: startFeatureTargetRepo !== null`. The "Project · health" item continues to use the existing `targetRepo`.
- `onStartFeature` is wired from App.tsx — the Sidebar passes through, the same `startFeature()` function decides the final target. The Sidebar's role is enablement display only. Therefore the Sidebar's `startFeatureTargetRepo` and App.tsx's internal `startFeature()` choice must use the SAME priority rule — both need updating in lockstep.

### Out of scope

- **Building the multi-project picker modal** referenced by the existing `web-ui` spec at lines 595-609. The spec describes a `ProjectPicker` modal for the N≥2 case; the current code uses a smart-pick fallback (last-visited or first). This change preserves the smart-pick behaviour and tightens its target choice; it does NOT build the picker. Picker delivery is a separate change with its own UX questions (selection persistence, default focus, paths-vs-names display).
- **Dropping the foundation-readiness gate entirely** (Option D from explore). The user-facing question "should you be able to start a feature on a repo with no foundation?" is answered "no" by the existing code and by both teams' intuition; this change does not relitigate it.
- **Caching `detectPrereqs` results across requests.** `detectPrereqs(repo.path)` performs synchronous filesystem reads against `.claude/` artifacts; the cost is small (single-digit ms per repo on warm cache). For typical workspaces (≤10 repos) the per-request cost is negligible. If profiling shows this becomes a bottleneck for workspaces with 50+ repos, a request-scoped cache or a poll-based refresh model is a follow-up change, not blocking this fix.
- **Refactoring `App.tsx::startFeature()` to live in a custom hook.** The current placement is fine for the scope of edits in this change; extracting it for testability is a separate cleanup.
- **The `prereqs: Record<string, PrereqRecord>` shape itself.** This change populates the field correctly; it does not change what's in a `PrereqRecord`. The protocol type stays the same.
- **The existing `live-prereq-detection-on-read` change.** That change (in `openspec/changes/`) refines when `detectPrereqs` runs. This change does not redefine detection — it only ensures the existing detection result is included in the `/api/repos` list response. The two changes compose cleanly: whatever detection model lives in `prereqs.ts`, both `/api/repos/:id/prereqs` and (post-this-change) `/api/repos` invoke it identically.
