## Why

The three foundation prereqs — `analyse`, `generate`, `claudboard-workflow` — are onboarding rituals, not recurring maintenance. The cascade-DAG staleness model introduced by `foundation-staleness-soft-gate` (PR #11, merged) treats them as continuously-drifting artifacts and gates new workflow runs behind redundant re-analyse + re-generate cycles whenever the codebase changes or seven days pass. That model does not match how the tool is actually used. Drift management is the dedicated job of `refresh`, which already exists for that purpose.

This change makes the foundation ops one-time setup tasks (binary `missing | done`), strips the cascade machinery from server and UI, and reframes `refresh` as the canonical answer to "the codebase has drifted." `techdebt` is unaffected — it keeps its independent git-activity heuristic.

Supersedes `foundation-staleness-soft-gate`. That change should be archived as-is so the openspec history preserves the record of the cascade DAG having been tried and rolled back.

## What Changes

- **Foundation ops become binary.** `analyse`, `generate`, `claudboard-workflow` report `state: 'done'` whenever their artifact exists on disk, `'missing'` otherwise. They never report `'stale'`. The git-activity heuristic, the aged-out heuristic, and the upstream-cascade rule are all removed for these three ops.
- **`StaleReason` loses `'upstream-changed'`.** The union becomes `'aged-out' | 'codebase-changed'`. Only `techdebt` still emits a stale reason; foundation rows always persist `staleReason: null`. **BREAKING** for any consumer that exhaustively switches on `StaleReason` — internal only; no published consumers.
- **Re-run path for foundation is manual artifact deletion.** No in-app re-run affordance for the locked cards in this change. Documented terminal step: `rm <artifact>` followed by re-running the relevant claudboard skill. An in-app "Delete artifact and re-run" overflow menu is tracked as deferred future work in design.md.
- **`refresh` stays unchanged behaviorally, gets reframed in copy.** Always clickable, always `state: 'stale'`. Card description rewritten to emphasize its role: "Updates rules and skills to match recent code changes. Run when the codebase has drifted."
- **Layout swap trigger flips.** `Project.tsx` reorders Maintenance above Foundation when `foundationDone` (all three artifacts present), not `foundationExists` (which under the old cascade model was the same predicate but framed differently). Foundation cards in the post-setup layout render as locked "Setup complete" tiles with no click handler.
- **Start Feature gate flips.** `startFeatureDisabled = !foundationDone`. Once setup is done, Start Feature is permanently enabled — no staleness can re-disable it. Tooltip simplifies to "Setup is missing — run foundation first" when disabled.
- **UI surfaces deleted.** `FoundationDriftStrip`, the `Kickoff` drift hint, and the `MaintenanceGrid` `recommended` chip are removed. `SetupBanner` is unchanged (still renders when any foundation op is `missing`).
- **DB column kept, semantics narrowed.** The `stale_reason TEXT` column on the `prereqs` table stays (additive-only schema rule). Foundation rows always write `null`. No migration required.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `workspace-registry`: simplify `Prereq state detection` so foundation ops are binary; drop the cascade DAG, the `upstream-changed` reason, and the foundation-side aged-out and git-activity heuristics. `techdebt` and `refresh` rules unchanged.
- `web-ui`: drop the `FoundationDriftStrip`, the Kickoff drift hint, and the `MaintenanceGrid` `recommended` chip. `OperationCard` (foundation, `done`) renders as locked. Layout swap and Start Feature gate switch from `foundationExists` to `foundationDone`. `SetupBanner` unchanged.

## Impact

- **Server (`server/src/registry/prereqs.ts`):** rewrite the foundation block of `detectPrereqs` to return `existsSync(artifact) ? 'done' : 'missing'`. Delete `hasGitActivitySince` and `isAgedOut` calls for foundation ops (helpers themselves remain — `techdebt` still uses them). Remove all cascade logic.
- **Protocol (`protocol/src/types.ts`):** remove `'upstream-changed'` from the `StaleReason` union. The `staleReason` field on `PrereqRecord` stays optional/nullable. Internal-only; no external consumers.
- **UI (`ui/src/components/Project/`):** delete `FoundationDriftStrip.tsx` + its CSS + tests. Edit `Project.tsx` to use `foundationDone` for layout swap and Start Feature gate; remove `anyStale` / drift-strip rendering. Edit `OperationCard.tsx` so foundation `done` cards render without a click handler and without the staleness reason line (the reason line stays for `techdebt`). Edit `MaintenanceGrid.tsx` to drop the `recommended` prop and chip. Edit `Kickoff.tsx` to delete the drift hint. Edit `setup-utils.ts` to add `foundationDone` and remove `anyStale` / `foundationExists` (or repurpose `foundationExists` as `foundationDone` — same predicate now).
- **UI tests:** delete `FoundationDriftStrip.test.tsx`; update `Project.test.tsx` and `Kickoff.test.tsx` to remove drift-strip and hint cases and add tests for the locked-card behavior; update `OperationCard.test.tsx` to remove the `upstream-changed` case and add a locked-foundation-card case; update `MaintenanceGrid.test.tsx` to remove the chip case.
- **Server tests:** rewrite `server/src/__tests__/prereq-detection.test.ts` cascade tests as "foundation ops never report stale" tests; keep the `techdebt` and `refresh` cases as-is.
- **No DB migration.** The `stale_reason` column stays; foundation rows just stop populating it.
- **No protocol consumers outside this repo** — `'upstream-changed'` removal is safe.
- **Soft-gate change handling.** `foundation-staleness-soft-gate` (48/49 tasks done; PR #11 merged) is archived as-is. Its remaining task 14.4 (manual smoke) is dropped — it would smoke-test behavior this change immediately removes. The new change's tasks.md includes a step to run `openspec archive foundation-staleness-soft-gate` before this change's spec deltas are applied.
