## 1. Pre-deploy: archive the superseded change

- [x] 1.1 Run `openspec archive foundation-staleness-soft-gate` from the repo root so its spec deltas land in `openspec/specs/workspace-registry/spec.md` and `openspec/specs/web-ui/spec.md`. Drop task 14.4 (manual smoke) — it would smoke-test behavior this change immediately removes.
- [x] 1.2 Sanity-check that `openspec list --json` no longer shows `foundation-staleness-soft-gate` as in-progress and that `openspec/changes/archive/` contains the archived directory.

## 2. Server: simplify foundation prereq detection

- [x] 2.1 In `server/src/registry/prereqs.ts`, rewrite the `analyse` block of `detectPrereqs` so the state is `existsSync(analysisPath) ? 'done' : 'missing'`. Remove the `hasGitActivitySince` and `isAgedOut` calls for this op. `staleReason` is always `null`.
- [x] 2.2 In the same file, rewrite the `generate` block: `state = existsSync(claudeMdPath) && existsSync(rulesDir) ? 'done' : 'missing'`. Remove the cascade condition that read `analyseState` / `analyseMtime`. `staleReason` is always `null`.
- [x] 2.3 In the same file, rewrite the `claudboard-workflow` block: `state = existsSync(skillPath) ? 'done' : 'missing'`. Remove the cascade condition that read `generateState` / `generateMtime`. `staleReason` is always `null`.
- [x] 2.4 Leave `hasGitActivitySince`, `isAgedOut`, `STALE_DAYS`, and `MS_PER_DAY` in place — they continue to be used by the `techdebt` block. Do not delete them.
- [x] 2.5 Leave the `refresh` block unchanged (`state: 'stale', staleReason: null`).
- [x] 2.6 Leave the `techdebt` block unchanged.
- [x] 2.7 Update the JSDoc above `detectPrereqs` to remove the cascade-DAG language and replace it with one sentence stating that foundation ops are evaluated independently as binary existence checks.

## 3. Server: drop cascade-related tests, add binary tests

- [x] 3.1 In `server/src/__tests__/prereq-detection.test.ts`, delete tests that assert cascade behavior (the soft-gate-era tests covering `upstream-changed`, `analyse-aged-out → generate-stale`, `commit-since-analyse → cascade`).
- [x] 3.2 Add a test: foundation ops with aged artifacts and git commits since report `done`, not `stale`.
- [x] 3.3 Add a test: re-running analyse (bumping its mtime) does not flip generate/workflow to stale.
- [x] 3.4 Add a test: missing generate artifact does not cascade — workflow remains `done` if its own artifact exists.
- [x] 3.5 Add a test: manually deleting an artifact flips the op to `missing` on next detection.
- [x] 3.6 Keep existing `techdebt` and `refresh` tests intact.
- [x] 3.7 Run `npm run test -w server` and confirm green.

## 4. Protocol: narrow the StaleReason union

- [x] 4.1 In `protocol/src/types.ts`, change `export type StaleReason = 'aged-out' | 'codebase-changed' | 'upstream-changed'` to `export type StaleReason = 'aged-out' | 'codebase-changed'`. Leave the `staleReason` field on `PrereqRecord` as `StaleReason | null`.
- [x] 4.2 Run `npm run build -w protocol` to surface every call site that switches on `'upstream-changed'` — fix each one by removing the case (TypeScript exhaustiveness will guide you).
- [x] 4.3 Run `npm run typecheck` across all workspaces and confirm green modulo the documented pre-existing baseline errors.

## 5. UI: delete drift-related components and tests

- [x] 5.1 Delete `ui/src/components/Project/FoundationDriftStrip.tsx`.
- [x] 5.2 Delete `ui/src/components/Project/FoundationDriftStrip.css`.
- [x] 5.3 Delete `ui/src/components/Project/FoundationDriftStrip.test.tsx`.
- [x] 5.4 Search the UI for residual imports of `FoundationDriftStrip` and remove them.
- [x] 5.5 Search for the Kickoff drift-hint code in `ui/src/components/Kickoff/Kickoff.tsx` (added by soft-gate task 13.1–13.3) and delete it along with its CSS and the corresponding test cases in `Kickoff.test.tsx`.
- [x] 5.6 In `ui/src/components/Project/MaintenanceGrid.tsx`, remove the `recommended` prop and the `Recommended` chip rendering on the Refresh card. Remove the matching test cases in `MaintenanceGrid.test.tsx`.

## 6. UI: simplify setup-utils

- [x] 6.1 In `ui/src/components/Project/setup-utils.ts`, add or repurpose `foundationDone(prereqs): boolean` returning `true` iff all of `analyse`, `generate`, `claudboard-workflow` have `state === 'done'`. If `foundationExists` already exists, rename it to `foundationDone` (they collapse to the same predicate now).
- [x] 6.2 Remove `anyFoundationStale` (or equivalent) and any other helper whose only role was to gate the drift strip / drift hint.
- [x] 6.3 Update `setup-utils.test.ts` to drop the `anyFoundationStale` cases and add a `foundationDone` case (all `done` → `true`; any `missing` → `false`; legacy rows with `staleReason` set are no longer relevant — drop those cases).

