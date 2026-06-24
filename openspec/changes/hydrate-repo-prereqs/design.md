## Context

The protocol type `Repo` (`protocol/src/types.ts:33-52`) declares `prereqs: Record<string, PrereqRecord>` as a non-optional field. The server has two endpoints that return `Repo` objects (`/api/repos`, `/api/repos/:id`) and one endpoint that returns the prereq map alone (`/api/repos/:id/prereqs`). Today the first two return `prereqs: {}` for every repo while the third returns the real data.

Two UI consumers (`App.tsx`, `Sidebar.tsx`) trust the protocol type and read `prereqs` directly off the `Repo` records they receive from the list endpoint. Both gate their "Start feature" affordance on `foundationExists(repo.prereqs)`. Both are permanently disabled.

A third UI consumer (`Project.tsx`) fetches `/api/repos/:id/prereqs` out-of-band on mount and stores the result in component state. Its TopBar's "Start feature" button works correctly. The Project view is the only place in the UI where this round-trip happens.

The decision in this change is: stop carrying two flavours of the same data across the wire. Make `mapRepoRow` populate `prereqs` from the same `detectPrereqs` + cache logic that the dedicated endpoint already uses, so every `Repo` returned by the server carries truth about its own prereqs.

## Goals / Non-Goals

**Goals:**

- `GET /api/repos` and `GET /api/repos/:id` SHALL return `Repo` records whose `prereqs` field reflects the same content as `GET /api/repos/:id/prereqs` for the same `id`, computed by the same code path.
- The prereq-building logic SHALL exist in exactly one place. The dedicated endpoint and the list endpoint SHALL call into the same helper.
- The Sidebar SHALL stop carrying its own inline copy of the foundation predicate; it SHALL import `foundationExists` from `setup-utils.ts`.
- "Start feature" navigation (from Dashboard CTA AND Sidebar item) SHALL land on a foundation-ready repo whenever one exists, even when the user's last-visited repo is not itself ready.
- The change SHALL be reversible by reverting the server-side `mapRepoRow` change plus two small UI edits. No protocol-shape change. No SQLite migration. No new endpoints.
- A regression test SHALL prove that `GET /api/repos` returns a non-empty `prereqs` map for a repo whose foundation artifacts exist on disk.

**Non-Goals:**

- Building the multi-project picker modal documented in `web-ui` spec lines 595-609. The smart-pick fallback stays; the picker is its own change.
- Removing or weakening the foundation-readiness gate. Users still cannot "Start feature" with no foundation present.
- Caching `detectPrereqs` results across requests. Filesystem reads are cheap enough for typical workspaces; a cache is premature optimisation.
- Redesigning the `mapRepoRow` function shape. Its single new parameter (the db handle) is the minimum disturbance required.

## Decisions

### D1: Extract `buildPrereqMap` as the single source of truth

The body of `routes.ts:147-180` contains the only correct implementation today. Extract the loop (lines 154-178) into a `buildPrereqMap(repoId: string, repoPath: string, db: Database): Record<string, PrereqRecord>` helper, co-located with the registry module in a new file `server/src/registry/prereq-map.ts` (or appended to an existing module — `project-config.ts` is reasonable since `mapRepoRow` lives there).

Both call sites then become:

```ts
// inside mapRepoRow (new signature)
prereqs: buildPrereqMap(row.id, row.path, db)
// inside /api/repos/:id/prereqs handler (existing endpoint)
res.json(buildPrereqMap(repoId, repo.path, db))
```

The helper SHALL accept `db` as an argument rather than calling `getDb()` internally, so it inherits the caller's transaction context and stays unit-testable. The existing `PrereqCacheRow` interface (`routes.ts:13-19`) moves to the new helper's module and is exported only if needed by tests.

### D2: `mapRepoRow` gains a `db` parameter — no overload

`mapRepoRow(row: RepoRow)` becomes `mapRepoRow(row: RepoRow, db: Database)`. The two existing call sites both have the db in scope; both update directly:

```ts
// /api/repos list
res.json(repos.map((row) => mapRepoRow(row, db)))
// /api/repos/:id single
res.json(mapRepoRow(repo, db))
```

No overload. No "if db then hydrate else don't" branch. Either every caller hydrates or the function shape lies about its return type. Defending the contract on the type system side is the whole reason this bug existed.

`mapRepoRow` is not exported from anywhere except `project-config.ts`, and it has exactly two call sites in `routes.ts` (verified by `grep -rn "mapRepoRow" server/src`). No tests reference it directly. The signature change is mechanical and low-risk.

### D3: Sidebar's inline check is byte-equivalent — replace with the shared helper

`Sidebar.tsx:56-60`:

```ts
const FOUNDATION_IDS = ['analyse', 'generate', 'claudboard-workflow']
const setupReady = targetRepo !== null && FOUNDATION_IDS.every((id) => {
  const s = targetRepo.prereqs[id]?.state
  return s === 'done' || s === 'stale'
})
```

`setup-utils.ts:127-132`:

```ts
export function foundationExists(prereqs: Record<string, PrereqRecord>): boolean {
  return FOUNDATION_OPS.every(op => {
    const s = prereqs[op.id]?.state
    return s === 'done' || s === 'stale'
  })
}
```

The two are equivalent: `FOUNDATION_OPS` (defined at `setup-utils.ts:33-37`) has exactly the three ids `analyse`, `generate`, `claudboard-workflow` in the same order. Replacing the inline block with `foundationExists(targetRepo.prereqs)` is purely a deduplication. It eliminates the small risk that the two predicates drift if `FOUNDATION_OPS` ever grows (e.g. if a fourth foundation op is added, the Sidebar would silently stop gating on it without this change).

