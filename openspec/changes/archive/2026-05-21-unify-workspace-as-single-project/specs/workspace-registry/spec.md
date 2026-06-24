## MODIFIED Requirements

### Requirement: Repo discovery and topology classification

The system SHALL scan one or more user-supplied root directories on the local filesystem and classify each discovered repository as one of three topologies: `monolith`, `monorepo`, or `multi-repo-workspace`. Every classified entry SHALL produce exactly one `Project` record whose `path` equals the directory used as `cwd` at run time. The `topology` value SHALL be informational only — no runtime behavior branches on it.

Classification rules:

- A directory is a *repo* if it contains a `.git` directory.
- A repo is a *monorepo* if it contains a `.claude/` at its root AND it contains one or more sub-directories (e.g. `packages/*`, `services/*`, `apps/*`) that each contain a `.claude/skills/` or a clear per-service boundary marker (presence configurable later; default heuristic for v1 is `packages/*/.claude` OR `services/*/.claude`). It is recorded as a SINGLE Project at the repo root.
- A directory is a *multi-repo-workspace* if it is NOT itself a repo, contains its own `.claude/` (the meta-repo pattern from `claudboard-workspace-init` / `claudboard-workspace-link`), AND contains two or more child directories that are repos. It is recorded as a SINGLE Project at the workspace root; the child repos are NOT recorded as separate Projects.
- Otherwise a repo is a *monolith*, recorded as a single Project at the repo root.

Project record shape:

- `path`: absolute path to the directory used as `cwd` at run time
- `name`: basename of `path`
- `topology`: `"monolith" | "monorepo" | "multi-repo-workspace"` (display label)
- `status`: `"active" | "detached"`

The Project record SHALL NOT include `scopes` or `workspaceRoot` fields.

#### Scenario: Single repo with .claude is classified as monolith

- **WHEN** the registry scans a directory containing one repo with `.git/` and `.claude/` and no sub-packages
- **THEN** the repo is recorded with `topology: "monolith"`, `path = <repo>`

#### Scenario: Repo with packages/*/.claude is classified as monorepo

- **WHEN** the registry scans a repo containing `.git/`, `.claude/`, and `packages/billing/.claude/`, `packages/auth/.claude/`
- **THEN** the repo is recorded as a single Project with `topology: "monorepo"` and `path = <repo>`
- **AND** the response SHALL NOT include any enumeration of sub-package paths

#### Scenario: Parent directory with meta-repo .claude is classified as multi-repo-workspace

- **WHEN** the registry scans `~/work/meas/` which has its own `.claude/` (not a git repo itself) and contains `datahandler/`, `controller/`, `common-dto/` each with their own `.git/`
- **THEN** exactly ONE Project is recorded for `~/work/meas/` with `topology: "multi-repo-workspace"` and `path = ~/work/meas/`
- **AND** no Project is recorded for any of the child repos

#### Scenario: Multi-repo workspace with cloned meta-repo child is not specially filtered

- **WHEN** the registry scans `~/work/meas/` which contains `datahandler/`, `controller/`, `common-dto/`, AND a `workspace-meta/` directory (the meta-repo cloned by `/claudboard-workspace-link`)
- **THEN** exactly ONE Project is still recorded for `~/work/meas/` with `topology: "multi-repo-workspace"`
- **AND** the `workspace-meta/` directory is counted as one of the child repos for detection purposes (the threshold of ≥2 children is met)
- **AND** the agent harness performs no special exclusion of `workspace-meta/` — the skill is trusted to skip it during execution

#### Scenario: Directory without .git is ignored

- **WHEN** the registry scans a directory tree containing folders with no `.git/` and no meta-repo `.claude/`
- **THEN** no Project entry is created for those folders

### Requirement: Prereq state detection

The system SHALL detect, per Project, the presence and freshness of each claudboard prereq artifact: `analyse`, `generate`, `workflow`, `refresh`, `techdebt`. Detection SHALL run once per Project (and therefore once per multi-repo workspace, NOT once per child repo).

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

### Requirement: Attach and detach repos via API

The system SHALL expose endpoints to attach a new repo or workspace root by absolute path, and to detach (soft-remove) an existing one. Attaching SHALL always produce at most one Project per attached path.

#### Scenario: Attach a new multi-repo workspace root

- **WHEN** the user POSTs `/api/workspaces` with `{ root: "/Users/x/work/meas" }` where `meas/` has a `.claude/` and three child repos
- **THEN** the registry returns a workspace record and exactly one Project record for `/Users/x/work/meas` with `topology: "multi-repo-workspace"`

#### Scenario: Attach a monolith

- **WHEN** the user POSTs `/api/workspaces` with `{ root: "/Users/x/proj/foo" }` where `foo/` is a single git repo with `.claude/`
- **THEN** the registry returns a workspace record and exactly one Project record for `/Users/x/proj/foo` with `topology: "monolith"`

#### Scenario: Detach a workspace

- **WHEN** the user DELETEs `/api/workspaces/:id`
- **THEN** the workspace and its Project are marked `status: "detached"`; transcripts and run history for that Project remain queryable

## REMOVED Requirements

### Requirement: Multi-repo workspace records one Project per child repo

**Reason**: Replaced by the unified "one attached path = one Project = one runnable unit" model. The previous behavior emitted N Projects (one per child `.git`) carrying `workspaceRoot = <parent>`, which created N runnable surfaces for what is conceptually a single project, and left the `workspaceRoot` field unread by the run driver.

**Migration**: Existing rows in `~/.bosch-sdlc/state.db` from the old per-child model are not migrated. Operators delete `~/.bosch-sdlc/state.db` before upgrading and re-attach their workspaces via the Dashboard, which then produces one Project per workspace root under the new rules.

### Requirement: Monorepo scope enumeration in registry

**Reason**: The `scopes` field on `Project` (list of `packages/*` or `services/*` sub-paths bearing a `.claude/`) existed solely to populate the Kickoff scope picker. The scope picker is being removed (see `run-driver` spec delta and `web-ui` spec delta); with no consumer, the field becomes dead weight.

**Migration**: `Project.scopes` is removed from the protocol and DB. UI code that read `project.scopes` is removed in lockstep. `getMonorepoScopes()` is deleted.
