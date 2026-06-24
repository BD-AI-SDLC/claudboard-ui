## Context

The claudboard plugin (installed at `~/.claude/plugins/marketplaces/claudboard/`) ships a family of skills that drive project onboarding, analysis, and workflow scaffolding. Each skill embeds interactive prompts in prose (e.g. `> [continue / re-run]`, free-form field requests for `jira.cloudId`, `github.owner`, etc.). The Claude harness only pauses for `AskUserQuestion` or end-of-turn; printed prose is not a pause point, so the model proceeds with a guessed default and the user has no way to answer.

Inside bosch-sdlc the situation is worse: the Agent SDK is invoked from the server, the run streams events to the UI via WebSocket, and there is no UX surface for free-form text entry once the run is live. The existing `gate/` module supports binary approval gates, not arbitrary input collection.

The runtime architecture already in place:
- `protocol/` — shared Zod schemas and types.
- `server/run/` — `record.ts`, `driver.ts`, `prompt-builder.ts`, `routes.ts`. Runs are recorded in SQLite (`runs` table), driven by the Agent SDK, and stream events via `broadcast(runId, event)`.
- `server/gate/` — deferred-promise pattern for human-in-the-loop gates.
- `ui/` — React 18 dashboard with API client and WebSocket subscriptions.

Five claudboard skills are in scope long-term: `analyse`, `generate`, `workflow`, `techdebt`, `refresh`. The first three are priority; the latter two follow the same pattern.

## Goals / Non-Goals

**Goals:**
- Eliminate every in-flight interactive question for the supported claudboard skills when launched from bosch-sdlc.
- Collect all answers upfront via a per-skill modal form in the UI.
- Reuse existing run orchestration, persistence, and WebSocket streaming — do not introduce a parallel run lifecycle.
- Fail fast at the API boundary when inputs are incomplete, before the Agent SDK is invoked.
- Always auto-approve final gates; the form submission **is** the approval.

**Non-Goals:**
- Modifying claudboard skill source files (they live in a vendor plugin directory and may update independently).
- Covering `claudboard-workspace-init` and `claudboard-workspace-link` (rarely run; acceptable via CLI).
- Building a generic "any skill" launcher framework. This is a deliberately scoped claudboard runner.
- Persisting form values across runs as user preferences (deferred; today every run starts from a clean form).
- A second "Apply" confirmation step after the work is drafted (`autoApprove` is always true).

## Decisions

### 1. Per-skill Zod schema in `protocol/`, discriminated union by `skill`

Each supported skill gets its own input schema (e.g. `claudboardWorkflowInput`, `claudboardGenerateInput`) capturing every choice + free-form field the skill would otherwise ask about. A top-level `claudboardLaunchRequest = z.discriminatedUnion("skill", [...])` wraps them.

**Why:** Matches existing protocol conventions (Zod schema as source of truth, types derived via `z.infer<>`). The discriminated union gives the server a single validation entry point and the UI a single API client signature while keeping per-skill field sets strongly typed.

**Alternative considered:** A single flat schema with all fields optional. Rejected — pushes validation responsibility to the server-side prompt template and loses per-skill field documentation in the form.

### 2. New `server/src/claudboard/` module

Contains: `routes.ts` (the launch endpoint), `prompt-templates/` (one template per skill), `launcher.ts` (input → prompt → run record → driver invocation), `skill-discovery.ts` (checks the plugin is installed and returns metadata for the UI).

**Why:** Feature-based grouping is the project convention (`registry/`, `gate/`, `run/`, `prereq/`, `bootstrap/` all follow this shape).

### 3. Reuse `runs` table and existing driver; mark runs with a `kind` column

Add an additive migration in `db.ts`: `ALTER TABLE runs ADD COLUMN kind TEXT DEFAULT 'feature'` guarded by `PRAGMA table_info`. Claudboard runs are recorded with `kind = 'claudboard-<skill>'`.