## 7. UI: Project screen layout swap and Start Feature gate

- [x] 7.1 In `ui/src/components/Project/Project.tsx`, replace the `foundationExists`-keyed layout swap with a `foundationDone`-keyed swap. The page composition rule:
  - `foundationDone === false` → Setup mode: `SetupBanner` → `FoundationChain` → `MaintenanceGrid`.
  - `foundationDone === true` → Operational mode: `MaintenanceGrid` → `FoundationChain` (locked variant).
- [x] 7.2 Delete the `anyStale` calculation and the `FoundationDriftStrip` render block. Delete any `recommended` prop passed to `MaintenanceGrid`.
- [x] 7.3 In the TopBar, change `startFeatureDisabled={!foundationExists(prereqs)}` to `startFeatureDisabled={!foundationDone(prereqs)}`. The tooltip stays at `"Foundation is missing — run setup first"`.
- [x] 7.4 Update `Project.test.tsx`: remove the drift-strip case, remove the "stale-but-complete" layout case, add an "operational-mode locked cards" case, keep the Setup-mode case.

## 8. UI: OperationCard locked variant

- [x] 8.1 In `ui/src/components/Project/OperationCard.tsx`, branch on a new `variant: 'foundation-setup' | 'foundation-locked' | 'maintenance'` prop (or equivalent — match the existing component's pattern). The locked variant renders title + check-mark + `Setup complete` subtitle, no badges, no buttons, `aria-disabled="true"`, `pointer-events: none` in CSS.
- [x] 8.2 In `OperationCard.tsx`, remove the foundation-specific `Stale — …` reason line rendering. The `techdebt` (Maintenance) path retains its existing reason-line rendering for `'aged-out' | 'codebase-changed'`.
- [x] 8.3 In `ui/src/components/Project/FoundationChain.tsx`, when `foundationDone === true` is passed down (or detected from the chain's state), render every card with the `foundation-locked` variant. Otherwise render the existing Setup-mode variants (done/next/locked positional).
- [x] 8.4 Add CSS in `Setup.css` (or `OperationCard.css` if that exists) for the locked variant: muted check-mark, `aria-disabled` styling, `pointer-events: none`, no hover affordance.
- [x] 8.5 Update `OperationCard.test.tsx`:
  - Delete the `Aged-out reason rendered for the analyse op` case.
  - Delete the `Codebase-changed reason rendered for the analyse op` case.
  - Delete the `Upstream-changed reason names the predecessor` case.
  - Add a `Locked foundation card renders check + Setup complete + aria-disabled` case for each of analyse/generate/workflow.
  - Keep any `techdebt` reason-line cases.

## 9. UI: Refresh card description copy

- [x] 9.1 In whatever component or data file defines the Maintenance Refresh card's description text (likely `MaintenanceGrid.tsx` or a constants file alongside it), update the description to a phrasing that satisfies the "Refresh operation card description emphasizes drift-management role" requirement. Suggested copy: `"Updates rules and skills to match recent code changes. Run when the codebase has drifted."`.
- [x] 9.2 Update any test that asserts on the previous description text.

## 10. End-to-end verification

- [x] 10.1 Run `npm run build` from the repo root and confirm green (protocol → server → ui).
- [x] 10.2 Run `npm run typecheck` and confirm no NEW errors beyond the documented baseline.
- [x] 10.3 Run `npm run lint` and confirm no new violations (CSS prefix lint passes for any new locked-card classes).
- [x] 10.4 Run `npm test` across all workspaces and confirm green.
- [ ] 10.5 Manual smoke against a real repo:
  - (a) Fresh repo (no `.claude/`): Project screen renders Setup mode — `SetupBanner` + full `FoundationChain` + `MaintenanceGrid`. Start Feature is disabled.
  - (b) Run the three foundation skills in order via the cards. After each, the chain advances. After the third, the page swaps: `MaintenanceGrid` on top, locked `FoundationChain` below. Start Feature is enabled and stays enabled.
  - (c) Touch all three foundation artifacts' mtimes to 30 days ago and add a git commit. Reload. The page composition is unchanged (no drift strip, no recommended chip, Start Feature still enabled, cards still locked).
  - (d) Run `rm .claude/reports/claudboard-analysis.md` in the terminal. Reload. The page reverts to Setup mode: `SetupBanner` returns, analyse card has the `▶ Run` button, generate and workflow cards revert to their Setup-mode states. Start Feature is disabled again.
  - (e) Open Kickoff for any operational-mode Project. No drift hint renders above the prompt textarea, regardless of artifact age or git activity.
  - (f) Hover the Maintenance Refresh card. Description reads the new drift-management copy.

## 11. Archive this change

- [ ] 11.1 Once 10.5 manual smoke is green, run `openspec archive foundation-ops-as-one-shot` to apply this change's spec deltas to `openspec/specs/`.
- [ ] 11.2 Confirm `openspec/changes/archive/` now contains both `foundation-staleness-soft-gate` and `foundation-ops-as-one-shot` in order; `openspec list` shows neither as in-progress.