The import path is `import { foundationExists } from '../Project/setup-utils.js'` — the Sidebar already imports from `../../api/client.js`, so the relative depth is established.

### D4: Two target-selection variables in the Sidebar

The Sidebar today has one `targetRepo` (lines 53-54) used by both "Project · health" and "Start feature". These two items want different things:

- **Project · health** is the diagnostic view for a single repo. Foundation-incomplete is a legitimate state for this view to display — that's the whole point of the page (it shows missing prereqs and offers buttons to run them). Any active repo is a fine target. Keep `targetRepo` as-is.
- **Start feature** needs a foundation-ready target. Even when at least one repo is ready, `lastVisitedRepoId` may point at an unprepared one — and the current code would then land the user in Kickoff for that unprepared repo (Kickoff itself does not currently guard against this).

Introduce a parallel `startFeatureTargetRepo`:

```ts
const startFeatureTargetRepo =
  (targetRepo && foundationExists(targetRepo.prereqs) ? targetRepo : null) ??
  repos.find((r) => foundationExists(r.prereqs)) ??
  null
```

Then `enabled: startFeatureTargetRepo !== null` for the "Start feature" item. The tooltip stays "Complete foundation setup on at least one project first" when null.

Note that `onStartFeature` is invoked unparameterised — App.tsx's `startFeature()` makes the final target choice. The Sidebar's `startFeatureTargetRepo` exists only to gate the item's enabled-state. The two must agree on the predicate (both use `foundationExists`) but they do not share a target value, because the Sidebar cannot pass a value through the `() => void` callback signature.

### D5: App.tsx `startFeature()` mirrors the same priority

```ts
function startFeature() {
  const lastVisited = repos.find(r => r.id === lastVisitedRepoId)
  const target =
    (lastVisited && foundationExists(lastVisited.prereqs) ? lastVisited : null) ??
    repos.find(r => foundationExists(r.prereqs))
  if (!target) return
  setRepoId(target.id)
  setRoute('kickoff')
}
```

The `repos.length === 0` and `repos.length === 1` branches in the current implementation collapse into the unified ready-preference rule. The 1-repo case is naturally handled: if there's one repo and it's ready, it's `lastVisited` (or the only entry); if it's not ready, the button is disabled and we never reach here.

Import: `App.tsx` adds `import { foundationExists } from './components/Project/setup-utils.js'`.

### D6: Server-side cost — accepted, not optimised

`detectPrereqs(repoPath)` reads a small set of files under `<repoPath>/.claude/` synchronously per call. For an N-repo `/api/repos` response this becomes N file-system probes. Measured behaviour (typical workspace, ≤10 repos, warm OS cache): sub-millisecond per call. We do NOT introduce a request-scoped cache or a poll/refresh model in this change.

If a future workspace at 50+ repos shows measurable latency on the dashboard load, the right fix is one of:

- a per-request memoisation inside the handler (cheap, scoped, no invalidation problem),
- moving prereq state into the DB and avoiding the filesystem probe entirely on list reads (bigger change),
- pre-computing on a debounce after writes to `.claude/` (out of scope).

None of those are appropriate to ship blind. This change accepts the simple cost and documents that the next move is profile-then-decide, not optimise-first.

### D7: Project.tsx's separate fetch is left alone

`Project.tsx:62` continues to call `api.getRepoPrereqs(projectId)` on mount. After this change, that endpoint and the per-row hydration return the same data, so the call is technically redundant for the initial render. But Project also re-fetches when an active run completes (`Project.tsx:74-79`) to reflect freshly-completed prereq state — that polling concern is independent of which list endpoint hydrates the row. Removing the dedicated endpoint or the Project view's polling is out of scope; both stay.

The dedicated endpoint also remains the single endpoint the Project view subscribes to. Coupling Project to the list endpoint would force a full repos-refresh on every prereq completion, which is wasteful. Two endpoints, same data, different access patterns. Both legitimate.

### D8: No new tests in the UI for the cosmetic deduplication

Replacing the Sidebar's inline check with `foundationExists` is type-checked and behaviour-equivalent. No new UI test is added for that specific change. The new test surface is server-side: a supertest case proving that `GET /api/repos` returns hydrated prereqs end-to-end for a repo with foundation artifacts on disk. That single test is the regression guard for the Whole Bug; if it passes, the Dashboard and Sidebar enable correctly by construction.

If we later need a UI-level regression test for "Sidebar enables Start feature when foundation is present", it can ride along with the picker-modal change, where the wider UX is reasoned about more deeply.

### D9: Spec deltas

- **`specs/workspace-registry/spec.md`** gets one ADDED requirement: the repo list/single endpoints SHALL return populated prereq state, computed by the same code path as the dedicated endpoint. Scenarios cover the list endpoint case explicitly. This locks in the contract that mapRepoRow currently breaks.
- **`specs/web-ui/spec.md`** gets one MODIFIED requirement (the existing "Sidebar smart-target" table and "Dashboard Start-feature CTA") to make the foundation-readiness gate explicit. Today the spec says "Start feature: Enabled when ≥1 active project" — that's the spec for a world with no foundation gate. The code has gated on foundation since the prereqs feature shipped; the spec needs to catch up. New text: "Enabled when ≥1 active project with `foundationExists(prereqs) === true`." Smart-target rule updates to "prefer last-visited if foundation-ready, else first foundation-ready repo."
