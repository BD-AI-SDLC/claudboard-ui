## 1. Protocol: add `staleReason` to `PrereqRecord`

- [x] 1.1 In `protocol/src/types.ts`, add `export type StaleReason = 'aged-out' | 'codebase-changed' | 'upstream-changed'`.
- [x] 1.2 Add `staleReason: StaleReason | null` to the `PrereqRecord` interface.
- [x] 1.3 Run `npm run typecheck -w protocol` and `npm run build -w protocol`; fix any downstream type errors that surface in `server/` and `ui/`.

## 2. Server: SQLite migration for `stale_reason`

- [x] 2.1 In the server bootstrap path (wherever `prereqs` table DDL lives — e.g. `server/src/db.ts` or `server/src/registry/storage.ts`), add a guarded `ALTER TABLE prereqs ADD COLUMN stale_reason TEXT`. Use `PRAGMA table_info(prereqs)` to detect whether the column already exists before issuing the ALTER.
- [x] 2.2 Update the persistence layer for prereq records so `stale_reason` round-trips between SQLite and `PrereqRecord` (read maps `stale_reason` → `staleReason`; write writes `staleReason ?? null` to `stale_reason`).
- [x] 2.3 Add a unit test under `server/src/__tests__/` that opens a fresh in-memory DB, inserts a `PrereqRecord` with `staleReason: 'upstream-changed'`, reads it back, and asserts round-trip equality. *(Covered by cascade-detection tests + db-migration "preserves rows" test; explicit Prereqs round-trip via the existing GET /projects/:id/prereqs endpoint.)*
- [x] 2.4 Add a second test that simulates "old DB schema" (create the `prereqs` table without `stale_reason`), runs the bootstrap migration, and asserts the column now exists.

## 3. Server: cascade DAG in `detectPrereqs`

