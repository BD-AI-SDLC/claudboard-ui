## ADDED Requirements

### Requirement: Silent claudboard plugin install on first boot

After the existing Claude Code precondition check passes, the system SHALL check for the presence of the claudboard plugin at `~/.claude/plugins/marketplaces/claudboard/skills/claudboard-analyse/SKILL.md`. If present, the bootstrap state SHALL be set to `ready` immediately. If absent, the system SHALL spawn `claude plugin install claudboard@claudboard` as a background child process, transition the bootstrap state to `installing`, and transition to `ready` on successful child exit (code 0) or to `install-failed` on non-zero exit or timeout.

The install subprocess SHALL be subject to a 5-minute hard timeout; on timeout the state SHALL transition to `install-failed` with message `"Plugin install timed out after 5 minutes"`. The install SHALL NOT block the HTTP server from accepting connections — the server starts listening immediately and serves the bootstrap status endpoint and all GET endpoints while the install proceeds in the background.

The system SHALL NOT prompt the user before installing. The act of running `npx bosch-sdlc` is treated as implicit consent to set up the runtime dependencies the dashboard requires. The install is idempotent (re-runs are skipped when the plugin is already present), so a single `npx bosch-sdlc` invocation does not cause cumulative plugin installs across restarts.

The system SHALL NOT auto-update the plugin to a newer version. The check is presence-only. Version pinning, drift detection, and update flows are out of scope.

#### Scenario: Plugin already installed → ready immediately

- **GIVEN** `~/.claude/plugins/marketplaces/claudboard/skills/claudboard-analyse/SKILL.md` exists
- **WHEN** the server boots after the Claude Code precondition check passes
- **THEN** bootstrap state is `ready` before the HTTP server accepts its first connection
- **AND** no `claude plugin install` subprocess is spawned

#### Scenario: Plugin missing → silent background install

- **GIVEN** `~/.claude/plugins/marketplaces/claudboard/` does not exist
- **WHEN** the server boots
- **THEN** the HTTP server starts listening and accepts connections
- **AND** bootstrap state transitions to `installing` synchronously with boot
- **AND** the server spawns `claude plugin install claudboard@claudboard` in the background
- **AND** on child exit 0, bootstrap state transitions to `ready`

#### Scenario: Plugin install fails

- **GIVEN** the install subprocess exits with code 1 and writes `"network unreachable"` to stderr
- **WHEN** the server processes the exit
- **THEN** bootstrap state transitions to `install-failed` with `message` containing `"network unreachable"` (last 2 KB if longer)
- **AND** subsequent `POST /api/prereqs/:cmd` calls return 503 with the install-failed message
- **AND** the state remains `install-failed` until a successful `POST /api/bootstrap/retry` resolves it

#### Scenario: Plugin install times out

- **GIVEN** the install subprocess has not exited 5 minutes after spawn
- **WHEN** the timeout fires
- **THEN** the subprocess is killed with SIGTERM (and SIGKILL if still alive after 5 seconds)
- **AND** bootstrap state transitions to `install-failed` with `message = "Plugin install timed out after 5 minutes"`

### Requirement: Bootstrap status endpoint

The server SHALL expose `GET /api/bootstrap/status` returning `{ state: BootstrapStatus, message?: string }` where `BootstrapStatus` is one of `ready`, `installing`, `cli-missing`, `install-failed`. The endpoint SHALL respond within 100ms regardless of the install subprocess state and SHALL be exempt from any bootstrap-state gating (it is always available).

The server SHALL expose `POST /api/bootstrap/retry` that re-runs the bootstrap process. The endpoint SHALL only act when the current state is `install-failed` (any other state returns HTTP 409 with `{ error: "Bootstrap retry is only valid from install-failed state.", currentState: <state> }`). On success the endpoint SHALL return the post-retry state (typically `installing`, eventually transitioning to `ready` or back to `install-failed` asynchronously).

#### Scenario: Status reports current state

- **WHEN** the client GETs `/api/bootstrap/status` during install
- **THEN** the response is HTTP 200 with `{ state: "installing" }` (no message field needed)

- **WHEN** the client GETs the endpoint after an install failure
- **THEN** the response is HTTP 200 with `{ state: "install-failed", message: <stderr tail> }`

#### Scenario: Retry only valid from install-failed

- **GIVEN** bootstrap state is `ready`
- **WHEN** the client POSTs `/api/bootstrap/retry`
- **THEN** the response is HTTP 409 with `{ error: "Bootstrap retry is only valid from install-failed state.", currentState: "ready" }`

- **GIVEN** bootstrap state is `install-failed`
- **WHEN** the client POSTs `/api/bootstrap/retry`
- **THEN** the response is HTTP 200 with `{ state: "installing" }` and the install subprocess is re-spawned

### Requirement: `cli-missing` is a terminal user-action state

If the Claude Code CLI is not present on PATH at boot, the system SHALL set bootstrap state to `cli-missing` and SHALL NOT attempt any further bootstrap actions. The state remains `cli-missing` for the lifetime of the server process — the user must install Claude Code and restart `npx bosch-sdlc` to recover. `POST /api/bootstrap/retry` SHALL NOT transition out of `cli-missing` (it returns 409 like any non-`install-failed` state).

The `GET /api/bootstrap/status` response in this state SHALL include `message: "Claude Code is not installed. Visit https://claude.com/download to install it, then restart bosch-sdlc."`.

This is distinct from the existing Claude Code precondition check in `packaging` which exits the process. The precondition check still applies for the strict "Claude Code missing AND `~/.claude/` missing" case; this requirement covers the softer "Claude Code missing but `~/.claude/` exists from a prior install" case, where exiting the process gives the user no recovery path through the UI.

#### Scenario: CLI missing → terminal state surfaced via API

- **GIVEN** the `claude` binary is not on PATH but `~/.claude/` exists
- **WHEN** the server boots
- **THEN** bootstrap state is `cli-missing` and the server is otherwise fully functional (GET endpoints work, the bootstrap status endpoint returns the install-link message)
- **AND** `POST /api/bootstrap/retry` returns 409
- **AND** `POST /api/prereqs/:cmd` and `POST /api/runs` return 503 with the cli-missing message
