## 1. Server: extract the shared `buildPrereqMap` helper

- [x] 1.1 Decide the helper's location. Two options:
  - Append to `server/src/registry/project-config.ts` (lives next to `mapRepoRow`; smallest file count delta).
  - New file `server/src/registry/prereq-map.ts` (single-responsibility; cleaner if the helper grows).
  Default: append to `project-config.ts` to minimise churn. The helper is ~25 lines.
- [x] 1.2 In the chosen file, export:
  ```ts
  import type Database from 'better-sqlite3'
  import { randomUUID } from 'node:crypto'
  import { detectPrereqs } from './prereqs.js'
  import type { PrereqRecord } from '@bosch-sdlc/protocol'

  interface PrereqCacheRow {
    id: string
    cmd: string
    last_run: string | null
    duration_ms: number | null
    cost_cents: number | null
  }

  export function buildPrereqMap(
    repoId: string,
    repoPath: string,
    db: Database.Database,
  ): Record<string, PrereqRecord> {
    const detections = detectPrereqs(repoPath)
    const cacheRows = db
      .prepare('SELECT id, cmd, last_run, duration_ms, cost_cents FROM prereqs WHERE project_id = ?')
      .all(repoId) as PrereqCacheRow[]
    const cacheByCmd = new Map<string, { id: string; lastRun: string | null; duration: number | null; cost: number | null }>()
    for (const row of cacheRows) {
      cacheByCmd.set(row.cmd, { id: row.id, lastRun: row.last_run, duration: row.duration_ms, cost: row.cost_cents })
    }
    const map: Record<string, PrereqRecord> = {}
    for (const d of detections) {
      const cached = cacheByCmd.get(d.cmd)
      map[d.cmd] = {
        id: cached?.id ?? randomUUID(),
        repoId,
        cmd: d.cmd,
        state: d.state,
        lastRun: cached?.lastRun ?? null,
        duration: cached?.duration ?? null,
        cost: cached?.cost ?? null,
        output: d.output,
        staleReason: d.staleReason,
      }
    }
    return map
  }
  ```
  This is a verbatim lift from `routes.ts:154-178` with the parameters made explicit. No semantic change.
- [x] 1.3 Type the `db` parameter as `Database.Database` (from `import type Database from 'better-sqlite3'`). Confirm by grepping for the same pattern in `server/src/db.ts` or another module that already passes db handles around. If the project uses a different alias, match it.
- [x] 1.4 Do NOT have `buildPrereqMap` call `getDb()` itself — always accept db as a parameter. This keeps it usable inside any future transaction and unit-testable with an in-memory db.

## 2. Server: rewrite the `/api/repos/:id/prereqs` handler to call the helper

- [x] 2.1 In `server/src/registry/routes.ts`, simplify the handler:
  ```ts
  router.get('/repos/:id/prereqs', (req, res) => {
    const db = getDb()
    const repoId = req.params['id'] as string
    const repo = db.prepare('SELECT id, path FROM repos WHERE id = ?').get(repoId) as { id: string; path: string } | undefined
    if (!repo) return void res.status(404).json({ error: 'Repo not found' })
    res.json(buildPrereqMap(repoId, repo.path, db))
  })
  ```
- [x] 2.2 Delete the now-orphaned `PrereqCacheRow` interface at `routes.ts:13-19` (it moved to `project-config.ts` in step 1.2). Delete the `randomUUID` import from `routes.ts:2` IF no other usage remains (verify with grep — currently used only in this handler).
- [x] 2.3 Delete the `import type { PrereqRecord }` at `routes.ts:11` IF the helper now owns all `PrereqRecord` shaping. Verify with grep.
- [x] 2.4 Add `import { buildPrereqMap, mapRepoRow } from './project-config.js'` (merge into the existing `mapRepoRow` import line).

## 3. Server: update `mapRepoRow` to hydrate `prereqs`