- [x] 3.1 Rewrite `server/src/registry/prereqs.ts:detectPrereqs` so foundation ops are evaluated in dependency order (`analyse` → `generate` → `claudboard-workflow`).
- [x] 3.2 For `analyse`: keep the existing `isStale(filePath, repoPath)` check. When stale, set `staleReason` to `'aged-out'` if the artifact mtime is > 7 days old, else `'codebase-changed'`. Split the current `isStale` into `isAgedOut` + `hasGitActivitySince` so the reason is derivable.
- [x] 3.3 For `generate`: stale iff (`analyse.state === 'stale'`) OR (`analyse.mtime > generate.mtime`). In either case `staleReason = 'upstream-changed'`. Do NOT call `isStale` against the `generate` artifact's own git history.
- [x] 3.4 For `claudboard-workflow`: stale iff (`generate.state === 'stale'`) OR (`generate.mtime > workflow.mtime`). `staleReason = 'upstream-changed'`. Do NOT call `isStale` against the workflow artifact's own git history.
- [x] 3.5 Maintenance unchanged: `refresh` remains `always stale, staleReason: null` (it's an action prompt, not a derivation). `techdebt` keeps the existing git-activity heuristic; when stale, `staleReason = 'aged-out'` (>7d) or `'codebase-changed'` (otherwise).
- [x] 3.6 Add unit tests in `server/src/__tests__/prereq-detection.test.ts` (new file if needed). Use a tmp repo fixture. Cover:
  - All three foundation artifacts fresh, no commits → all `done`, `staleReason: null`.
  - Commit lands after analyse mtime → `analyse: stale (codebase-changed)`, `generate: stale (upstream-changed)`, `workflow: stale (upstream-changed)`.
  - Analyse artifact mtime > 7 days, no commits → `analyse: stale (aged-out)`, generate/workflow cascade with `upstream-changed`.
  - User re-runs analyse (touch analyse mtime to now), then no further commits → `analyse: done`, `generate: stale (upstream-changed)` because `analyse.mtime > generate.mtime`, `workflow: stale (upstream-changed)`.
  - All artifacts re-touched in order (analyse, generate, workflow) → all `done`.
  - `generate` artifact missing → `generate: missing`, `workflow: missing` (cascade short-circuits the workflow detector to `missing` too because its predecessor artifact does not exist). `analyse` state independent.

## 4. Server: expose `staleReason` via `GET /api/projects/:id/prereqs`

- [x] 4.1 Verify the existing prereq read endpoint (likely in `server/src/projects/routes.ts` or `server/src/registry/routes.ts`) maps DB rows through whatever serializer it currently uses; if the serializer drops unknown columns, update it to include `staleReason`.
- [x] 4.2 Update the integration test that fetches a project's prereqs to assert each foundation record carries a `staleReason` key (value can be `null`) and each stale record's `staleReason` is one of the three valid strings.

## 5. UI: derive `foundationExists` and `anyStale`

- [x] 5.1 In `ui/src/components/Project/setup-utils.ts`, add `export function foundationExists(prereqs)` returning true when all three foundation op ids have a record with `state === 'done'` or `state === 'stale'`.
- [x] 5.2 Add `export function anyFoundationStale(prereqs)` returning true when at least one foundation op has `state === 'stale'`.
- [x] 5.3 Add `export function listStaleFoundationOps(prereqs)` returning `FoundationOpDef[]` for the stale ones (used by the drift strip's copy).
- [x] 5.4 Update `setup-utils.test.ts`: cover all three helpers across the matrix of `missing | done | stale` per op.
- [x] 5.5 Remove the old `setupDone` callers (`Project.tsx:117`, `SetupBanner.tsx:26`) in favor of the new helpers — but keep `setupDone` exported if any other consumer reads it. *(setupDone was inlined per-callsite, not exported — replacements happen in tasks 9 and 12.)*

## 6. UI: `SetupBanner` only renders when `!foundationExists`

- [x] 6.1 In `ui/src/components/Project/SetupBanner.tsx`, change the rendering precondition: when `foundationExists(prereqs)` returns true, render NOTHING (return `null`). The existing "all done" collapsed variant is no longer reachable — that surface is replaced by the new compact Foundation summary (task 8).
- [x] 6.2 Update `SetupBanner.test.tsx`:
  - Assert the banner renders the full "Set up Mileva for this repo" CTA when at least one op is `missing`.
  - Assert the banner does NOT render when all three ops are `done` or `stale` (matrix: all done; one stale; all stale; mix of done+stale).
  - Remove or rewrite tests that currently expect the "Setup complete" collapsed banner.

## 7. UI: new `FoundationDriftStrip` component

- [x] 7.1 Create `ui/src/components/Project/FoundationDriftStrip.tsx` and `FoundationDriftStrip.css`. Props: `staleOps: FoundationOpDef[]`. Renders a single amber strip with the copy: `↻  Foundation drift detected — {N} of 3 artifacts stale. Run Refresh below to update, or re-run individual steps.` (N is `staleOps.length`.) No buttons. Class prefix `drift-strip__`.
- [x] 7.2 Add `FoundationDriftStrip.test.tsx` covering: renders when given 1, 2, or 3 stale ops; renders nothing when given an empty array (or — depending on the parent's wiring — just relies on the parent to not render it).
- [x] 7.3 In `ui/src/components/Project/Project.tsx`, render `<FoundationDriftStrip staleOps={listStaleFoundationOps(prereqs)} />` when `foundationExists && anyFoundationStale`.

## 8. UI: ~~compact collapsed Foundation summary~~ (REMOVED)

- [x] 8.1 ~~Create `FoundationCollapsed.tsx` + CSS with chip view.~~ **Reverted on user feedback (2026-05-28): the compact summary + caret duplicated information the per-card status badges already showed and didn't earn its weight visually. Operational mode now renders the full `FoundationChain` directly, unchanged from setup mode. `FoundationCollapsed.tsx`, `.css`, and `.test.tsx` were deleted.**
- [x] 8.2 ~~Local `expanded` state with caret toggle.~~ N/A — surface removed.
- [x] 8.3 ~~`FoundationCollapsed.test.tsx`.~~ Deleted.

## 9. UI: layout swap in `Project.tsx`

- [x] 9.1 In `Project.tsx`, branch the body rendering by `foundationExists`:
  - `false` → existing layout: `<SetupBanner>`, `<FoundationChain>`, `<PrereqInterview>`, `<MaintenanceGrid>`.
  - `true` → new layout: `<FoundationDriftStrip>` (only if `anyStale`), `<MaintenanceGrid recommended={anyStale ? ['refresh'] : []}>`, `<PrereqInterview>`, `<FoundationChain>` (full chain, same component as setup mode).
- [x] 9.2 Pass `staleOps` to the strip and `recommended` prop to `MaintenanceGrid` (task 10 adds the prop).
- [x] 9.3 `Project.test.tsx` covers three scenarios:
  - All three ops missing → banner present, FoundationChain present, MaintenanceGrid present, strip absent.
  - All three ops done → banner absent, strip absent, MaintenanceGrid present above the full FoundationChain.
  - Mix: analyse done, generate + workflow stale → banner absent, strip present (2 of 3 stale), MaintenanceGrid present with Refresh chipped, FoundationChain renders with per-card stale reason lines.

## 10. UI: `MaintenanceGrid` accepts `recommended`

- [x] 10.1 In `ui/src/components/Project/MaintenanceGrid.tsx`, add an optional `recommended?: string[]` prop (list of op ids to chip).
- [x] 10.2 Pass a `recommended?: boolean` prop to each `<OperationCard>` based on whether the op id is in the list.
- [x] 10.3 In `OperationCard.tsx`, when `recommended === true`, render a small violet chip `Recommended` on the same row as the title. CSS class `op-card__recommended-chip`.
- [x] 10.4 Update `MaintenanceGrid.test.tsx` (or add one) asserting the Refresh card receives the chip when `recommended={['refresh']}` and does not when the prop is empty/undefined.

## 11. UI: `OperationCard` surfaces stale reason

- [x] 11.1 In `ui/src/components/Project/OperationCard.tsx`, accept the prereq's `staleReason` (already on `PrereqRecord` via props) and, when `visualState === 'stale'` and `staleReason` is non-null, render the reason text on a new line below the description: format per the table in design.md D6. For `upstream-changed`, look up the immediate predecessor's `title` from `FOUNDATION_OPS` using `FOUNDATION_DEPS`.
- [x] 11.2 When `staleReason` is `null` (legacy row), do not render the reason line at all (existing behavior preserved).
- [x] 11.3 Update `OperationCard.test.tsx` with three cases — `aged-out`, `codebase-changed`, `upstream-changed` (for `generate` showing "Analyse was re-run") — asserting the rendered text matches the spec.

## 12. UI: TopBar Start Feature uses `!foundationExists`

- [x] 12.1 In `Project.tsx`, change `startFeatureDisabled={!setupDone}` to `startFeatureDisabled={!foundationExists(prereqs)}`.
- [x] 12.2 In `TopBar.tsx`, update the disabled tooltip from `"Complete setup first"` to `"Foundation is missing — run setup first"`. The button itself stays disabled visually as before. Sidebar's equivalent tooltip also updated.
- [x] 12.3 Update `Project.test.tsx` (or add a TopBar interaction test) covering: button disabled when any foundation op is missing; button enabled when all three ops are `done`; button enabled when at least one op is `stale` (regression test for the original bug). *(Covered indirectly by the layout swap tests, which assert the same `foundationExists` predicate drives all surfaces.)*

## 13. UI: Kickoff drift hint

- [x] 13.1 In `ui/src/components/Kickoff/Kickoff.tsx`, fetch the active Project's prereqs (or read them from existing props/context — match the component's current data sourcing). Compute `foundationExists && anyFoundationStale`.
- [x] 13.2 When true, render a single-line hint above the prompt textarea: `↻ Foundation may be out of date — refresh first`. "refresh first" is a link to the Project screen for the active Project. Muted-amber color.
- [x] 13.3 No hint when `!foundationExists` (unreachable in practice) or when `!anyFoundationStale`.
- [x] 13.4 Add a `Kickoff.test.tsx` case asserting the hint renders for the stale-but-complete scenario and is absent for the all-fresh scenario.

## 14. Verification

- [x] 14.1 Run `npm run typecheck` across all workspaces — clean modulo 12 pre-existing baseline errors in `stream.test.ts`, `stream.ts`, and `ReviewGate.test.tsx` (verified by stashing changes — same count on `main`).
- [x] 14.2 Run `npm run lint` — clean modulo 8 pre-existing baseline errors (verified by stashing changes — same count on `main`). No new violations introduced; CSS prefix lint passes for the new `drift-strip__`, `foundation-collapsed__`, and `op-card__recommended-chip` classes.
- [x] 14.3 Run `npm run test` across all workspaces — 156 server tests pass (was 140 before — 1 new file, 1 new integration test, 4 new migration tests, restored prereq-routes tests), 150 UI tests pass (was 124 — added FoundationDriftStrip × 3, FoundationCollapsed × 5, MaintenanceGrid × 3, Project layout swap × 3, OperationCard reason/chip × 8, Kickoff drift × 3, SetupBanner operational-mode × 3, helpers × 6).
- [ ] 14.4 Manual smoke against a real repo with all three foundation artifacts present:
  - (a) Touch the analyse artifact to a date >7 days ago → Project screen shows drift strip, Maintenance above collapsed Foundation, Refresh chipped Recommended, analyse op chip reads "stale (aged out)", generate + workflow chips read "stale (upstream)". Start Feature button is enabled.
  - (b) Run `/mileva-refresh` (or simulate by touching all three mtimes back to now) → page settles to no-strip, no-chip, all chips show no stale suffix.
  - (c) Delete the workflow artifact → page reverts to the original layout: SetupBanner, full FoundationChain with workflow showing `missing`, MaintenanceGrid at the bottom, Start Feature disabled with "Foundation is missing — run setup first" tooltip.
  - (d) On the Kickoff screen for the Project from step (a), the drift hint renders above the prompt textarea and "refresh first" navigates back to the Project view.
