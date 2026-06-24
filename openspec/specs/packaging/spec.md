## ADDED Requirements

### Requirement: `npx bosch-sdlc` boot sequence

The package SHALL expose a `bosch-sdlc` bin that, when run via `npx bosch-sdlc`, performs in order: (1) precondition checks, (2) pick a free port, (3) start the HTTP + WS server, (4) open the user's default browser to the served URL.

#### Scenario: Clean boot

- **WHEN** the user runs `npx bosch-sdlc` with Claude Code installed and at least one MCP server configured in `~/.claude/`
- **THEN** the process logs "Listening on http://localhost:<port>" and opens the browser to that URL within 3 seconds

#### Scenario: Custom port via env

- **WHEN** the user runs `BOSCH_SDLC_PORT=4173 npx bosch-sdlc`
- **THEN** the server attempts to bind 4173; if free it uses it; if busy it fails fast with a clear error rather than silently picking another port

### Requirement: Claude Code precondition check

On boot, the system SHALL verify that Claude Code is installed and that `~/.claude/` exists with at least one MCP server configured. If either check fails, the process SHALL exit with a non-zero code and a clear message naming the missing prerequisite and how to fix it.

#### Scenario: Claude Code not installed

- **WHEN** the `claude` binary is not on PATH and `~/.claude/` does not exist
- **THEN** the process exits 1 with: "bosch-sdlc requires Claude Code. Install from https://claude.com/claude-code, then run bosch-sdlc again."

#### Scenario: No MCP servers configured

- **WHEN** `~/.claude/` exists but contains no MCP server configuration
- **THEN** the process exits 1 with a message naming common ones to add (Atlassian for JIRA, ADO for Azure DevOps) and a pointer to the Claude Code docs

### Requirement: Prebuilt UI shipped in the package

The published npm package SHALL include a prebuilt `dist/` directory produced by `vite build` at publish time. The server SHALL serve this directory statically. `npx bosch-sdlc` SHALL NOT run `vite build` at the user's machine.

#### Scenario: Package contents include built UI

- **WHEN** the package tarball is inspected via `npm pack --dry-run`
- **THEN** it includes `dist/index.html`, `dist/assets/*.js`, `dist/assets/*.css`; it does NOT include source `.tsx` files or `node_modules/vite`

### Requirement: Config directory at `~/.bosch-sdlc/`

On first boot the system SHALL create `~/.bosch-sdlc/` containing `state.db` (SQLite) and `transcripts/`. The directory SHALL be created with user-only permissions (0700).

#### Scenario: First boot creates config dir

- **WHEN** `~/.bosch-sdlc/` does not exist and `npx bosch-sdlc` runs
- **THEN** the directory is created, `state.db` is initialized with the schema, and `transcripts/` is an empty directory