- [x] 3.1 In `server/src/registry/project-config.ts`, change the signature:
  ```ts
  export function mapRepoRow(row: RepoRow, db: Database.Database): Repo {
    return {
      id: row.id,
      projectId: row.project_id,
      path: row.path,
      name: row.name,
      topology: row.topology as Repo['topology'],
      status: row.status as Repo['status'],
      prereqs: buildPrereqMap(row.id, row.path, db),
      defaultAutonomy: readDefaultAutonomy(row.path),
      featureWorkflowProjectKey: readFeatureWorkflowProjectKey(row.path),
    }
  }
  ```
- [x] 3.2 Update the two call sites in `server/src/registry/routes.ts`:
  - Line 137: `res.json(repos.map((row) => mapRepoRow(row, db)))` (was `repos.map(mapRepoRow)`).
  - Line 144: `res.json(mapRepoRow(repo, db))` (was `mapRepoRow(repo)`).
- [x] 3.3 Run `grep -rn "mapRepoRow" server/src protocol/src ui/src` to confirm no other call site exists. Expected: the two updated lines in `routes.ts`, the new definition in `project-config.ts`, and the `import { mapRepoRow, buildPrereqMap }` in `routes.ts`. Nothing else.
- [x] 3.4 Typecheck the server package: `npm run typecheck -w server`. The function-signature change is a hard compile error if any other caller exists — this is the backstop for 3.3.

## 4. Server: integration test for the list endpoint hydration

- [x] 4.1 The integration-test pattern lives in `server/src/registry/__tests__/`. Confirm the directory and find the closest existing supertest case for the registry router as a structural template (e.g. an existing `routes.test.ts` if present; otherwise the `prereq-runner` tests for the supertest+in-memory-db idiom).
- [x] 4.2 Add a test case (in an existing `routes.test.ts` or a new `repos-list-prereqs.test.ts` co-located in `server/src/registry/__tests__/`) that:
  - Bootstraps an in-memory or temp-dir SQLite via the existing test helper (mirror an existing test).
  - Seeds a project + a repo whose path is a temp directory.
  - Creates the foundation artifacts on disk under `<tempPath>/.claude/` that `detectPrereqs` recognises as `done` — minimally: `CLAUDE.md`, `.claude/rules/some-rule.md`, `.claude/skills/feature-workflow/SKILL.md`, and `.claude/reports/claudboard-analysis.md` with a recent `generated_at`. (Mirror what the closest existing prereqs test does — those files already have known shapes.)
  - Hits `GET /api/repos?projectId=<id>` via supertest.
  - Asserts `res.status === 200`, `res.body.length === 1`, and `res.body[0].prereqs.analyse.state` is one of `'done' | 'stale'` (NOT undefined, NOT `'missing'` given the seeded files).
- [x] 4.3 Add a parallel assertion against `GET /api/repos/:id` — same expectation for the single-repo endpoint.
- [x] 4.4 Optionally add a "negative" assertion: a repo with NO `.claude/` artifacts returns `prereqs.analyse.state === 'missing'`. This pins down that the hydration runs and produces the empty-state correctly, rather than appearing to work because of a coincidental cache hit.
- [x] 4.5 Run the server test suite: `npm run test -w server`. All existing tests SHALL still pass. The new test(s) SHALL pass.

## 5. UI: replace the Sidebar's inline foundation check with the shared helper

- [x] 5.1 In `ui/src/components/primitives/Sidebar.tsx`, add the import:
  ```ts
  import { foundationExists } from '../Project/setup-utils.js'
  ```
- [x] 5.2 Delete lines 56-60 (the `FOUNDATION_IDS` constant and the inline `setupReady` computation).
- [x] 5.3 Replace with a `startFeatureTargetRepo` computation that prefers a foundation-ready repo:
  ```ts
  const startFeatureTargetRepo =
    (targetRepo && foundationExists(targetRepo.prereqs) ? targetRepo : null) ??
    repos.find((r) => foundationExists(r.prereqs)) ??
    null
  ```
  Place this immediately after the existing `targetRepo` (`Sidebar.tsx:53-54`).
