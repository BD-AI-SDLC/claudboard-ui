## MODIFIED Requirements

### Requirement: Repo discovery and topology classification

The system SHALL scan one or more user-supplied root directories on the local filesystem and classify each discovered repository as one of three topologies: `monolith`, `monorepo`, or `multi-repo-workspace`. Every classified entry SHALL produce exactly one `Project` record whose `path` equals the directory used as `cwd` at run time.

The `topology` value SHALL drive exactly one runtime behaviour: the shape of the UI Overview body for the workspace (see `web-ui` for the three shapes). No other runtime behaviour SHALL branch on `topology` — Kickoff, Active Run, Review Gate, and server-side run orchestration remain topology-agnostic.

Classification rules:

- A directory is a *repo* if it contains a `.git` directory.
- A repo is a *monorepo* if it contains a `.claude/` at its root AND it contains one or more sub-directories (e.g. `packages/*`, `services/*`, `apps/*`) that each contain a `.claude/skills/` or a clear per-service boundary marker (presence configurable later; default heuristic for v1 is `packages/*/.claude` OR `services/*/.claude`). It is recorded as a SINGLE Project at the repo root.
- A directory is a *multi-repo-workspace* if it is NOT itself a repo, contains its own `.claude/` (the meta-repo pattern from `claudboard-workspace-init` / `claudboard-workspace-link`), AND contains two or more child directories that are repos. It is recorded as a SINGLE Project at the workspace root; the child repos are NOT recorded as separate Projects.
- Otherwise a repo is a *monolith*, recorded as a single Project at the repo root.

When the user supplies an explicit `topology` value at attach time (see "Attach and detach repos via API"), the user's value SHALL be persisted as the record's `topology` regardless of the classifier's verdict. The classifier still runs and its verdict is returned alongside the persisted record so the UI may surface a "we detected X but you picked Y" warning.

Project record shape:

- `path`: absolute path to the directory used as `cwd` at run time
- `name`: basename of `path`
- `topology`: `"monolith" | "monorepo" | "multi-repo-workspace"` (display label AND Overview-shape key)
- `status`: `"active" | "detached"`
- `mark`: 1–2 character display glyph (see `workspace-switcher`)
- `createdAt`, `lastActiveAt`: ISO timestamps

The Project record SHALL NOT include `scopes` or `workspaceRoot` fields.

#### Scenario: Single repo with .claude is classified as monolith

- **WHEN** the registry scans a directory containing one repo with `.git/` and `.claude/` and no sub-packages, AND the user did not supply an explicit `topology`
- **THEN** the repo is recorded with `topology: "monolith"`, `path = <repo>`

#### Scenario: Repo with packages/*/.claude is classified as monorepo

- **WHEN** the registry scans a repo containing `.git/`, `.claude/`, and `packages/billing/.claude/`, `packages/auth/.claude/`, AND the user did not supply an explicit `topology`
- **THEN** the repo is recorded as a single Project with `topology: "monorepo"` and `path = <repo>`
- **AND** the response SHALL NOT include any enumeration of sub-package paths

#### Scenario: Parent directory with meta-repo .claude is classified as multi-repo-workspace

- **WHEN** the registry scans `~/work/meas/` which has its own `.claude/` (not a git repo itself) and contains `datahandler/`, `controller/`, `common-dto/` each with their own `.git/`, AND the user did not supply an explicit `topology`
- **THEN** exactly ONE Project is recorded for `~/work/meas/` with `topology: "multi-repo-workspace"` and `path = ~/work/meas/`
- **AND** no Project is recorded for any of the child repos

#### Scenario: User-supplied topology overrides the classifier

- **WHEN** the registry scans a repo whose classifier verdict would be `monorepo`, AND the user supplied `{ topology: "monolith" }` in the attach request
- **THEN** the persisted record's `topology` is `"monolith"`
- **AND** the attach response includes `{ persistedTopology: "monolith", detectedTopology: "monorepo" }` so the UI may surface a warning

#### Scenario: Topology drives Overview shape and nothing else

- **WHEN** the user opens any non-Overview screen (Kickoff, Active Run, Review Gate, Analytics) for a workspace
- **THEN** the screen's behaviour and request shapes are identical across all three topology values
- **AND** no request body or response contains a topology-conditional field beyond the workspace record itself

### Requirement: Attach and detach repos via API

The system SHALL expose endpoints to attach a new repo or workspace root by absolute path OR by remote git URL, and to detach (soft-remove) an existing one. Attaching SHALL always produce at most one Project per attached path.

The `POST /api/workspaces` endpoint SHALL accept two mutually-exclusive body shapes:

