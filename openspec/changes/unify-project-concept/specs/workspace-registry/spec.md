## MODIFIED Requirements

### Requirement: Repo discovery and topology classification

The system SHALL scan one or more user-supplied root directories on the local filesystem and classify each discovered repository as one of three topologies: `monolith`, `monorepo`, or `multi-repo-workspace`. Classification SHALL be silent — the user is never asked. The classified topology is persisted as internal metadata on the Project record and is NOT surfaced as a user choice.

Classification rules:

- A directory is a *repo* if it contains a `.git` directory.
- A repo is a *monorepo* if it contains a `.claude/` at its root AND it contains one or more sub-directories under `packages/*` or `services/*` that each contain a `.claude/skills/`. It is recorded as a SINGLE Project at the repo root, with one Repo record at the same path.
- A directory is a *multi-repo-workspace* if it is NOT itself a repo AND it contains two or more direct child directories that are repos. The presence of a workspace-level `.claude/` is NOT required. It is recorded as a SINGLE Project at the workspace root, with one Repo record per detected child repo.
- Otherwise a repo is a *monolith*, recorded as a single Project at the repo root with one Repo record at the same path.

Each Project record produces 1..N Repo records (1 for monolith and monorepo; N for multi-repo-workspace). Repo records are internal — they are surfaced only to the Kickoff flow for repo targeting and are not pickable from any top-level navigation.

The Project record shape includes `path`, `name`, `topology`, `mark`, `status`, `createdAt`, `lastActiveAt`. The `topology` field is INTERNAL metadata only; the UI does not branch any layout decisions on it.

#### Scenario: Single repo is classified as monolith

- **WHEN** the registry scans a directory containing one repo with `.git/` and no sub-packages
- **THEN** one Project is recorded with `topology: "monolith"`, plus one Repo at the same path

#### Scenario: Repo with packages/*/.claude is classified as monorepo

- **WHEN** the registry scans a repo containing `.git/`, `.claude/`, and `packages/billing/.claude/skills/`, `packages/auth/.claude/skills/`
- **THEN** one Project is recorded with `topology: "monorepo"` at the repo root, plus one Repo at the same path

#### Scenario: Parent directory with two or more child repos is classified as multi-repo-workspace

- **WHEN** the registry scans `~/work/meas/` which is NOT itself a git repo and contains `datahandler/`, `controller/`, `common-dto/` each with their own `.git/`
- **THEN** one Project is recorded for `~/work/meas/` with `topology: "multi-repo-workspace"`
- **AND** three Repo records are created, one per child repo
- **AND** the absence of a workspace-level `.claude/` does NOT cause the classifier to fall through to monolith or to per-child-monoliths

#### Scenario: Fresh multi-repo folder without .claude classifies correctly

- **WHEN** the registry scans a freshly-created `~/dev/meas/` containing three child git repos and no `.claude/` anywhere
- **THEN** the Project's `topology` is `"multi-repo-workspace"` — not `"monolith"`, not three separate monoliths
- **AND** three Repo records are created so Kickoff can target each one

#### Scenario: Directory without .git and with fewer than two child repos is rejected

- **WHEN** the registry scans a directory that is not a git repo and contains zero or one child git repos
- **THEN** no Project record is created
- **AND** the attach call returns a 400 with an explanatory error

### Requirement: Attach and detach projects via API

The system SHALL expose endpoints to attach a new project by absolute path or by clone URL, and to detach (soft-remove) an existing one. The attach call SHALL always auto-classify topology server-side; any client-supplied `topology` field in the request body SHALL be ignored.

The endpoint paths SHALL use `project` as the resource name (not `workspace`):

- `POST /api/projects` — body `{ root: string }` OR `{ remoteUrl: string }`. Returns a Project record (no `topology` selection accepted).
- `GET /api/projects` — returns all active Project records.
- `DELETE /api/projects/:id` — soft-detach the Project and its Repos.
- `GET /api/projects/active` — returns the active Project (singleton).
- `PUT /api/projects/active` — body `{ projectId: string }` — sets the active Project.

#### Scenario: Attach a multi-repo folder without specifying topology

