## MODIFIED Requirements

### Requirement: Prereq state detection

The system SHALL detect, per Project, the presence and freshness of each claudboard prereq artifact: `analyse`, `generate`, `claudboard-workflow`, `refresh`, `techdebt`. Detection SHALL run once per Project (and therefore once per multi-repo workspace, NOT once per child repo).

For each prereq, the system SHALL produce a `state` of `done`, `stale`, or `missing`, and a `staleReason` of `aged-out`, `codebase-changed`, or `null`. `staleReason` SHALL be `null` whenever `state !== 'stale'`. The value `'upstream-changed'` SHALL NOT be produced by any op.

**Foundation prereqs** (`analyse`, `generate`, `claudboard-workflow`) SHALL be evaluated as one-time setup artifacts using a binary missing/done rule. No staleness signal SHALL be produced for any foundation op under any condition:

- **`analyse`:**
  - `state: 'done'` if `.claude/reports/claudboard-analysis.md` exists.
  - `state: 'missing'` otherwise.
  - `staleReason: null` always.
  - Neither the git-activity heuristic nor the aged-out heuristic SHALL be applied.

- **`generate`:**
  - `state: 'done'` if `CLAUDE.md` AND `.claude/rules/` both exist.
  - `state: 'missing'` otherwise.
  - `staleReason: null` always.
  - The detector SHALL NOT consider `analyse`'s state or mtime.

- **`claudboard-workflow`:**
  - `state: 'done'` if `.claude/skills/feature-workflow/SKILL.md` exists.
  - `state: 'missing'` otherwise.
  - `staleReason: null` always.
  - The detector SHALL NOT consider `generate`'s state or mtime.

**Maintenance prereqs** retain the existing per-op evaluation:

- **`refresh`:** always `state: 'stale'`, `staleReason: null` (it is an action prompt, not a derivation — there is no durable artifact to track).
- **`techdebt`:**
  - `state: 'done'` if `.claude/reports/tech-debt/summary.md` exists, was generated within the last 7 days, AND there are no git commits since the artifact's mtime.
  - `state: 'stale'` if the artifact exists but is older than 7 days (`staleReason: 'aged-out'`) or git tracks commits since the artifact's mtime (`staleReason: 'codebase-changed'`).
  - `state: 'missing'` if the artifact does not exist.

For a multi-repo workspace, the `.claude/` directory resolved is the workspace root's (typically a symlink into the meta-repo). Per-child-repo prereq tracking is NOT performed.

#### Scenario: All artifacts present

- **WHEN** a Project has CLAUDE.md, `.claude/rules/*.md`, `.claude/skills/feature-workflow/SKILL.md`, and `.claude/reports/claudboard-analysis.md` all on disk
- **THEN** prereq states are `analyse: done (staleReason: null)`, `generate: done (staleReason: null)`, `claudboard-workflow: done (staleReason: null)`, `refresh: stale (staleReason: null)`, `techdebt: missing (staleReason: null)`

#### Scenario: Workspace prereqs scanned once at the root

- **WHEN** the registry scans a multi-repo workspace at `~/work/meas/` with 3 child repos
- **THEN** prereq detection runs exactly once, against `~/work/meas/.claude/`, and produces exactly one set of prereq records associated with the workspace Project
- **AND** the child repos are NOT scanned for prereqs

#### Scenario: Foundation never reports stale on aged artifacts

- **GIVEN** all three foundation artifacts exist with mtime 30 days ago and 50 git commits have landed since
- **WHEN** detection runs
- **THEN** `analyse` is `state: 'done', staleReason: null`
- **AND** `generate` is `state: 'done', staleReason: null`
- **AND** `claudboard-workflow` is `state: 'done', staleReason: null`

#### Scenario: Foundation never cascades on upstream re-run

- **GIVEN** all three foundation artifacts exist, all `done`
- **WHEN** the user re-runs `/mileva-analyse` (which rewrites `.claude/reports/claudboard-analysis.md` and bumps its mtime to now)
- **AND** detection runs again
- **THEN** `analyse` remains `state: 'done', staleReason: null`
- **AND** `generate` remains `state: 'done', staleReason: null` (no upstream-changed cascade)
- **AND** `claudboard-workflow` remains `state: 'done', staleReason: null`

#### Scenario: Missing foundation artifact reports as missing without cascade

- **GIVEN** `.claude/reports/claudboard-analysis.md` exists and `.claude/skills/feature-workflow/SKILL.md` exists, but `CLAUDE.md` does not exist
- **WHEN** detection runs
- **THEN** `analyse` is `state: 'done'`
- **AND** `generate` is `state: 'missing', staleReason: null`
- **AND** `claudboard-workflow` is `state: 'done', staleReason: null` (each foundation op is evaluated independently against its own artifact; downstream artifacts SHALL NOT be downgraded to `missing` solely because an upstream is `missing`)

#### Scenario: Foundation reverts to missing after manual artifact deletion

- **GIVEN** `analyse` is `state: 'done'` because `.claude/reports/claudboard-analysis.md` exists on disk
- **WHEN** the user manually runs `rm .claude/reports/claudboard-analysis.md`
- **AND** detection runs
- **THEN** `analyse` flips to `state: 'missing', staleReason: null`
- **AND** `generate` and `claudboard-workflow` are evaluated independently against their own artifacts and are unaffected by `analyse`'s state

#### Scenario: Techdebt staleness uses git-activity heuristic independently

- **GIVEN** `.claude/reports/tech-debt/summary.md` exists with mtime 3 days ago, and 1 git commit has landed since
- **WHEN** detection runs
- **THEN** `techdebt` is `state: 'stale', staleReason: 'codebase-changed'` regardless of the state of any foundation op

#### Scenario: Refresh op always reports stale with null reason

- **WHEN** detection runs for any Project
- **THEN** `refresh` is `state: 'stale', staleReason: null` regardless of the state of any other op or the contents of `.claude/`
