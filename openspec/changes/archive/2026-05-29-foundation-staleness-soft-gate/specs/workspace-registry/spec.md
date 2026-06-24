## MODIFIED Requirements

### Requirement: Prereq state detection

The system SHALL detect, per Project, the presence and freshness of each claudboard prereq artifact: `analyse`, `generate`, `claudboard-workflow`, `refresh`, `techdebt`. Detection SHALL run once per Project (and therefore once per multi-repo workspace, NOT once per child repo).

For each prereq, the system SHALL produce a `state` of `done`, `stale`, or `missing`, and a `staleReason` of `aged-out`, `codebase-changed`, `upstream-changed`, or `null`. `staleReason` SHALL be `null` whenever `state !== 'stale'`.

**Foundation prereqs** (`analyse`, `generate`, `claudboard-workflow`) SHALL be evaluated in dependency order using a cascade DAG. The detector visits `analyse` first, then `generate`, then `claudboard-workflow`:

- **`analyse`:**
  - `state: 'done'` if `.claude/reports/claudboard-analysis.md` exists, was generated within the last 7 days, AND there are no git commits since the artifact's mtime.
  - `state: 'stale'` if the artifact exists but is older than 7 days OR git tracks commits since the artifact's mtime.
    - `staleReason: 'aged-out'` if the artifact's mtime is older than 7 days.
    - `staleReason: 'codebase-changed'` otherwise (git activity is the trigger).
    - When both conditions apply, `staleReason: 'codebase-changed'` takes precedence (more specific signal).
  - `state: 'missing'` if the artifact does not exist.