- [x] 5.4 Update the "Start feature" nav item (currently `Sidebar.tsx:100-110`) so its `enabled` and `tooltip` derive from the new variable:
  ```ts
  {
    id: 'kickoff',
    label: 'Start feature',
    icon: 'rocket',
    enabled: startFeatureTargetRepo !== null,
    tooltip: repos.length < 1
      ? 'Attach a repo first'
      : startFeatureTargetRepo === null
        ? 'Complete foundation setup on at least one project first'
        : undefined,
    handler: onStartFeature,
  }
  ```
- [x] 5.5 The "Project · health" item continues to use the existing `targetRepo`. No change.
- [x] 5.6 Typecheck the UI package: `npm run typecheck -w ui`. PASS expected.

## 6. UI: smart target selection in App.tsx::startFeature()

- [x] 6.1 In `ui/src/App.tsx`, add the import:
  ```ts
  import { foundationExists } from './components/Project/setup-utils.js'
  ```
- [x] 6.2 Replace the body of `startFeature()` (lines 141-151):
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
- [x] 6.3 Confirm no other call site of `startFeature()` exists. Grep: `grep -rn "startFeature\b" ui/src`. Expected hits: the function definition, the Dashboard prop (line 212), the Sidebar prop (line 231). All three update by virtue of the new function body — no caller signature change.

## 7. Build & verification

- [x] 7.1 From repo root: `npm run typecheck && npm run lint && npm test`. All PASS.
- [x] 7.2 From repo root: `npm run build`. PASS (the protocol → server → ui sequence is enforced; no protocol change in this proposal but the build still validates the import chain).
- [x] 7.3 Manual verification via the `launch-app` skill:
  - Attach (or use existing) two projects: one with a complete foundation (`/claudboard-analyse`, `/claudboard-generate`, `/claudboard-workflow` all done) and one with no foundation.
  - Open the Overview page. Confirm the TopBar "Start feature" button is ENABLED (rocket icon, no lock icon).
  - Click it. Confirm navigation to Kickoff for the foundation-ready repo (not the unprepared one), even if the unprepared one was last-visited.
  - Open the Sidebar. Confirm the "Start feature" item is ENABLED (not greyed). Click it. Confirm the same navigation.
  - Open the Project view for the unprepared repo (so it becomes `lastVisitedRepoId`), then return to Overview. Confirm both Start feature affordances still navigate to the foundation-ready repo (preference for ready outranks last-visited).
  - Detach the foundation-ready repo so only the unprepared one remains. Confirm both Start feature affordances become DISABLED with the documented tooltip.

## 8. PR

- [x] 8.1 Per the per-change branching rule in `MEMORY.md`, cut a fresh branch off `main`:
  ```bash
  git checkout main && git pull
  git checkout -b fix/hydrate-repo-prereqs
  ```
  Do NOT bundle this onto a branch carrying another OpenSpec change.
- [ ] 8.2 Commit using Conventional Commits. Suggested message:
  ```
  fix(server): hydrate Repo.prereqs in /api/repos response

  The repos list and single-repo endpoints returned prereqs: {},
  breaking the Dashboard TopBar "Start feature" button and the
  Sidebar "Start feature" nav item (both gated on r.prereqs).
  Extract the prereq-build loop from /api/repos/:id/prereqs into
  a shared helper and have mapRepoRow use it. Also: dedupe the
  Sidebar's inline foundation check and prefer a foundation-ready
  repo when picking the default Start-feature target.
  ```
- [ ] 8.3 Open the PR. Body links this change directory (`openspec/changes/hydrate-repo-prereqs/`), the failing-button screenshot(s) before-and-after, and notes the two spec deltas (`workspace-registry` ADDED, `web-ui` MODIFIED).
- [ ] 8.4 After merge, archive the change via the `openspec-archive-change` skill. The `workspace-registry` and `web-ui` spec deltas promote into the live specs at that time.