**Why:** Avoids a parallel run table and reuses event streaming, sweep, and pause/resume infrastructure for free. The `kind` column lets the UI filter dashboards and apply skill-specific renderers later.

**Alternative considered:** Separate `claudboard_runs` table. Rejected — duplicates the run lifecycle and would force the UI to subscribe to a second event stream.

### 4. Prompt template renders all answers as a structured preamble + invokes the skill

Each template starts with a fixed preamble: *"You are running `/claudboard-<skill>`. All answers normally requested interactively are provided below. Do not call AskUserQuestion. Do not end your turn to wait for free-form input. Auto-approve all final gates. If the skill source asks a question whose answer is below, use the provided value silently."* Followed by a key/value block of the validated inputs. Then `Now execute /claudboard-<skill>.`

**Why:** The claudboard skill source is unchanged; we lean on the preamble to suppress its prompt branches. If a future skill version asks an unknown question, the worst case is the model guesses — same as today, but never worse.

**Risk noted in next section.**

### 5. UI: per-skill modal form, single API client method, launcher buttons per dashboard surface

`ui/src/components/claudboard/<Skill>Form.tsx` per skill, plus a thin `claudboardApi.launch(skill, inputs)` method in `ui/src/api/`. The launcher entry points (buttons opening the modals) live in the existing dashboard screens that already host run-launching UI; exact placement is a UI concern, not an API one.

**Why:** Hand-built forms are appropriate at this scope (3-5 skills). A generic form generator from Zod is over-engineering for the priority skill set.

### 6. Strict input validation; no partial launches

The launch endpoint returns 400 with the Zod error if any required field is missing or invalid. No "use a default" fallback at the API boundary. The form has its own client-side validation (also from the Zod schema via `zod-to-json-schema` or hand-mirrored) so the user sees errors before submit.

**Why:** Once the run starts, there is no way for the user to correct course without a gate. Strict upfront validation is the cheapest place to catch problems.

## Risks / Trade-offs

- **Claudboard skill version drift** → If an upstream claudboard release adds a new question, the runner's schema will not cover it; the model may guess. **Mitigation:** version-pin the claudboard plugin in install docs; add an integration test that exercises each skill with a complete input and asserts no AskUserQuestion was attempted (via event log inspection); document the audit procedure for new claudboard versions.

- **Prompt-preamble compliance is best-effort** → The preamble *requests* the model not to ask questions, but cannot guarantee it. **Mitigation:** the preamble is paired with explicit per-question instructions ("when the skill asks X, the answer is Y"); the run is recorded so any deviation is auditable; the preamble can be tightened as we observe behavior.

- **Form proliferation** → Each new claudboard skill needs a hand-built form + schema + template. **Mitigation:** scope is fixed at 5 skills; revisit if it grows past that.

- **Free-form fields without server-side intelligence** → Today the workflow skill offers a "stub with TODO" escape on every field. The form must offer the equivalent (e.g. a "stub" checkbox per text field) so the user is never blocked by an unknown value. **Mitigation:** each free-form field in the schema is `z.union([z.string().min(1), z.literal("__stub__")])`; the template renders `__stub__` as `[TODO: FIELD_NAME]`.

- **No persistence of form values** → Users re-enter the same Jira/GitHub values on every run. **Mitigation:** deferred to a follow-up; not a blocker for the first delivery. Browser autofill helps somewhat.

- **Plugin not installed** → `POST /api/claudboard/run` must check `~/.claude/plugins/marketplaces/claudboard/` exists and return a clear 412/422 with installation instructions if not. **Mitigation:** the `skill-discovery.ts` module performs this check on every launch (cheap stat call) and on UI load to gate the launcher buttons.

## Open Questions

- Should the per-skill modal forms live in a dedicated dashboard section ("Claudboard") or be surfaced inline in the existing repo/project view? Defer to UI implementation phase.
- Do `techdebt` and `refresh` warrant the same auto-approve model, or do they need a stage-then-apply mode because their outputs touch many files? Audit during follow-up.