- **`generate`:**
  - `state: 'done'` if `CLAUDE.md` AND `.claude/rules/` exist, AND `analyse` is `done`, AND `generate`'s `CLAUDE.md` mtime is greater than or equal to `analyse`'s artifact mtime.
  - `state: 'stale'` if the `CLAUDE.md` and `.claude/rules/` artifacts exist but (a) `analyse.state === 'stale'`, OR (b) `analyse.mtime > generate.mtime`. In either case, `staleReason: 'upstream-changed'`.
  - `state: 'missing'` if either `CLAUDE.md` or `.claude/rules/` does not exist (independent of `analyse`'s state).
  - The git-activity heuristic SHALL NOT be applied independently to `generate`'s artifact.

- **`claudboard-workflow`:**
  - `state: 'done'` if `.claude/skills/feature-workflow/SKILL.md` exists, AND `generate` is `done`, AND the SKILL.md mtime is greater than or equal to `generate`'s `CLAUDE.md` mtime.
  - `state: 'stale'` if the SKILL.md artifact exists but (a) `generate.state === 'stale'`, OR (b) `generate.mtime > workflow.mtime`. In either case, `staleReason: 'upstream-changed'`.
  - `state: 'missing'` if the SKILL.md artifact does not exist (independent of `generate`'s state).
  - The git-activity heuristic SHALL NOT be applied independently to the workflow artifact.

**Maintenance prereqs** retain the existing per-op evaluation:

- **`refresh`:** always `state: 'stale'`, `staleReason: null` (it is an action prompt, not a derivation — there is no durable artifact to track).
- **`techdebt`:**
  - `state: 'done'` if `.claude/reports/tech-debt/summary.md` exists, was generated within the last 7 days, AND there are no git commits since the artifact's mtime.
  - `state: 'stale'` if the artifact exists but is older than 7 days (`staleReason: 'aged-out'`) or git tracks commits since the artifact's mtime (`staleReason: 'codebase-changed'`).
  - `state: 'missing'` if the artifact does not exist.

For a multi-repo workspace, the `.claude/` directory resolved is the workspace root's (typically a symlink into the meta-repo). Per-child-repo prereq tracking is NOT performed.

#### Scenario: All artifacts present and recent

- **WHEN** a Project has CLAUDE.md, `.claude/rules/*.md`, `.claude/skills/feature-workflow/SKILL.md`, and `.claude/reports/claudboard-analysis.md` with mtime within the last 7 days and no git commits since
- **THEN** prereq states are `analyse: done (staleReason: null)`, `generate: done (staleReason: null)`, `claudboard-workflow: done (staleReason: null)`, `refresh: stale (staleReason: null)`, `techdebt: missing (staleReason: null)`

#### Scenario: Workspace prereqs scanned once at the root

- **WHEN** the registry scans a multi-repo workspace at `~/work/meas/` with 3 child repos
- **THEN** prereq detection runs exactly once, against `~/work/meas/.claude/`, and produces exactly one set of prereq records associated with the workspace Project
- **AND** the child repos are NOT scanned for prereqs

#### Scenario: Analysis report older than 7 days marks analyse as aged-out and cascades

- **WHEN** the analysis report's mtime is 10 days ago and no git commits have landed since
- **THEN** `analyse` is `state: 'stale', staleReason: 'aged-out'`
- **AND** `generate` is `state: 'stale', staleReason: 'upstream-changed'` (because `analyse.state === 'stale'`)
- **AND** `claudboard-workflow` is `state: 'stale', staleReason: 'upstream-changed'`

#### Scenario: New commit lands after analyse run, cascades to downstream

- **GIVEN** all three foundation artifacts were freshly generated 1 hour ago, no other commits since
- **WHEN** a new git commit lands in the repo (so `git log --since=analyse.mtime` returns at least one entry)
- **THEN** `analyse` is `state: 'stale', staleReason: 'codebase-changed'`
- **AND** `generate` is `state: 'stale', staleReason: 'upstream-changed'`
- **AND** `claudboard-workflow` is `state: 'stale', staleReason: 'upstream-changed'`

#### Scenario: User re-runs /mileva-analyse, downstream cascade flips to upstream-changed

- **GIVEN** all three foundation artifacts exist, all `done`
- **WHEN** the user re-runs `/mileva-analyse` (which rewrites `.claude/reports/claudboard-analysis.md` and bumps its mtime to now)
- **AND** detection runs again
- **THEN** `analyse` is `state: 'done', staleReason: null` (a brand-new artifact with no git activity since)
- **AND** `generate` is `state: 'stale', staleReason: 'upstream-changed'` (because `analyse.mtime > generate.mtime`)
- **AND** `claudboard-workflow` is `state: 'stale', staleReason: 'upstream-changed'`
- **AND** subsequently re-running `/mileva-generate` then `/mileva-claudboard-workflow` in order returns all three to `done` on the next detection

#### Scenario: Generate artifact missing — workflow reported as missing too

- **GIVEN** `.claude/reports/claudboard-analysis.md` exists and is fresh, but `CLAUDE.md` does not exist
- **WHEN** detection runs
- **THEN** `analyse` is `state: 'done'`
- **AND** `generate` is `state: 'missing', staleReason: null`
- **AND** `claudboard-workflow` is `state: 'missing', staleReason: null` (independent of whether the SKILL.md file happens to exist on disk — when an upstream artifact is missing, downstream artifacts SHALL NOT be reported as `done` or `stale`; they SHALL be reported as `missing` to prevent the UI from claiming the foundation chain is operational)

#### Scenario: Techdebt staleness uses git-activity heuristic independently

- **GIVEN** `.claude/reports/tech-debt/summary.md` exists with mtime 3 days ago, and 1 git commit has landed since
- **WHEN** detection runs
- **THEN** `techdebt` is `state: 'stale', staleReason: 'codebase-changed'` regardless of the state of any foundation op (Maintenance ops do NOT participate in the foundation cascade)

#### Scenario: Refresh op always reports stale with null reason

- **WHEN** detection runs for any Project
- **THEN** `refresh` is `state: 'stale', staleReason: null` regardless of the state of any other op or the contents of `.claude/`

### Requirement: Registry persistence in SQLite

The system SHALL persist the workspace and repo registry in `~/.bosch-sdlc/state.db` so that re-scans are incremental and the dashboard loads without re-walking the filesystem on every request.

The `prereqs` table SHALL include a nullable `stale_reason TEXT` column to persist the per-record `staleReason` produced by `Prereq state detection`. The server bootstrap SHALL detect whether the `stale_reason` column already exists on the `prereqs` table (via `PRAGMA table_info(prereqs)`) and SHALL issue an `ALTER TABLE prereqs ADD COLUMN stale_reason TEXT` exactly when the column is absent, so upgrades from earlier installs gain the column without losing existing rows.

#### Scenario: Re-scan updates existing records without duplicating

- **WHEN** a workspace is scanned twice
- **THEN** the second scan updates the existing repo records in-place and does not create duplicates

#### Scenario: Removed repo is marked detached

- **WHEN** a repo previously in the registry no longer exists at its recorded path
- **THEN** the repo record is marked `status: "detached"` rather than deleted, so historical run links remain valid

#### Scenario: Migration adds stale_reason on first boot after upgrade

- **GIVEN** a `~/.bosch-sdlc/state.db` from an earlier release whose `prereqs` table has no `stale_reason` column
- **WHEN** the server bootstraps
- **THEN** the bootstrap detects the missing column and issues `ALTER TABLE prereqs ADD COLUMN stale_reason TEXT`
- **AND** existing prereq rows remain intact, with `stale_reason` defaulted to `NULL`
- **AND** the next detection pass populates `stale_reason` for any stale rows

#### Scenario: Legacy rows without a reason are returned with null staleReason

- **GIVEN** a prereq row persisted before the migration ran, now annotated with `state: 'stale'` and `stale_reason: NULL`
- **WHEN** the server returns the row over `GET /api/projects/:id/prereqs`
- **THEN** the JSON response includes `"staleReason": null` for that record
