## Why

Once a Project has all three foundation artifacts on disk (`claudboard-analysis.md`, `CLAUDE.md` + rules, `feature-workflow/SKILL.md`), the user has demonstrably onboarded the repo. The current UI nonetheless reverts to a full "Set up Mileva for this repo" banner the moment any foundation prereq flips to `stale`, and the Top Bar's Start Feature button becomes disabled with the tooltip "Complete setup first". That copy is wrong — setup *is* complete; the artifacts are merely a bit out of date — and the gated Start Feature blocks real work for a soft signal.

Two related defects compound this:

1. **Staleness propagation is too coarse.** The current per-op detector applies the same git-activity heuristic independently to each foundation artifact, which means re-running `/mileva-analyse` (the canonical "the codebase changed enough to re-analyse" event) does not surface as drift on `generate` or `workflow`, and the user has no visual cue that the downstream artifacts are now derived from an outdated source.
2. **The Project screen's page composition assumes setup is unfinished.** The Foundation chain (3 large step-cards) sits above Maintenance (the actually-recurring operations: Refresh, Tech debt). Once foundation is complete, this ordering wastes the prime real estate on a one-time concern.

## What Changes

- **Staleness no longer hides "setup done".** When all three foundation artifacts exist, the "Set up Mileva for this repo" onboarding banner SHALL NOT render. The TopBar's Start Feature button SHALL be enabled. The banner only returns when at least one foundation artifact is `missing`.
- **Stale-aware "Refresh recommended" strip.** When all three foundation artifacts exist and at least one is `stale`, render a soft amber strip above the Maintenance section reading `↻ Foundation drift detected — N of 3 artifacts stale. Run Refresh below to update, or re-run individual steps.` The strip is purely informational; the recommended action is the existing Maintenance `Refresh` card (`/mileva-refresh` performs a delta update of `.claude/`), which is highlighted with a `Recommended` chip while any foundation op is stale.
- **Layout swap when foundation exists.** When all three foundation artifacts exist (regardless of staleness), the Project screen reorders to put **Maintenance above Foundation**. The Foundation section continues to render the full `FoundationChain` (3 step cards) below Maintenance — staleness is communicated by the per-card `OperationCard` reason line (D6) and by the `FoundationDriftStrip` above Maintenance. When any foundation op is `missing`, layout stays as today (banner → full Foundation chain → Maintenance).
- **Cascade DAG for foundation staleness.** Foundation prereq detection SHALL evaluate staleness as a dependency cascade:
  - `analyse`: stale via the existing git-activity heuristic (artifact mtime > 7 days OR git commits since mtime). Reason `aged-out` or `codebase-changed`.
  - `generate`: stale if `analyse` is stale, OR if `analyse.mtime > generate.mtime`. Reason `upstream-changed`. The git-activity heuristic is NOT applied to `generate`.
  - `claudboard-workflow`: stale if `generate` is stale, OR if `generate.mtime > workflow.mtime`. Reason `upstream-changed`. The git-activity heuristic is NOT applied to `workflow`.
- **Maintenance keeps the git-activity heuristic.** `refresh` is unchanged (always stale, no durable artifact). `techdebt` continues to use the git-activity heuristic against its own `summary.md` mtime.
- **Stale reason surfaced in the UI.** `PrereqRecord` carries a new `staleReason: 'aged-out' | 'codebase-changed' | 'upstream-changed' | null` field. The Foundation OperationCard for a stale op renders the reason next to the `Stale` badge:
  - `aged-out` → "Stale — older than 7 days"
  - `codebase-changed` → "Stale — codebase changed"
  - `upstream-changed` → "Stale — {upstream-op} was re-run"
- **Kickoff screen drift hint.** When the user opens the Kickoff screen for a Project whose foundation exists but has at least one stale op, render a subtle one-line hint above the prompt textarea: `↻ Foundation may be out of date — refresh first`. The text "refresh first" is a link that navigates back to the Project screen. No hint when all foundation is fresh or when any op is missing (that path is already blocked by the disabled Start Feature button on the previous screen).

## Capabilities

### Modified Capabilities

- `web-ui` — Project screen no longer treats stale foundation as "setup incomplete"; layout reorders Maintenance above Foundation once the three artifacts exist; new "drift detected" strip and "Recommended" Maintenance Refresh chip; Foundation OperationCard surfaces the per-op stale reason; Kickoff screen renders a subtle drift hint when applicable; TopBar's Start Feature disable rule depends on `missing`, not `stale`.
- `workspace-registry` — Prereq state detection adopts a cascade DAG for foundation staleness with three distinct reasons; the git-activity heuristic is retained for `analyse` and Maintenance ops only; the new `staleReason` field is recorded on each `PrereqRecord` row and returned by `GET /api/projects/:id/prereqs`.

## Impact

- **Protocol (`protocol/src/types.ts`):** add `staleReason: StaleReason | null` to `PrereqRecord`; introduce `type StaleReason = 'aged-out' | 'codebase-changed' | 'upstream-changed'`. Additive — older UI builds that ignore the field continue to work.
- **Server (`server/src/registry/prereqs.ts`):** rewrite `detectPrereqs` so foundation ops are evaluated in dependency order with cascade rules; emit `staleReason` alongside `state`. Update `server/src/registry/storage.ts` (or wherever prereqs are persisted) to round-trip the new column. SQLite schema gets a new nullable `stale_reason TEXT` column; on first boot a tiny migration adds it.
- **UI — derivation (`ui/src/components/Project/setup-utils.ts`):** drop the conflation of `stale` with `done` in `setupDone` math; introduce `foundationExists` (all three ops have an artifact regardless of freshness) as the new gate for layout swap and Start Feature enable. `deriveVisualState` and `deriveFoundationStates` continue to mirror the server's `state` field; the new `staleReason` is read straight off the record.
- **UI — Project screen (`ui/src/components/Project/Project.tsx`):** compute `foundationExists` and `anyStale`; render Maintenance above the full Foundation chain when `foundationExists`; render the "drift detected" strip when `foundationExists && anyStale`; render the existing banner only when `!foundationExists`.
- **UI — banners and cards:** new `FoundationDriftStrip` component (replaces `SetupBanner` in the stale-but-complete case); `MaintenanceGrid` accepts a `recommended: string[]` prop to chip the Refresh card; `OperationCard` accepts an optional `staleReason` prop and renders the human-readable string.
- **UI — TopBar (`ui/src/components/primitives/TopBar.tsx`) and `Project.tsx`:** `startFeatureDisabled = !foundationExists` (was `!setupDone`). Tooltip copy updates to "Foundation is missing — run setup first" so the disabled state is unambiguous.
- **UI — Kickoff (`ui/src/components/Kickoff/Kickoff.tsx`):** new subtle drift hint above the form when the active Project's foundation is complete but stale.
- **Tests:** new server unit tests for the cascade DAG (analyse re-run → generate & workflow flip to `upstream-changed`; git commit lands → analyse `codebase-changed` cascades down; aged-out leaf cascades down). New UI unit tests for `setup-utils` (foundationExists math, anyStale math), `FoundationDriftStrip` rendering, `Project.tsx` layout swap, Kickoff hint conditional. Existing `SetupBanner.test.tsx` updates to assert the banner *does not* render in the stale-but-complete case.
- **No breaking API changes.** Existing `PrereqRecord` consumers see a new optional field. The `prereq-runner` capability (which actually executes the CLI) is untouched — this change is detection + UI composition only.
