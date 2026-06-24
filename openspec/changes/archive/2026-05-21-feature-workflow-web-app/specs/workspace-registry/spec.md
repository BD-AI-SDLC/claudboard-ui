## ADDED Requirements

### Requirement: Repo discovery and topology classification

The system SHALL scan one or more user-supplied root directories on the local filesystem and classify each discovered repository as one of three topologies: `monolith`, `monorepo`, or `multi-repo-workspace`.

Classification rules:
- A directory is a *repo* if it contains a `.git` directory.
- A repo is a *monorepo* if it contains a `.claude/` at its root AND it contains one or more sub-directories (e.g. `packages/*`, `services/*`, `apps/*`) that each contain a `.claude/skills/` or a clear per-service boundary marker (presence configurable later; default heuristic for v1 is `packages/*/.claude` OR `services/*/.claude`).
- A directory is a *multi-repo-workspace* if it is NOT itself a repo, contains its own `.claude/` (the meta-repo pattern from claudboard-workspace-init), AND contains two or more child directories that are repos.
- Otherwise a repo is a *monolith*.

#### Scenario: Single repo with .claude is classified as monolith

- **WHEN** the registry scans a directory containing one repo with `.git/` and `.claude/` and no sub-packages
- **THEN** the repo is recorded with `topology: "monolith"`, `target = <repo>`, `scope = null`, `workspaceRoot = null`

#### Scenario: Repo with packages/*/.claude is classified as monorepo

- **WHEN** the registry scans a repo containing `.git/`, `.claude/`, and `packages/billing/.claude/`, `packages/auth/.claude/`
- **THEN** the repo is recorded once with `topology: "monorepo"`, and two scopes are surfaced (`packages/billing`, `packages/auth`) that the kickoff UI can pick from

#### Scenario: Parent directory with meta-repo .claude is classified as multi-repo-workspace

- **WHEN** the registry scans `~/work/meas/` which has its own `.claude/` (not a git repo itself) and contains `datahandler/`, `controller/`, `common-dto/` each with their own `.git/` and `.claude/`
- **THEN** the parent is recorded as `kind: "workspace"` with `workspaceRoot = ~/work/meas/`, and each child repo is recorded with `topology: "multi-repo-workspace"`, `target = <child>`, `workspaceRoot = ~/work/meas/`

#### Scenario: Directory without .git is ignored

- **WHEN** the registry scans a directory tree containing folders with no `.git/`
- **THEN** no repo entry is created for those folders

### Requirement: Prereq state detection

The system SHALL detect, per repo, the presence and freshness of each claudboard prereq artifact: `analyse`, `generate`, `workflow`, `refresh`, `techdebt`.

For each prereq:
- `state: "done"` if the expected artifact exists (e.g. `.claude/reports/claudboard-analysis.md` for analyse; `CLAUDE.md` + `.claude/rules/` for generate; `.claude/skills/feature-workflow/` for workflow).
- `state: "stale"` if the artifact exists but was generated > 7 days ago OR git tracks file changes since the artifact's `generated_at` timestamp.
- `state: "missing"` if no expected artifact is present.

#### Scenario: All artifacts present and recent

- **WHEN** a repo has CLAUDE.md, `.claude/rules/*.md`, `.claude/skills/feature-workflow/SKILL.md`, and `.claude/reports/claudboard-analysis.md` with `generated_at` within the last 7 days
- **THEN** prereq states are `analyse: done`, `generate: done`, `workflow: done`, `refresh: stale` (always stale until run), `techdebt: missing`

#### Scenario: Analysis report older than 7 days marks analyse as stale

- **WHEN** the analysis report's `generated_at` is 10 days ago
- **THEN** prereq state for `analyse` is `stale`

### Requirement: Registry persistence in SQLite

The system SHALL persist the workspace and repo registry in `~/.bosch-sdlc/state.db` so that re-scans are incremental and the dashboard loads without re-walking the filesystem on every request.

#### Scenario: Re-scan updates existing records without duplicating

- **WHEN** a workspace is scanned twice
- **THEN** the second scan updates the existing repo records in-place and does not create duplicates

#### Scenario: Removed repo is marked detached

- **WHEN** a repo previously in the registry no longer exists at its recorded path
- **THEN** the repo record is marked `status: "detached"` rather than deleted, so historical run links remain valid

### Requirement: Attach and detach repos via API

The system SHALL expose endpoints to attach a new repo or workspace root by absolute path, and to detach (soft-remove) an existing one.

#### Scenario: Attach a new workspace root

- **WHEN** the user POSTs `/api/workspaces` with `{ root: "/Users/x/work/meas" }`
- **THEN** the registry scans that root, classifies and persists the discovered repos, and returns the resulting workspace record

#### Scenario: Detach a workspace

- **WHEN** the user DELETEs `/api/workspaces/:id`
- **THEN** the workspace and its repos are marked `status: "detached"`; transcripts and run history for those repos remain queryable