- `{ root: string, topology?: "monolith" | "monorepo" | "multi-repo-workspace", mark?: string }` — attach an existing local folder.
- `{ remoteUrl: string, topology?: ..., mark?: string }` — clone the remote into `~/dev/<basename>` (basename derived from the URL, stripping `.git`) and attach the resulting directory.

When `topology` is omitted, the classifier's verdict is persisted. When `topology` is provided, see "Repo discovery and topology classification" — the user's value wins for persistence but the classifier's verdict is returned alongside.

When `mark` is omitted, the system derives it from the workspace name (see `workspace-switcher` — "Workspace records include a display mark").

The clone path SHALL have a 60-second timeout. On clone failure the endpoint SHALL return `400 { error: "clone failed", detail: <git stderr last line> }`. If the target directory already exists the endpoint SHALL return `409 { error: "destination exists", path }` — the endpoint SHALL NOT overwrite an existing directory.

#### Scenario: Attach a new multi-repo workspace root

- **WHEN** the user POSTs `/api/workspaces` with `{ root: "/Users/x/work/meas" }` where `meas/` has a `.claude/` and three child repos
- **THEN** the registry returns a workspace record and exactly one Project record for `/Users/x/work/meas` with `topology: "multi-repo-workspace"`

#### Scenario: Attach a monolith

- **WHEN** the user POSTs `/api/workspaces` with `{ root: "/Users/x/proj/foo" }` where `foo/` is a single git repo with `.claude/`
- **THEN** the registry returns a workspace record and exactly one Project record for `/Users/x/proj/foo` with `topology: "monolith"`

#### Scenario: Attach with explicit topology overrides classifier

- **WHEN** the user POSTs `/api/workspaces` with `{ root: "/Users/x/proj/foo", topology: "monorepo" }` where `foo/` would classify as monolith
- **THEN** the persisted record's `topology` is `"monorepo"`
- **AND** the response body includes `{ persistedTopology: "monorepo", detectedTopology: "monolith" }`

#### Scenario: Attach via remote URL clones and attaches

- **WHEN** the user POSTs `/api/workspaces` with `{ remoteUrl: "https://github.com/acme/web.git", topology: "monolith" }`
- **AND** the clone succeeds
- **THEN** the directory `~/dev/web` exists on disk
- **AND** the registry returns a Project record with `path: "~/dev/web"` and `topology: "monolith"`

#### Scenario: Clone failure surfaces as 400

- **WHEN** the user POSTs `/api/workspaces` with `{ remoteUrl: "https://invalid.example/repo.git" }`
- **AND** git clone exits non-zero
- **THEN** the response status is 400
- **AND** the body is `{ error: "clone failed", detail: <last line of git stderr> }`
- **AND** no record is created in the database

#### Scenario: Clone refuses to overwrite existing destination

- **WHEN** the user POSTs `/api/workspaces` with `{ remoteUrl: "https://github.com/acme/web.git" }` and `~/dev/web` already exists
- **THEN** the response status is 409
- **AND** the body is `{ error: "destination exists", path: "/Users/x/dev/web" }` (with absolute path)
- **AND** the existing directory is not modified

#### Scenario: Detach a workspace

- **WHEN** the user DELETEs `/api/workspaces/:id`
- **THEN** the workspace and its Project are marked `status: "detached"`; transcripts and run history for that Project remain queryable
- **AND** if the detached workspace was the active workspace, `active_workspace_id` is set to null in the singleton settings

### Requirement: Registry persistence in SQLite

The system SHALL persist the workspace and repo registry in `~/.bosch-sdlc/state.db` so that re-scans are incremental and the dashboard loads without re-walking the filesystem on every request.

The `workspaces` table SHALL include the columns `id`, `name`, `path`, `topology`, `status`, `createdAt`, `lastActiveAt`, and `mark`.

A `kv_settings` singleton table SHALL exist with shape `(key TEXT PRIMARY KEY, value TEXT)` and SHALL include the row `('active_workspace_id', <uuid> | NULL)`.

#### Scenario: Re-scan updates existing records without duplicating

- **WHEN** a workspace is scanned twice
- **THEN** the second scan updates the existing repo records in-place and does not create duplicates
- **AND** `lastActiveAt` is preserved across the re-scan (re-scan is not equivalent to activation)

#### Scenario: Removed repo is marked detached

- **WHEN** a repo previously in the registry no longer exists at its recorded path
- **THEN** the repo record is marked `status: "detached"` rather than deleted, so historical run links remain valid
- **AND** if that repo's id equals the singleton `active_workspace_id`, the singleton is cleared to NULL

#### Scenario: lastActiveAt updates only when the workspace is activated

- **WHEN** the user issues `PUT /api/workspaces/active` for workspace `W1`
- **THEN** `W1.lastActiveAt` is set to the server's current time
- **AND** no other workspace's `lastActiveAt` is modified