- **WHEN** the client POSTs `/api/projects` with `{ root: "/Users/x/work/meas" }` where `meas/` has no `.git`, no `.claude/`, and three child repos
- **THEN** the server auto-classifies as `multi-repo-workspace` and persists that topology
- **AND** the response is a Project record at `/Users/x/work/meas`
- **AND** three Repo records exist under that Project

#### Scenario: Client-supplied topology is ignored

- **WHEN** the client POSTs `/api/projects` with `{ root: "/Users/x/work/meas", topology: "monolith" }` for a folder that scans as `multi-repo-workspace`
- **THEN** the persisted topology is `"multi-repo-workspace"` (the detected value), not `"monolith"`
- **AND** the response includes the detected topology

#### Scenario: Attach by clone URL

- **WHEN** the client POSTs `/api/projects` with `{ remoteUrl: "https://github.com/org/repo.git" }`
- **THEN** the server clones into `~/dev/<repo-name>`, scans the cloned dir, classifies, and persists
- **AND** the response is a Project record

### Requirement: Registry persistence in SQLite

The system SHALL persist the project and repo registry in `~/.bosch-sdlc/state.db` so that re-scans are incremental and the dashboard loads without re-walking the filesystem on every request. The persisted schema SHALL use table names `projects` (top-level) and `repos` (per-git-repo rows under a Project, joined by `project_id`).

The `kv_settings` singleton key for the active selection SHALL be `active_project_id` (not `active_workspace_id`).

A migration SHALL transparently rename the prior schema (`workspaces` table → `projects`; `projects` table → `repos`; `workspace_id` foreign key → `project_id`; `active_workspace_id` setting key → `active_project_id`) on first run after deployment, preserving all existing row data (IDs, timestamps, marks, statuses).

#### Scenario: Re-scan updates existing records without duplicating

- **WHEN** a project is scanned twice
- **THEN** the second scan updates the existing Project and Repo records in-place and does not create duplicates

#### Scenario: Removed repo is marked detached

- **WHEN** a Repo previously in the registry no longer exists at its recorded path
- **THEN** the Repo record is marked `status: "detached"` rather than deleted, so historical run links remain valid

#### Scenario: Migration from workspaces/projects schema preserves rows

- **GIVEN** a database created under the old schema with two `workspaces` rows and three `projects` rows
- **WHEN** the server starts and runs migrations
- **THEN** the new schema has two `projects` rows (with the same IDs and metadata as the old `workspaces` rows) and three `repos` rows (with the same IDs and metadata as the old `projects` rows, with `project_id` pointing at the renamed parent)
- **AND** the `active_project_id` singleton key holds the value previously stored under `active_workspace_id`

## ADDED Requirements

### Requirement: Per-project data endpoints SHALL be scoped by projectId

`GET /api/repos` and `GET /api/runs` SHALL accept a required `projectId` query parameter and SHALL return only records belonging to that Project. A request without `projectId` SHALL return 400 with `{ error: "projectId is required" }`. This requirement exists to eliminate cross-project data leakage on the Overview, where the previous unscoped `GET /api/projects` (renamed to `GET /api/repos`) and `GET /api/runs` returned every active row regardless of which project the user was viewing.

#### Scenario: Listing repos requires a projectId

- **WHEN** the client calls `GET /api/repos` with no query string
- **THEN** the response is 400 with body `{ "error": "projectId is required" }`

#### Scenario: Listing repos filters to the given project

- **GIVEN** two active Projects A (with two repos) and B (with one repo)
- **WHEN** the client calls `GET /api/repos?projectId=<A.id>`
- **THEN** the response contains exactly the two repos belonging to A; none of B's repos appear

#### Scenario: Listing runs requires a projectId

- **WHEN** the client calls `GET /api/runs` with no query string
- **THEN** the response is 400 with body `{ "error": "projectId is required" }`

#### Scenario: Listing runs filters to the given project

- **GIVEN** Project A has two runs and Project B has one run
- **WHEN** the client calls `GET /api/runs?projectId=<A.id>`
- **THEN** the response contains exactly A's two runs

