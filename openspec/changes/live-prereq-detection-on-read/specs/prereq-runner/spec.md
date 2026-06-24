## MODIFIED Requirements

### Requirement: Prereq state refresh on completion

After each prereq run completes successfully, the system SHALL persist the run's completion metadata (`lastRun` timestamp and `duration`) into the `prereqs` table via `markPrereqRan`. The system SHALL NOT cache the prereq's `state`, `output`, or `staleReason` after a run; those fields are derived live on read from the filesystem by the GET handler (see `workspace-registry`).

Both prereq run entry points — `POST /api/prereqs/:cmd` and `POST /api/claudboard/run` — SHALL call `markPrereqRan` on successful completion. For the claudboard entry point, the skill name SHALL be mapped to the corresponding `prereqs.cmd` value (`analyse → analyse`, `generate → generate`, `workflow → claudboard-workflow`) before the call.

#### Scenario: Successful prereq-runner CLI run records run metadata

- **WHEN** a `/analyse` run started via `POST /api/prereqs/analyse` completes with `status: 'done'` and a recorded `completed_at`
- **THEN** the corresponding `prereqs` row's `last_run` is set to the completion timestamp and `duration_ms` is set to `completed_at - created_at` in milliseconds
- **AND** the row's `state`, `output`, and `stale_reason` columns are NOT updated by the run finalizer

#### Scenario: Successful claudboard-run records run metadata

- **WHEN** an `analyse` skill run started via `POST /api/claudboard/run` (`{ repoId, skill: 'analyse', ... }`) completes with `status: 'done'` and a recorded `completed_at`
- **THEN** the finalizer maps skill `analyse` → cmd `analyse`, fetches the run row, computes `durationMs = completed_at − created_at`, and calls `markPrereqRan(repoId, 'analyse', completedAtIso, durationMs)`
- **AND** the subsequent `GET /api/repos/:id/prereqs` response includes the new `lastRun` and `duration` for the `analyse` prereq

#### Scenario: Workflow skill maps to claudboard-workflow cmd

- **WHEN** a `workflow` skill run completes via `POST /api/claudboard/run` (`{ repoId, skill: 'workflow', ... }`)
- **THEN** the finalizer calls `markPrereqRan(repoId, 'claudboard-workflow', ...)` (NOT `'workflow'`), so the metadata lands on the row keyed by the canonical cmd

#### Scenario: Failed run does not stamp lastRun

- **WHEN** an `/analyse` run completes with `status: 'failed'`
- **THEN** the run finalizer does NOT call `markPrereqRan` and the prereq row's `last_run` and `duration_ms` retain their previous values

### Requirement: Prereq output surfacing

The system SHALL expose each prereq's primary artifact path (e.g. `.claude/reports/claudboard-analysis.md` for analyse, `CLAUDE.md` for generate) via `GET /api/repos/:id/prereqs`. The artifact path SHALL be derived live by `detectPrereqs(repo.path)` on every read — it is `null` when the artifact is missing on disk, regardless of any previously cached value in the `prereqs` table.

#### Scenario: View analysis report path

- **WHEN** the user fetches `GET /api/repos/:id/prereqs` for a repo with a present `.claude/reports/claudboard-analysis.md` file
- **THEN** the response's `analyse` entry has `output: '.claude/reports/claudboard-analysis.md'` and the shape `{ id, repoId, cmd, state, lastRun, duration, cost, output, staleReason }`

#### Scenario: Missing artifact yields null output regardless of cached value

- **WHEN** the user fetches `GET /api/repos/:id/prereqs` for a repo where the `analyse` artifact has been deleted out-of-band, but the `prereqs` row still has a non-null cached `output` from a prior run
- **THEN** the response's `analyse` entry has `output: null` and `state: 'missing'`
