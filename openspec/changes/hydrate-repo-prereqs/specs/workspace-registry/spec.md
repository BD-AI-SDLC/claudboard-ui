## ADDED Requirements

### Requirement: Repo response endpoints carry hydrated prereq state

The repo response endpoints (`GET /api/repos`, `GET /api/repos/:id`) SHALL return `Repo` records whose `prereqs` field is a populated `Record<string, PrereqRecord>`. The populated content SHALL equal the content returned by `GET /api/repos/:id/prereqs` for the same repo, computed by the same code path (a shared helper invoked from all three endpoints).

This requirement closes a contract gap: the protocol type (`Repo.prereqs: Record<string, PrereqRecord>`) declares the field as non-optional, but the historical implementation hard-coded `prereqs: {}` for every repo in the list/single endpoints. UI consumers that gate features on `repo.prereqs` directly (without an out-of-band fetch to the dedicated endpoint) SHALL receive truth from the list endpoint.

The helper SHALL accept the database handle as an explicit argument so its callers control transaction context. The helper SHALL NOT perform additional I/O beyond `detectPrereqs(repo.path)` and a single `SELECT` against the `prereqs` table.

#### Scenario: List endpoint returns hydrated prereqs

- **GIVEN** a project with one active repo whose foundation artifacts (`CLAUDE.md`, `.claude/rules/`, `.claude/skills/feature-workflow/SKILL.md`, `.claude/reports/claudboard-analysis.md`) exist on disk and are recent
- **WHEN** the client requests `GET /api/repos?projectId=<id>`
- **THEN** the response body is `[Repo]` where `Repo[0].prereqs` contains entries for `analyse`, `generate`, `claudboard-workflow` with `state: "done"` (and the maintenance ops per `prereq-runner` detection rules)
- **AND** the `prereqs` field is NOT `{}`

#### Scenario: Single-repo endpoint returns hydrated prereqs

- **GIVEN** the same seeded state as above
- **WHEN** the client requests `GET /api/repos/:id`
- **THEN** the response body is a single `Repo` whose `prereqs` field matches the result of a parallel call to `GET /api/repos/:id/prereqs` for the same id, key for key

#### Scenario: List and dedicated endpoints agree on a repo with no foundation

- **GIVEN** a project with one active repo whose `.claude/` directory does NOT contain any foundation artifacts
- **WHEN** the client requests `GET /api/repos?projectId=<id>`
- **THEN** the response's `Repo[0].prereqs` contains entries for the foundation op ids with `state: "missing"`
- **AND** `GET /api/repos/:id/prereqs` for the same id returns an equal map

#### Scenario: Empty workspace returns an empty list

- **GIVEN** a project with zero active repos
- **WHEN** the client requests `GET /api/repos?projectId=<id>`
- **THEN** the response body is `[]` (the hydration is per-row; no rows means no hydration runs)
