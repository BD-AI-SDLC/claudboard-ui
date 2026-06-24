## ADDED Requirements

### Requirement: Per-skill input schema

The system SHALL define, for each supported claudboard skill (`analyse`, `generate`, `workflow`, and follow-on `techdebt`, `refresh`), a Zod input schema in `protocol/` that captures every choice, free-form value, and toggle the skill would otherwise ask about interactively. The schemas SHALL be combined into a single discriminated union `claudboardLaunchRequest` keyed on the `skill` field.

#### Scenario: Workflow skill schema covers tracker, repo, and field values
- **WHEN** the system validates a launch request with `skill: "workflow"`
- **THEN** the schema requires `tracker` (`"jira" | "tr"`), `repo` (`"ado" | "github"`), all tracker-specific fields (e.g. `jira.cloudId`, `jira.projectKey`, `jira.urlBase` when `tracker = "jira"`), all repo-specific fields (e.g. `github.owner`, `github.repo` when `repo = "github"`), and shared git fields

#### Scenario: Generate skill schema covers stale-report policy and artifact selection
- **WHEN** the system validates a launch request with `skill: "generate"`
- **THEN** the schema requires a `staleReportPolicy` (`"warn-continue" | "warn-block"`) and an artifact selection that maps onto each generation toggle the skill exposes

#### Scenario: Analyse skill schema covers ecosystem flag and topology confirmation
- **WHEN** the system validates a launch request with `skill: "analyse"`
- **THEN** the schema requires an `ecosystemLevel` boolean (workspace-mode only) and an `acceptTopology` boolean defaulting to true

#### Scenario: Free-form field accepts a stub sentinel
- **WHEN** the user submits any free-form text field with the value `"__stub__"`
- **THEN** the schema accepts it and the prompt template renders the field as `[TODO: <FIELD_NAME>]`

### Requirement: Launch endpoint validates input strictly

The server SHALL expose `POST /api/claudboard/run` that accepts a `claudboardLaunchRequest` body, validates it against the per-skill schema, and returns `400 Bad Request` with the structured Zod error if any required field is missing or invalid. The endpoint SHALL NOT apply silent defaults to missing required fields.

#### Scenario: Valid launch request creates a run
- **WHEN** the client posts a valid request for `skill: "workflow"` with all required fields populated
- **THEN** the server returns `201 Created` with a `runId`, and persists a run record with `kind = "claudboard-workflow"`

#### Scenario: Missing required field rejected
- **WHEN** the client posts a request for `skill: "workflow"` with `tracker = "jira"` but no `jira.cloudId`
- **THEN** the server returns `400` with an error body identifying the missing field, and no run record is created

#### Scenario: Unknown skill rejected
- **WHEN** the client posts a request with `skill: "unknown"`
- **THEN** the server returns `400` and lists the supported skill values

### Requirement: Plugin availability check

The launch endpoint SHALL verify that the claudboard plugin is installed at the expected path (`~/.claude/plugins/marketplaces/claudboard/`) before invoking the Agent SDK. If the plugin is absent, the endpoint SHALL return `412 Precondition Failed` with an error body containing installation instructions.

#### Scenario: Plugin missing returns precondition failure
- **WHEN** the client posts a valid request and the claudboard plugin directory does not exist
- **THEN** the server returns `412` with `{ error: "claudboard plugin not installed", install: "<instructions>" }` and no run record is created

#### Scenario: Plugin present allows launch
- **WHEN** the client posts a valid request and the claudboard plugin directory exists
- **THEN** the server proceeds to invoke the Agent SDK

### Requirement: Prompt template suppresses interactive prompts

For each supported skill, the server SHALL render a prompt template that begins with a non-interactive preamble explicitly forbidding `AskUserQuestion` calls, forbidding turn-ending to wait for free-form input, instructing auto-approval of all gates, and providing every validated input as a structured key/value block. The template SHALL conclude by invoking the skill (e.g. `Now execute /claudboard-workflow.`).

#### Scenario: Workflow template includes all submitted values
- **WHEN** the server renders the workflow template for a valid request
- **THEN** the rendered prompt contains the non-interactive preamble, a section labelled "Provided answers" listing every input field and its value, and a final line invoking the skill

#### Scenario: Stub values rendered as TODO placeholders
- **WHEN** any free-form field in the request equals `"__stub__"`
- **THEN** the template renders that field's value as `[TODO: <FIELD_NAME>]` in the "Provided answers" block

### Requirement: Reuse of run lifecycle

The runner SHALL persist runs in the existing `runs` table using the existing run-orchestration code path (`record.ts`, `driver.ts`), stream events via the existing `broadcast(runId, event)` function, and support pause/resume and sweep behaviors identically to feature runs. The `runs` table SHALL be extended with an additive `kind TEXT DEFAULT 'feature'` column guarded by a `PRAGMA table_info` column-presence check.

#### Scenario: Claudboard run appears in event stream
- **WHEN** a claudboard run is launched and the agent emits an event
- **THEN** subscribers to the WebSocket room for that `runId` receive the event with the same shape as a feature-run event

#### Scenario: Existing feature runs unaffected by migration
- **WHEN** the server starts against a database created before this change
- **THEN** the migration adds the `kind` column with default `'feature'`, all existing rows report `kind = 'feature'`, and existing feature-run flows operate without modification

### Requirement: UI launcher form

The UI SHALL render a modal form for each supported skill that collects every field defined in that skill's input schema, provides client-side validation matching the server-side Zod schema, offers a "stub with TODO" affordance per free-form field, and submits to `POST /api/claudboard/run`. The launcher button for a skill SHALL be disabled if the plugin-availability check fails.

#### Scenario: User submits valid form and run starts
- **WHEN** the user fills the workflow form with valid values and clicks Submit
- **THEN** the UI calls the launch endpoint, closes the modal, and navigates the user to the live run view streaming events for the returned `runId`

#### Scenario: Invalid form field surfaces inline error
- **WHEN** the user enters a malformed value (e.g. an empty `jira.cloudId` without checking "stub")
- **THEN** the form shows an inline error next to the field and the Submit button remains disabled

#### Scenario: Stub checkbox replaces value with sentinel
- **WHEN** the user checks "stub" next to a free-form field
- **THEN** the field input is disabled and the form submits that field's value as `"__stub__"`

#### Scenario: Plugin missing disables launcher
- **WHEN** the UI loads and the plugin-availability check fails
- **THEN** all claudboard launcher buttons are disabled with a tooltip explaining the plugin is not installed

### Requirement: Auto-approval of final gates

Every run launched via the runner SHALL have all final approval gates auto-approved by virtue of the prompt-template preamble. The runner SHALL NOT expose a separate "Apply" step or post-run confirmation; the form submission is the user's approval.

#### Scenario: Generate run completes without UI gate
- **WHEN** a `generate` run reaches the artifact-generation gate the skill normally exposes
- **THEN** the run proceeds to write artifacts without emitting a `paused-gate` status

### Requirement: Out-of-scope skills explicitly rejected

The launch endpoint SHALL reject `skill` values for `workspace-init` and `workspace-link` with a `400 Bad Request` and an error message indicating those skills must be run via the CLI.

#### Scenario: Workspace skills not launchable via UI
- **WHEN** the client posts a request with `skill: "workspace-init"` or `skill: "workspace-link"`
- **THEN** the server returns `400` with `{ error: "skill <name> must be run via CLI" }`
