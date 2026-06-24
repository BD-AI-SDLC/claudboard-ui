## MODIFIED Requirements

### Requirement: Prereq state detection

The system SHALL detect, per Project, the presence and freshness of each claudboard prereq artifact: `analyse`, `generate`, `workflow`, `refresh`, `techdebt`. Detection SHALL run once per Project (and therefore once per multi-repo workspace, NOT once per child repo).

Detection SHALL be invoked live by the `GET /api/repos/:id/prereqs` handler on every read — `state`, `output`, and `staleReason` in the response are derived from the filesystem at request time, not from a persistent cache. The `prereqs` table is used only as a write target for cached run metadata (`lastRun`, `duration`, `cost`) populated by run finalizers (see `prereq-runner`).

For each prereq:

- `state: "done"` if the expected artifact exists under `Project.path/.claude/` (e.g. `.claude/reports/claudboard-analysis.md` for analyse; `CLAUDE.md` + `.claude/rules/` for generate; `.claude/skills/feature-workflow/` for workflow).
- `state: "stale"` if the artifact exists but was generated > 7 days ago OR git tracks file changes since the artifact's `generated_at` timestamp.
- `state: "missing"` if no expected artifact is present.

For a multi-repo workspace, the `.claude/` directory resolved is the workspace root's (typically a symlink into the meta-repo). Per-child-repo prereq tracking is NOT performed.

#### Scenario: All artifacts present and recent

- **WHEN** a Project has CLAUDE.md, `.claude/rules/*.md`, `.claude/skills/feature-workflow/SKILL.md`, and `.claude/reports/claudboard-analysis.md` with `generated_at` within the last 7 days under `Project.path`
- **THEN** prereq states are `analyse: done`, `generate: done`, `workflow: done`, `refresh: stale` (always stale until run), `techdebt: missing`

#### Scenario: Workspace prereqs scanned once at the root

- **WHEN** the registry scans a multi-repo workspace at `~/work/meas/` with 3 child repos
- **THEN** prereq detection runs exactly once, against `~/work/meas/.claude/`, and produces exactly one set of prereq records associated with the workspace Project
- **AND** the child repos are NOT scanned for prereqs

#### Scenario: Analysis report older than 7 days marks analyse as stale

- **WHEN** the analysis report's `generated_at` is 10 days ago
- **THEN** prereq state for `analyse` is `stale`

#### Scenario: Detection reflects out-of-band artifact writes immediately

- **WHEN** the `.claude/reports/claudboard-analysis.md` artifact is created out-of-band (e.g. by a freshly-completed `POST /api/claudboard/run` whose finalizer did NOT invoke `detectPrereqs`)
- **THEN** the next `GET /api/repos/:id/prereqs` response reports `analyse: 'done'` without any explicit cache invalidation — the freshness is derived from the file's current mtime and current git activity
