---
name: feature-workflow
model: claude-sonnet-4-6
description: >
  Kick off intentional feature work with the full ticketed workflow: clarify
  scope, create a goal-oriented JIRA ticket, set up the branch, develop the
  solution, commit, and open a PR. Use this skill when the user says
  "start feature: X", "start a feature", "kick off work on X", or "full
  workflow for X". This is a deliberate mode the user enters — do NOT
  trigger for casual coding requests, experiments, spikes, or when the user
  just asks to "add X" or "implement X" without explicit feature framing.
  The phrase "start feature" is the signal.
---

# Start Feature Workflow

This skill orchestrates the full lifecycle of intentional feature work:
ticket → clarify → specify → plan → branch → develop → test → commit → review → PR → finalize.

It is designed to be entered deliberately. Experiments and spikes skip this
entirely — the user just codes. This workflow is for work that deserves a
JIRA ticket, a clean branch, and a PR.

**There is exactly one human gate: spec and plan approval in Phase 1.** After
that, all phases run autonomously.

## Project configuration

JIRA, Azure DevOps, and git conventions are externalized to
`.claude/skills/feature-workflow/config.json`. Sub-agents read it directly.
Before Phase 1-pre, verify the config is present and parseable:

```
Tool: Read
file_path: .claude/skills/feature-workflow/config.json
```

Hold these values for use in Phase 1-pre and beyond:
- `<projectKey>` ← `jira.projectKey`
- `<urlBase>` ← `jira.urlBase`
- `<transitions>` ← `jira.transitions` (object: start, success, failure, pause)
- `<aiLabels>` ← `jira.labels.ai` (array, e.g., `["AI", "AI_CLI"]`)
- `<areaLabels>` ← `jira.labels.area` (null or per-area object)
- `<branchTypes>` ← `git.branchTypes` (array, e.g., `["feature","bugfix","hotfix"]`)
- `<branchPattern>` ← `git.branchPattern` (template, e.g., `"{type}/{ticket}/{slug}"`)

If the config is missing or invalid, stop and ask the user to populate it
before continuing — the workflow cannot create tickets or PRs without it.


### Additive label resolution

When computing the additive label set, resolve the area label for the current
work type as follows:

1. If `<areaLabels>` is `null` → no area label (skip)
2. If `<areaLabels>` is an object → look up the work area (`backend`/`frontend`/`devops`/`docs`) → use the value if non-null, skip if null

```
resolveAreaLabel(area, areaLabels):
  if areaLabels is null → return null
  value = areaLabels[area]
  if value is null or undefined → return null
  return value
```

The orchestrator computes `labelsToAdd` — the additive set to pass to
`jira-agent` — as:

```
labelsToAdd = <aiLabels> ∪ { resolvedAreaLabel }  (omit if null)
```

The orchestrator NEVER reads the ticket's existing labels and NEVER computes
a merged set. Label preservation is handled structurally by the
`scripts/jira-add-labels.sh` script inside jira-agent.

The main branch (`main` vs `master`) is auto-detected at runtime by the
git-agent and the `prepare-*.sh` scripts via
`.claude/skills/feature-workflow/scripts/lib.sh` — no config entry needed.

## Agent architecture

Specialized work — BDD specification, architecture planning, JIRA ticket
management, and PR creation — runs as scoped sub-agents via the `Agent` tool.
Each sub-agent receives only the tools it needs and a self-contained prompt;
it returns a small JSON result block that the main agent uses to continue.

- **sdd-expert-agent** — domain expert in BDD specifications, writes
  exhaustive Gherkin specs using actor/action/outcome pattern
- **architect-agent** — expert in high-level architecture, software
  contracts (OpenAPI, DB entities, repository ports, DTOs, commands), and
  precise task decomposition into checkpoint-based execution plans
- **jira-agent** — manages Atlassian Jira tickets: creation with AI labels,
  description updates, status transitions, work logging, and comments
- **pr-agent-github** — creates GitHub pull requests with `Closes #N` linking
  and GitHub Actions run verification
- **spec-reviewer** — verifies implementation matches BDD spec scenarios
- **design-reviewer** — verifies code quality against repo standards and rules
- **git-agent** — handles all git repository operations: branch creation,
  staging, committing, squashing, amending, syncing, and pushing
- **implementation-agent** — implements code changes: baseline verification,
  checkpoint-by-checkpoint development with build/test/lint/live-test loops,
  and review fix application

The main agent's job is to orchestrate: spawn sub-agents, pass context, and
route results. It does not touch tracker or repo MCP tools directly — those
belong to the sub-agents. It does not write code, run builds, or execute
tests — that belongs to the implementation-agent.


```
Main agent (Sonnet 4.6)
├── Phase 1: Ticket, clarify, specify, plan
│   ├── 1-pre [TRACKER_JIRA] Path A  → spawn jira-agent (fetchAndPrepare) → {ticketKey}
│   │   or   Path B (auto-create)   → spawn jira-agent (create) → {ticketKey}
│   │         Record WORKFLOW_START timestamp
│   ├── 1-syn. Stated synthesis        (main — print + optional block)
│   ├── 1a. Clarify scope              (main — conversation)
│   │         → spawn jira-agent (updateDescription)
│   ├── 1b. Create BDD spec            → spawn sdd-expert-agent → {specFiles}
│   ├── 1c. Execution plan             → spawn architect-agent  → {planPath}
│   ├── 1d. User gate                  (user confirms spec + plan)
│   │         → spawn jira-agent (addWorklog — "Requirement refinement work")
│   │         Record CHECKPOINT timestamp
├── Phase 2: Create branch             → spawn git-agent (create-branch)
├── Phase 3: Develop and test
│   ├── 3a. Baseline + checkpoint 1    IN PARALLEL (both run_in_background)
│   │   ├── spawn implementation-agent (baseline)
│   │   └── spawn implementation-agent (checkpoint 1)
│   │   If baseline fails: STOP workflow
│   └── 3b. Remaining checkpoints      → spawn implementation-agent (checkpoint N)
├── Phase 4: Commit                    → spawn git-agent (count-commits, squash, stage-and-prepare, commit)
├── Phase 5: Review
│   ├── 5a. Spec review               → spawn spec-reviewer    → {passed, findings}
│   │         If failed: spawn implementation-agent (fix-findings)
│   │                    → spawn git-agent (amend) → re-spawn spec-reviewer
│   └── 5b. Design review             → spawn design-reviewer  → {passed, findings}
│             If failed: spawn implementation-agent (fix-findings)
│                        → spawn git-agent (amend) → re-spawn design-reviewer
├── Phase 6 [REPO_GITHUB]: PR creation
│   ├── spawn git-agent (validate-pr-readiness, sync-and-push)
│   └── spawn pr-agent-github                                  → {prUrl}
└── Phase 7 [TRACKER_JIRA]: Finalize
              ├── addWorklog — "Implementation work"        → jira-agent
              ├── addComment — cost analysis + time summary → jira-agent
              └── transition → success                      → jira-agent
```


---

## Error handling

The workflow is wrapped in a top-level error handler. Treat failures as
either **recoverable** (handled inside the iterate loop, do NOT touch ticket
status) or **non-recoverable** (must surface error and halt; fire
`failure_transition` if configured).

| Category | Examples |
|----------|----------|
| **Non-recoverable** | Atlassian MCP unavailable; configured transition name not found in available transitions; ticket not found; network errors after retry; unhandled exception from any sub-agent |
| **Recoverable** | Test failures; lint failures; design review pushback; spec review pushback; build failures |

Recoverable failures stay inside the existing iterate loops in Phases 3 and
5 — they do NOT bubble up to this error handler and do NOT touch ticket status.

On a non-recoverable failure:

1. If `<transitions>.failure` is non-null, invoke jira-agent to signal the failure:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "transition",
      "ticketKey": "<ticketKey>",
      "lifecycleState": "failure"
    }
  allowedTools:
    - mcp__atlassian__getTransitionsForJiraIssue
    - mcp__atlassian__transitionJiraIssue
```

2. Always surface the original error message to the user (include the error
   details and, for transition misses, the list of available transitions).
3. Always halt — do not attempt to continue the workflow.

If `<transitions>.failure` is `null`: skip step 1 but still surface the
error and halt.


---

## Halt mechanics

The Claude Code CLI pauses ONLY when the orchestrator (1) calls the harness pause tool
or (2) ends its turn — meaning no further tool calls and no further text in the
same response. Plain text output does NOT pause the CLI: the harness streams
text and immediately allows the next tool call. **Every later instruction in
this document using the words "prompt", "HALT", "wait for user", "halt and tell
the user", "wait for guidance", or `proceed` MUST be interpreted under this
rule.** When a phase says "halt" or "wait", that means: call the harness pause tool
where the response is an option from a small fixed set, OR print the prompt
and end the turn immediately. Do not call another tool, do not summarize, do
not "continue while waiting".

In `gate=mcp` mode, pauses are handled by `mcp__bosch__*` lifecycle calls. In `gate=interactive` mode, the pause tool is `AskUserQuestion`.

---

## Clarification autonomy

After configuration validation and before Phase 1-pre, prompt the user to
choose a clarification autonomy level. Read `config.clarify.defaultAutonomy`
from `config.json` (fallback `balanced` when the field is absent or invalid).

**If gate=mcp:** Call `mcp__bosch__clarify_request` with a single question: "Clarification autonomy" with options for each level (autopilot/balanced/guided/manual) and the config default pre-selected. The tool suspends until the user responds in the browser UI.

**If gate=interactive:** Use `AskUserQuestion` with the question
"Clarification autonomy: balanced — accept default or override?"
and options:

- `Accept default (balanced)`
- `a — autopilot`
- `b — balanced`
- `c — guided`
- `d — manual`

This is the primary mechanism — it is the only harness-enforced way to
pause for an enumerated choice.

**If `AskUserQuestion` is unavailable in the current context** (e.g., the
orchestrator is running under a sub-agent that does not expose it), print
the prompt line below verbatim and **end the turn immediately** — do not
call another tool, do not summarize, do not continue until the user has
replied. Text alone does NOT pause the CLI; see "Halt mechanics" above.

```
Clarification autonomy: balanced — accept [Enter] or override [a / b / c / d]?
```

Accept the response and hold the resolved level as `<autonomyLevel>` throughout
the entire workflow. Valid values and their one-letter codes:

| Code | Level | Behavior summary |
|------|-------|-----------------|
| `a` | `autopilot` | Skip Clarify (1a) entirely. Synthesis (1-syn) prints but does NOT block. Affected-repos auto-confirmed (workspace). All clarification dimensions accumulated as assumptions for the 1d gate. |
| `b` | `balanced` | 8-dimension enumeration rubric in 1a. Every `unclear` dimension becomes a question. Synthesis blocks for confirmation. |
| `c` | `guided` | 3-dimension direction-only rubric in 1a. Synthesis blocks for confirmation. Dimensions 4–8 deferred as gate assumptions. |
| `d` | `manual` | Free-form chat clarification in 1a; after each question batch the orchestrator MUST end the turn and wait — `proceed` is only reachable when the orchestrator has stopped calling tools (see "Halt mechanics"). Synthesis blocks for confirmation. |

**After the user responds**, print a one-line summary of the resolved level:

```
Clarification autonomy: autopilot — Clarify phase will be skipped; synthesis will print without blocking.
Clarification autonomy: balanced — Structured rubric; questions for every unclear dimension.
Clarification autonomy: guided — Direction questions only; lower-priority dimensions deferred to gate.
Clarification autonomy: manual — Free-form chat; type "proceed" when you're satisfied.
```

**No-persistence rule:** Per-invocation overrides do NOT modify `config.json`. The
next invocation re-prompts with the unchanged `config.clarify.defaultAutonomy`
value. To change the project default, the user edits `config.json` directly.

**No per-feature memory:** The orchestrator does NOT read or write any per-feature
autonomy state under `.claude/changes/<TICKET>/`. Autonomy is resolved fresh at
every invocation from the config default and the current-invocation override.

**Scope guardrail:** `<autonomyLevel>` gates only Phase 1-syn, 1a, and 1a-ws.
All other phases (2 through 7) and the 1d gate are UNAFFECTED — the gate always
fires regardless of autonomy level.

---

## Gate mode

Parse `--gate=<mode>` from the invocation message at workflow start (alongside `--autonomy`). Default: `interactive`.

| Mode | Gates | Clarification | Phase/Agent/Checkpoint lifecycle | Halts |
|------|-------|---------------|----------------------------------|-------|
| `mcp` | `mcp__bosch__gate_request` | `mcp__bosch__clarify_request` | `mcp__bosch__phase_start`, `phase_complete`, `agent_start`, `agent_complete`, `checkpoint_start`, `checkpoint_complete` | No halts — MCP tools suspend and resume the agent |
| `interactive` | `AskUserQuestion` / end-of-turn | `AskUserQuestion` | Omitted — no consumer for lifecycle signals | `AskUserQuestion` or end-of-turn |

**Hard contract — this is not a preference:**

- In `mcp` mode: NEVER use `AskUserQuestion`. NEVER end a turn to wait for user input. ALL gates and lifecycle signals go through `mcp__bosch__*` tools.
- In `interactive` mode: NEVER call any `mcp__bosch__*` tool. They do not exist in this environment.

Hold the resolved mode as `<gateMode>` throughout the entire workflow — resolved once at invocation, never re-parsed.

---

## Phase 1: Ticket, clarify, specify, and plan

**If gate=mcp:** Call `mcp__bosch__phase_start` with `{ num: 1, title: "Ticket · Clarify · Specify · Plan" }`.

This phase creates the JIRA ticket immediately, then produces two
deliverables before any code is written: a complete BDD specification and
a detailed technical execution plan. Both live in the `specs/` directory
and are committed with the feature — they are code, not throwaway notes.

### Time tracking

Record the workflow start time at the very beginning of Phase 1. This is
used to calculate work log durations later.

```bash
WORKFLOW_START=$(date +%s)
SESSION_JSONL_PATH=~/.claude/projects/$(pwd | sed 's|/|-|g')/$CLAUDE_CODE_SESSION_ID.jsonl
```

Hold `WORKFLOW_START` and `SESSION_JSONL_PATH` throughout the workflow. After Phase 1d, calculate the
elapsed time and log it. Record a second timestamp (`CHECKPOINT`) to
measure the implementation phase separately.

### 1-pre. Ticket setup

Read the agent instructions from
`.claude/skills/feature-workflow/agents/jira-agent.md` once and reuse
for all JIRA spawns in Phase 1.

---

**Path A — user provided a JIRA ticket key:**

The ticket already exists. Infer the work area from the user's request
(`backend` | `frontend` | `devops` | `docs`) and hold it as `<area>`.

Delegate to the JIRA sub-agent to prepare the ticket (transition to start
state, sprint, assign) and return the current label set:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "fetchAndPrepare",
      "ticketKey": "<ticket key from user>"
    }
  allowedTools:
    - mcp__atlassian__searchJiraIssuesUsingJql
    - mcp__atlassian__getJiraIssue
    - mcp__atlassian__getTransitionsForJiraIssue
    - mcp__atlassian__transitionJiraIssue
    - mcp__atlassian__editJiraIssue
    - mcp__atlassian__atlassianUserInfo
```

The agent will emit a JSON result block. Extract and hold:

```json
{
  "action": "fetchAndPrepare",
  "ticketKey": "<projectKey>-XXXXX",
  "ticketUrl": "<urlBase>/browse/<projectKey>-XXXXX",
  "existingDescription": true,
  "currentStatus": "<current Jira status>"
}
```

Hold `existingDescription` — it determines whether the description is
updated after scope clarification (1a).

**Compute and apply labels (Path A):**

Using the additive label resolution from the Project configuration section:

1. `resolvedAreaLabel = resolveAreaLabel(<area>, <areaLabels>)`
2. `labelsToAdd = <aiLabels> ∪ { resolvedAreaLabel }` (omit if null)
3. Apply additive labels via the JIRA sub-agent:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "addLabels",
      "ticketKey": "<ticketKey>",
      "labelsToAdd": <labelsToAdd array>
    }
  allowedTools:
    - Read
    - Bash
```

Tell the user the ticket URL, then proceed to 1a.

---

**Path B — no ticket provided:**

Create a new ticket. Before spawning the agent, classify the user's
initial request:

**Issue type — Task vs Story:**
- `"Task"` — purely technical/internal work: refactoring, tech debt,
  dependency upgrade, config change, internal tooling, removing dead
  code, migration, performance optimization, fixing code quality
- `"Story"` — new feature, change request, user-facing behavior change,
  new API endpoint, new UI component, business rule change

**Priority — infer from tone and wording:**
- `"Critical"` — words like "critical", "urgent", "production down",
  "hotfix", "breaking", "blocker"
- `"High"` — words like "important", "needed urgently", "ASAP",
  "high priority", "blocking other work"
- `"Medium"` — default for neutral requests, or words like "should",
  "needed", "please add"
- `"Low"` — words like "could", "nice to have", "eventually",
  "when possible", "potential", "consider", "minor"

Infer the work area from the user's request (`backend` | `frontend` |
`devops` | `docs`) and hold it as `<area>`.

**Compute labels (Path B):**

1. `resolvedAreaLabel = resolveAreaLabel(<area>, <areaLabels>)`
2. `labelsToAdd = <aiLabels> ∪ { resolvedAreaLabel }` (omit if null)

Delegate to the JIRA sub-agent, passing the additive label set. The `create`
action will apply labels via `jira-add-labels.sh` after ticket creation —
there is no `labels` field in `additional_fields`:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "create",
      "scope": "<initial description from user's request — use as-is, even if brief>",
      "area": "<backend | frontend | devops | docs — infer from user's request>",
      "issueType": "<Task | Story — from classification above>",
      "priority": "<Critical | High | Medium | Low — from classification above>",
      "acceptanceCriteria": [
        "<derive what you can from the initial request — even if minimal>"
      ],
      "context": "<any background the user mentioned>",
      "labelsToAdd": <labelsToAdd array computed above>
    }
  allowedTools:
    - Read
    - Bash
    - mcp__atlassian__searchJiraIssuesUsingJql
    - mcp__atlassian__createJiraIssue
    - mcp__atlassian__getTransitionsForJiraIssue
    - mcp__atlassian__transitionJiraIssue
    - mcp__atlassian__editJiraIssue
    - mcp__atlassian__atlassianUserInfo
```

The agent will emit a JSON result block. Extract and hold:

```json
{
  "action": "create",
  "ticketKey": "<projectKey>-XXXXX",
  "ticketUrl": "<urlBase>/browse/<projectKey>-XXXXX"
}
```

For newly created tickets, set `existingDescription` to `false` (the
description will always be refined after clarification).

Tell the user the ticket URL, then proceed to 1a.


### 1-syn. Stated synthesis

Before asking any clarification questions, externalize the orchestrator's
internal understanding of the feature by emitting a synthesis. This phase
always fires — for every autonomy level, for every ticket count.

**Context grounding (do before synthesizing):**

When any of the following files are present, read them before synthesizing:
- `CLAUDE.md` (project root)
- `.claude/memories/ecosystem.md` (or equivalent ecosystem memory file)
- (Workspace mode) Per-repo analysis reports under `.claude/reports/`

Use the project's documented architecture, vocabulary, and service topology to
ground the synthesis — name services that actually exist, flag "the ticket implies
X but no such service is documented." When none of these files exist, synthesize
from ticket text alone and note in the synthesis output: "No project context
available — synthesis based on ticket text only."

**Synthesis output shape:**

Emit a user-facing block with:

1. **2–3 paragraph plain-English summary** of the feature as the orchestrator
   understands it — purpose, expected behavior, and likely impact.
2. **Scope boundaries** (best-effort) — what is in scope and what is explicitly
   out of scope based on the ticket text and project context.
3. **(Multi-ticket input only)** **Proposed slicing** — a bullet list of how the
   orchestrator proposes to treat the tickets as one feature, with one-line
   justification per slice.

**Blocking behavior by autonomy level:**

| `<autonomyLevel>` | Behavior |
|-------------------|----------|
| `autopilot` | Print synthesis as informational output and continue immediately to 1a (which will be skipped). Do NOT wait for user input. |
| `balanced` | Print synthesis, then HALT. Wait for user to respond with `confirm` or `correct: <feedback>`. |
| `guided` | Print synthesis, then HALT. For multi-ticket input, the blocking confirmation MUST cover BOTH the prose summary AND the proposed slicing in a single exchange — slicing is a direction-level decision and is NOT auto-accepted in guided mode. |
| `manual` | Print synthesis, then HALT. Wait for user `confirm` or `correct: <feedback>`. |

**HALT means: end the turn immediately after printing the synthesis.** Do
not call any further tool until the user replies with `confirm` or
`correct: <feedback>`. The CLI does not pause on plain text — only
the harness pause tool or end-of-turn returns control. See "Halt mechanics"
and "Gate mode" near the top of this document. This rule applies to every `HALT` /
`Wait for user` row in the table above and to every later "wait for user"
point in this workflow.

**Correction loop (balanced / guided / manual):**

On `correct: <feedback>`:
- If the feedback is concrete and unambiguous: re-synthesize incorporating the
  feedback verbatim, re-print the new synthesis, and re-block for `confirm` or
  `correct: <feedback>`. No upper limit on correction cycles.
- If the feedback is vague or has an ambiguous referent (e.g., "this is wrong"
  with no specifics, or feedback that could apply to multiple parts of the
  synthesis): ask ONE targeted clarifying question about the feedback BEFORE
  re-synthesizing. Do NOT guess and re-synthesize blindly.

**Hold** the confirmed (or autopilot-printed) synthesis as the orchestrator's
working understanding of the feature. Pass it to subsequent phases as the basis
for the BDD spec scope.

### 1a. Clarify scope

Branch on `<autonomyLevel>`:

#### autopilot — skip

Skip 1a entirely. Proceed directly to 1b using the post-synthesis scope as
the clarified scope.

Accumulate all eight canonical clarification dimensions as "assumed from
synthesis" entries for the 1d gate assumptions list:

1. Target repo — assumed from synthesis
2. User-facing impact — assumed from synthesis
3. Constraints and related tickets — assumed from synthesis
4. Actors and roles — assumed from synthesis
5. Error and edge cases — assumed from synthesis
6. Authorization requirements — assumed from synthesis
7. Integration/event boundaries — assumed from synthesis
8. Input validation rules — assumed from synthesis

Also treat the post-synthesis scope as the clarified scope for the ticket
description update step below.

#### balanced — 8-dimension enumeration rubric

Before asking any question, enumerate all eight dimensions and mark each:

```
1. Target repo:   clear: <statement> | unclear: <what is missing>
2. User-facing impact:  clear: <statement> | unclear: <what is missing>
3. Constraints / related tickets:  clear: <statement> | unclear: <what is missing>
4. Actors and roles:  clear: <statement> | unclear: <what is missing>
5. Error and edge cases:  clear: <statement> | unclear: <what is missing>
6. Authorization requirements:  clear: <statement> | unclear: <what is missing>
7. Integration / event boundaries:  clear: <statement> | unclear: <what is missing>
8. Input validation rules:  clear: <statement> | unclear: <what is missing>
```

Present the full rubric to the user (all eight lines with their `clear`/`unclear`
marks and explanatory statements). The user can push back on any dimension
marked `clear` that they believe needs clarification — treat a pushback as an
`unclear` and generate a question for it.

Every dimension marked `unclear` MUST become a question to the user. The
orchestrator MAY NOT proceed to 1b while any dimension remains `unclear`.

After the user answers, re-evaluate the rubric in light of the new information.
Any dimensions that remain `unclear` generate follow-up questions. Loop until
every dimension is `clear`.
- `resolveUnderWorkspace` (gate/resolve-under-workspace.ts) — `realpath` + boundary assertion on all user-supplied paths is excellent security-in-depth
- Deferred Promise gate pattern (`gate/deferred.ts`) — suspends the async generator cleanly without polling; elegant design
- Protocol-first schema design — Zod schemas in `protocol`, `.shape` passed to `tool()`, TypeScript types inferred via `z.infer<>` — no type duplication
- Additive migration pattern (`db.ts`) — `PRAGMA table_info` guards before every `ALTER TABLE ADD COLUMN` prevents migration failures on re-run
- `broadcast(runId, event)` abstraction — no direct `ws.send()` calls anywhere outside `ws-server.ts`
- `bootstrapGuard` middleware (bootstrap/guard.ts) — clean separation of readiness gating from route logic
- `return void res.status().json()` early-exit idiom — consistent, prevents accidental double-response
- Conventional commits: `feat:`, `fix:` prefixes in git log — should be enforced
- Zero `console.log` in production UI code — no debug pollution
- Co-located test files (`Component.test.tsx` beside `Component.tsx`) — easy to find, easy to maintain
- `useRunStream` deduplication pattern using `eventKey` + `seenRef` — prevents WebSocket replay duplicates from the HTTP history/WS overlap window
- CSS prefix enforcement via `check-css-prefixes.js` lint script — automated convention enforcement
- `api/client.ts` abstraction — all fetch calls behind typed methods, no raw fetch scattered across components
- `@bosch-sdlc/protocol` types consumed directly — no local type duplication

#### guided — 3-dimension direction rubric

Before asking any question, enumerate the three direction-level dimensions:

```
1. Target repo:   clear: <statement> | unclear: <what is missing>
2. Change shape (new feature / refactor / bugfix / removal):  clear: <statement> | unclear: <what is missing>
3. Scope boundary (what's in, what's deferred):  clear: <statement> | unclear: <what is missing>
```

Present the full 3-dimension rubric to the user. The user can push back on
any `clear` mark — treat a pushback as an `unclear` and generate a question.

Every `unclear` MUST become a question. Loop until all three dimensions are
`clear`.

Defer dimensions 4–8 from the balanced rubric (actors, error cases,
authorization, integration boundaries, validation rules) to downstream agents
(`sdd-expert-agent`'s `openQuestions` and `architect-agent`'s `risks`).
Accumulate deferred dimensions 4–8 as "assumed from ticket text" entries for
the 1d gate assumptions list.

#### manual — free-form chat

Ask the user about all eight canonical clarification dimensions in conversation
form (not a structured rubric):

1. Which repo is this for?
2. Is there a user-facing impact, or is it internal/infra?
3. Any known constraints or related tickets?
4. Who are the actors? What are their roles and permissions?
5. What are the error and edge cases?
6. Are there authorization requirements?
7. Are there event/integration boundaries (e.g., cross-service calls)?
8. What validation rules apply to inputs?
- `resolveUnderWorkspace` (gate/resolve-under-workspace.ts) — `realpath` + boundary assertion on all user-supplied paths is excellent security-in-depth
- Deferred Promise gate pattern (`gate/deferred.ts`) — suspends the async generator cleanly without polling; elegant design
- Protocol-first schema design — Zod schemas in `protocol`, `.shape` passed to `tool()`, TypeScript types inferred via `z.infer<>` — no type duplication
- Additive migration pattern (`db.ts`) — `PRAGMA table_info` guards before every `ALTER TABLE ADD COLUMN` prevents migration failures on re-run
- `broadcast(runId, event)` abstraction — no direct `ws.send()` calls anywhere outside `ws-server.ts`
- `bootstrapGuard` middleware (bootstrap/guard.ts) — clean separation of readiness gating from route logic
- `return void res.status().json()` early-exit idiom — consistent, prevents accidental double-response
- Conventional commits: `feat:`, `fix:` prefixes in git log — should be enforced
- Zero `console.log` in production UI code — no debug pollution
- Co-located test files (`Component.test.tsx` beside `Component.tsx`) — easy to find, easy to maintain
- `useRunStream` deduplication pattern using `eventKey` + `seenRef` — prevents WebSocket replay duplicates from the HTTP history/WS overlap window
- CSS prefix enforcement via `check-css-prefixes.js` lint script — automated convention enforcement
- `api/client.ts` abstraction — all fetch calls behind typed methods, no raw fetch scattered across components
- `@bosch-sdlc/protocol` types consumed directly — no local type duplication

Ask follow-up questions as needed. Do NOT proceed to 1b until the user
responds with `proceed` (or an equivalent affirmative like "done", "that's
everything", "move on"). Free-form chat continues across as many exchanges
as needed.

---

**After scope is fully clarified** (or skipped in autopilot), update the
ticket description — but only if it needs updating:

- **Newly created ticket** (`existingDescription` is `false`): always
  update — refine the initial description with the fully clarified scope.
- **Existing ticket with thin/missing description** (`existingDescription`
  is `false`): update with the clarified scope.
- **Existing ticket with well-populated description** (`existingDescription`
  is `true`): skip the description update — the ticket is already
  well-described.

When updating, compose a description using the ticket description template
(Goal / Acceptance Criteria / Context) populated with the clarified scope.
Acceptance Criteria go to the dedicated Jira custom field — do NOT include
them in the description body. Delegate to the JIRA sub-agent:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "updateDescription",
      "ticketKey": "<ticketKey from 1-pre>",
      "description": "<updated markdown description: Goal + Context sections only>"
    }
  allowedTools:
    - mcp__atlassian__editJiraIssue
```


### 1b. Create the BDD spec

Once scope is fully clear, determine the spec directory, then delegate to
the SDD Expert sub-agent.

**Directory naming:**

Determine the next sequence number by inspecting existing directories:

```bash
ls -d specs/[0-9]* 2>/dev/null | sort -n | tail -1
```

If none exist, start at `001`. Otherwise increment the highest number by 1,
zero-padded to 3 digits. Use `ticketKey` from Phase 1-pre. The directory
name follows this pattern:

```
specs/<NNN>-<TICKET>-<short-slug>/
```

Example: `specs/001-[TODO: TICKET_PREFIX]-12345-short-description/`

**Delegate to sdd-expert-agent:**

Read the agent instructions from
`.claude/skills/feature-workflow/agents/sdd-expert-agent.md`, then spawn
the agent:

**If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "sdd-expert-agent", op: "write BDD spec" }`.

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of sdd-expert-agent.md as instructions>

    INPUT CONTEXT:
    {
      "scope": "<clarified scope from 1a>",
      "specDir": "specs/<NNN>-<TICKET>-<slug>/",
      "service": "<repo name and path>",
      "actors": ["<actor 1 and role>", "<actor 2 and role>"],
      "constraints": "<known constraints, related tickets, edge cases>",
      "area": "<BE | FE | DevOps | Docs>"
    }
```

**If gate=mcp:** Call `mcp__bosch__agent_complete` with `{ name: "sdd-expert-agent" }`.

The agent will emit a JSON result block. Extract and hold for Phase 1c:

```json
{
  "specDir": "specs/001-[TODO: TICKET_PREFIX]-12345-short-description/",
  "specFiles": ["business-behavior-spec.md", "authorization-spec.md"],
  "scenarioCount": 15,
  "concerns": ["business-behavior", "authorization"],
  "openQuestions": []
}
```

If `openQuestions` is non-empty, present them to the user and resolve
before proceeding. Do not continue to 1c with unresolved ambiguities.

### 1c. Create the technical execution plan

After the spec is complete, delegate to the Architect sub-agent to produce
the execution plan.

**Delegate to architect-agent:**

Read the agent instructions from
`.claude/skills/feature-workflow/agents/architect-agent.md`, then spawn
the agent:

**If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "architect-agent", op: "write execution plan" }`.

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of architect-agent.md as instructions>

    INPUT CONTEXT:
    {
      "specDir": "specs/<NNN>-<TICKET>-<slug>/",
      "service": "<repo name and path>",
      "area": "<BE | FE | DevOps | Docs>",
      "specFiles": <specFiles array from sdd-expert-agent result>
    }
```

**If gate=mcp:** Call `mcp__bosch__agent_complete` with `{ name: "architect-agent" }`.

The agent will emit a JSON result block:

```json
{
  "planPath": "specs/001-[TODO: TICKET_PREFIX]-12345-short-description/execution-plan.md",
  "checkpointCount": 4,
  "taskCount": 12,
  "layersAffected": ["domain", "application", "adapter-in", "adapter-out"],
  "contractsDefined": ["rest-api", "domain-model", "db-entity", "repository-port", "command", "authorization"],
  "risks": []
}
```

If `risks` is non-empty, include them in the gate presentation (1d) so the
user can acknowledge or resolve them.


### 1d. Gate — spec and plan review

**Construct the `assumptions` field before calling the gate:**

The `assumptions` field is a markdown-formatted string listing every
clarification decision the orchestrator made without explicit user input.
Accumulate entries across Phase 1-syn, 1a, and 1a-ws:

| `<autonomyLevel>` | What to accumulate |
|-------------------|--------------------|
| `autopilot` | All 8 clarification dimensions ("assumed from synthesis"), plus any workspace-repo auto-confirmations. One bullet per item. |
| `guided` | Deferred dimensions 4–8 ("assumed from ticket text"), plus any workspace-repo auto-confirmations. |
| `balanced` | Only inferred decisions the user did NOT explicitly correct during synthesis or 1a clarification. Typically empty or near-empty. |
| `manual` | Only inferred decisions the user did NOT explicitly provide. Typically empty. |

When nothing was inferred without user input, `assumptions` MAY be an empty
string or contain only `"No assumptions made — every decision was user-directed."`.

**Request human approval:**

Read the full text of all spec files in `specDir` and the execution plan.

**If gate=mcp:** Call `mcp__bosch__gate_request` with:

```
{
  "kind": "spec+plan",
  "payload": {
    "ticket": "<ticketKey>",
    "spec": "<full text of all BDD spec files from specDir, concatenated>",
    "plan": "<full text of execution-plan.md>",
    "assumptions": "<markdown bullet list of inferred decisions, or empty string>"
  }
}
```

The tool suspends the workflow and delivers the spec + plan to the bosch web UI
for human review. It returns only when the user resolves the gate.

**If gate=interactive:** Present the spec and plan summary to the user. Use
`AskUserQuestion` with options: "Approve", "Revise". If `AskUserQuestion` is
unavailable, print the summary and end the turn — wait for the user to respond
with `approve` or specific revision feedback.

**Branch on the gate result:**

**If result is `"approved"` (or user responds `approve` in interactive mode):** proceed to time-logging below, then Phase 2.

**If result is `{ status: "rejected", changes: "<feedback>" }` (gate=mcp) or user requests revisions (gate=interactive):**

1. Re-invoke sdd-expert-agent with the change request injected as additional context:

   ```
   Tool: Agent
   Parameters:
     prompt: |
       <paste the full contents of sdd-expert-agent.md as instructions>

       INPUT CONTEXT:
       {
         "scope": "<original clarified scope from 1a>",
         "specDir": "specs/<NNN>-<TICKET>-<slug>/",
         "service": "<service name and path>",
         "actors": ["<actors from 1a>"],
         "constraints": "<constraints from 1a>",
         "area": "<area>",
         "revisionRequest": "<changes value from gate result — pass verbatim>"
       }
     allowedTools:
       - Read
       - Edit
       - Write
       - Bash
   ```

2. Re-invoke architect-agent with the updated spec and the same change request:

   ```
   Tool: Agent
   Parameters:
     prompt: |
       <paste the full contents of architect-agent.md as instructions>

       INPUT CONTEXT:
       {
         "specDir": "specs/<NNN>-<TICKET>-<slug>/",
         "service": "<service name and path>",
         "area": "<area>",
         "specFiles": <updated specFiles array from sdd-expert result>,
         "revisionRequest": "<changes value from gate result — pass verbatim>"
       }
     allowedTools:
       - Read
       - Write
       - Bash
   ```

3. Re-issue the gate:
   - **If gate=mcp:** Call `mcp__bosch__gate_request` with the updated spec and plan payload.
   - **If gate=interactive:** Re-present the updated spec and plan via `AskUserQuestion` (or end-of-turn if unavailable).
   Repeat the reject-branch loop until the result is `"approved"` (or user approves).

**After the gate is approved**, log the requirement refinement work and record
the checkpoint timestamp before proceeding autonomously.

Calculate elapsed time since workflow start:

```bash
PHASE1_END=$(date +%s)
ELAPSED_SECONDS=$((PHASE1_END - WORKFLOW_START))
```

Convert `ELAPSED_SECONDS` to JIRA time format (e.g., `"1h 30m"`, `"45m"`,
`"2h"`). Round to the nearest 5 minutes. Use hours and minutes — do not
use seconds or days.

Delegate to the JIRA sub-agent to log the work:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "addWorklog",
      "ticketKey": "<ticketKey>",
      "timeSpent": "<elapsed time in JIRA format — e.g., 1h 30m>",
      "comment": "Requirement refinement work"
    }
  allowedTools:
    - mcp__atlassian__addWorklogToJiraIssue
```

Record the checkpoint timestamp for Phase 7:

```bash
CHECKPOINT=$(date +%s)
```


Once confirmed, execute Phases 2–7 autonomously without pausing.

**If gate=mcp:** Call `mcp__bosch__phase_complete` with `{ num: 1 }`.

Record Phase 1 spawn counts in the SPAWN_LOG context memo:

```
SPAWN_LOG:
  phase1: jira-agent×1, sdd-expert×1, architect×1
```

---

## Phase 2: Create branch

**If gate=mcp:** Call `mcp__bosch__phase_start` with `{ num: 2, title: "Create Branch" }`.


Use `ticketKey` from Phase 1. Derive a short kebab-case slug from the
ticket summary (3-5 words, no area prefix). Do not ask the user.

Branch naming follows `git.branchPattern` from config — by default
`{type}/{ticket}/{slug}` where `{type}` is one of `git.branchTypes`
(default `feature`, `bugfix`, `hotfix`) and `{ticket}` is the full
`<ticketKey>` (e.g., `<projectKey>-12345`).

Example with default config: `feature/<projectKey>-12345/short-description`

Delegate to the git sub-agent. Read the agent instructions from
`.claude/skills/feature-workflow/agents/git-agent.md`, then spawn
the agent:

**If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "git-agent", op: "create-branch" }`.

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of git-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "create-branch",
      "branchName": "feature/<projectKey>-XXXXX/short-description"
    }
  allowedTools:
    - Bash
```

**If gate=mcp:** Call `mcp__bosch__agent_complete` with `{ name: "git-agent" }`.

The agent will emit a JSON result block:

```json
{
  "action": "create-branch",
  "branch": "feature/<projectKey>-XXXXX/short-description"
}
```

**If gate=mcp:** Call `mcp__bosch__phase_complete` with `{ num: 2 }`.

Append to the SPAWN_LOG:
```
  phase2: git-agent×1
```

---

## Phase 3: Develop and test

**If gate=mcp:** Call `mcp__bosch__phase_start` with `{ num: 3, title: "Develop and Test" }`.


All implementation work is delegated to the implementation-agent. Read the
agent instructions from
`.claude/skills/feature-workflow/agents/implementation-agent.md` once and
reuse for all spawns in this phase.

### 3a. Baseline and checkpoint 1 — in parallel

**If gate=mcp:** Call `mcp__bosch__checkpoint_start` with `{ num: 0, title: "Baseline Verification" }`.

Launch both the baseline verification and checkpoint 1 simultaneously.
Send them in a **single message with two Agent tool calls**, both with
`run_in_background: true`:

**If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "implementation-agent", op: "baseline" }` before the baseline spawn.
**If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "implementation-agent", op: "checkpoint 1" }` before the checkpoint 1 spawn.

```
Tool: Agent  (run_in_background: true)
Parameters:
  prompt: |
    <paste the full contents of implementation-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "baseline",
      "service": "<repo name and path>",
      "area": "<BE | FE>"
    }
  allowedTools:
    - Read
    - Edit
    - Write
    - Bash
```

```
Tool: Agent  (run_in_background: true)
Parameters:
  prompt: |
    <paste the full contents of implementation-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "checkpoint",
      "executionPlanPath": "specs/<NNN>-<TICKET>-<slug>/execution-plan.md",
      "checkpointNumber": 1,
      "specDir": "specs/<NNN>-<TICKET>-<slug>/",
      "service": "<repo name and path>",
      "area": "<BE | FE>"
    }
  allowedTools:
    - Read
    - Edit
    - Write
    - Bash
```

After each completes: **if gate=mcp:** call `mcp__bosch__agent_complete` with `{ name: "implementation-agent" }`.

Wait for both to complete.

**If baseline fails (`passed: false`):** Stop the entire workflow
immediately. Tell the user the baseline is broken (compilation or boot
failure), include the `failureDetails` from the result, and ask them to
fix the issues before re-invoking the workflow. Any checkpoint 1 work
done in parallel is discarded — the branch can be deleted and recreated.
Do NOT proceed with further checkpoints.

**If baseline passes:** **if gate=mcp:** Call `mcp__bosch__checkpoint_complete` with `{ num: 0 }`.
Continue with checkpoint 1's result. If checkpoint 1
also completed successfully, **if gate=mcp:** call `mcp__bosch__checkpoint_complete` with `{ num: 1 }` and proceed to checkpoint 2. If checkpoint 1 hit a
blocker, present it to the user.

### 3b. Remaining checkpoints

For each remaining checkpoint (2 to N) in the execution plan:
1. **If gate=mcp:** Call `mcp__bosch__checkpoint_start` with `{ num: N, title: "<checkpoint title from plan>" }`.
2. **If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "implementation-agent", op: "checkpoint N" }`.
3. Spawn the implementation-agent sequentially:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of implementation-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "checkpoint",
      "executionPlanPath": "specs/<NNN>-<TICKET>-<slug>/execution-plan.md",
      "checkpointNumber": <N>,
      "specDir": "specs/<NNN>-<TICKET>-<slug>/",
      "service": "<repo name and path>",
      "area": "<BE | FE>"
    }
  allowedTools:
    - Read
    - Edit
    - Write
    - Bash
```

4. After it returns: **if gate=mcp:** call `mcp__bosch__agent_complete` with `{ name: "implementation-agent" }`.

**If `completed` is `false`:** the agent hit a blocker. Present the
`blocker` description to the user and **end the turn** — wait for the
user's guidance before retrying or proceeding (no further tool calls in
the same response; see "Halt mechanics").

**After each checkpoint completes successfully:** **if gate=mcp:** call `mcp__bosch__checkpoint_complete`
with `{ num: N }`.

**After each checkpoint:** aggregate `testsRun`, `testsPassed`, and
`liveTestResults` from the result into a cumulative test summary. This
summary is passed to the PR agent in Phase 6.

Only proceed to Phase 4 when **all checkpoints are complete** and every
scenario in the BDD spec is satisfied.

**If gate=mcp:** Call `mcp__bosch__phase_complete` with `{ num: 3 }`.

Append to the SPAWN_LOG with actual spawn counts:
```
  phase3: impl-agent×N (baseline×1, CP×<checkpoint_count>)
```
where N = 1 (baseline) + number of checkpoints completed.

**Note:** Test failures, lint failures, and build failures encountered during
implementation are **recoverable** — they stay inside the checkpoint iterate
loop and are fixed by the implementation-agent. They do NOT trigger the
top-level error handler and do NOT touch the Jira ticket status.

---

## Phase 4: Commit

**If gate=mcp:** Call `mcp__bosch__phase_start` with `{ num: 4, title: "Commit" }`.


One commit per branch. If multiple commits accumulated during Phase 3, squash
them first. The commit message must be prefixed with `ticketKey` from Phase 1.

All git operations in this phase are delegated to the git sub-agent. Read the
agent instructions from `.claude/skills/feature-workflow/agents/git-agent.md`
once and reuse for all spawns in this phase.

**Important:** The spec directory (`specs/<NNN>-[TODO: TICKET_PREFIX]-XXXXX-slug/`) is code and
must be included in the commit. Pass it as `specDir` to `stage-and-prepare`.

### 4a. Check commit count

Spawn the git-agent:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of git-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "count-commits"
    }
  allowedTools:
    - Bash
```

Extract `commitCount`:
- If **1 commit**: skip to Step 4c
- If **> 1 commits**: run the squash flow (Steps 4b then 4c)
- If **0 commits**: something went wrong in Phase 3 — check staging

### 4b. Squash (only if > 1 commit)

Spawn the git-agent with the `squash` action. The agent runs
`prepare-squash.sh`, creates a backup branch, and does a soft-reset to the
detected main branch. If the rebase encounters conflicts, the agent
reports an error — stop and tell the user to resolve manually.

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of git-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "squash"
    }
  allowedTools:
    - Bash
```

Extract `combinedDiff` and `backupBranch` from the result.

Use the `combinedDiff` to compose the commit message (Step 4c format), then
spawn the git-agent with the `commit` action (see 4c below).

After committing, verify the squash integrity by spawning the git-agent with
the `verify-squash` action:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of git-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "verify-squash",
      "backupBranch": "<backupBranch from squash result>"
    }
  allowedTools:
    - Bash
```

If `verified` is `false`, stop and tell the user. Include the recovery
command from the error result.

### 4c. Stage and commit

**Stage** — spawn the git-agent:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of git-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "stage-and-prepare",
      "specDir": "specs/<NNN>-[TODO: TICKET_PREFIX]-XXXXX-slug/"
    }
  allowedTools:
    - Bash
```

**Compose the commit message:**

```
<TICKET>: <message>

<description_block>
```

**Message line**: imperative mood, ≤50 chars after the ticket prefix.
**Description block**: explain why and what; wrap at 72 chars; group changes
under headings when the diff spans multiple areas.

**Commit** — spawn the git-agent:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of git-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "commit",
      "message": "<full commit message>"
    }
  allowedTools:
    - Bash
```

After committing, collect the final commit message (first line + body) — you
will pass this to the PR agent in Phase 6.

**If gate=mcp:** Call `mcp__bosch__phase_complete` with `{ num: 4 }`.

Append to the SPAWN_LOG with actual spawn counts:
```
  phase4: git-agent×<N>
```
where N is the actual number of git-agent spawns used for committing.

---

## Phase 5: Review

**If gate=mcp:** Call `mcp__bosch__phase_start` with `{ num: 5, title: "Review" }`.


Two automated review gates verify the implementation before creating the PR.
Both reviewers are read-only — they report findings, and the
implementation-agent applies fixes.

### 5a. Spec review

First, get the list of changed files:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of git-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "get-changed-files"
    }
  allowedTools:
    - Bash
```

Then spawn the spec-reviewer. Read agent instructions from
`.claude/skills/feature-workflow/agents/spec-reviewer.md`:

**If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "spec-reviewer", op: "verify BDD spec coverage" }`.

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of spec-reviewer.md as instructions>

    INPUT CONTEXT:
    {
      "specDir": "specs/<NNN>-<TICKET>-<slug>/",
      "service": "<repo name and path>",
      "changedFiles": <changedFiles array from git-agent>,
      "area": "<BE | FE>"
    }
  allowedTools:
    - Read
    - Bash
```

**If gate=mcp:** Call `mcp__bosch__agent_complete` with `{ name: "spec-reviewer" }`.

**If `passed` is `false`** (Critical findings):

1. Spawn the implementation-agent with `fix-findings`:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of implementation-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "fix-findings",
      "findings": <Critical + Major findings from spec-reviewer>,
      "reviewerType": "spec",
      "service": "<repo name and path>",
      "area": "<BE | FE>"
    }
  allowedTools:
    - Read
    - Edit
    - Write
    - Bash
```

2. Amend the commit:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of git-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "amend"
    }
  allowedTools:
    - Bash
```

3. Re-run the spec-reviewer to verify fixes resolved the Critical findings.

If still failing after one fix cycle, present the remaining findings to the
user and ask for guidance.

### 5b. Design review

**If gate=mcp:** Call `mcp__bosch__checkpoint_start` with `{ num: 52, title: "Design Review" }`.

Spawn the design-reviewer. Read agent instructions from
`.claude/skills/feature-workflow/agents/design-reviewer.md`:

**If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "design-reviewer", op: "verify code quality" }`.

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of design-reviewer.md as instructions>

    INPUT CONTEXT:
    {
      "service": "<repo name and path>",
      "changedFiles": <changedFiles array from git-agent>,
      "area": "<BE | FE>"
    }
  allowedTools:
    - Read
    - Bash
```

**If gate=mcp:** Call `mcp__bosch__agent_complete` with `{ name: "design-reviewer" }`.

**If `passed` is `false`** (Critical findings): follow the same
fix → amend → re-review loop as 5a, using `"reviewerType": "design"`.

**If gate=mcp:** Call `mcp__bosch__checkpoint_complete` with `{ num: 52 }`.

**If gate=mcp:** Call `mcp__bosch__phase_complete` with `{ num: 5 }`.

Append to the SPAWN_LOG with actual spawn counts:
```
  phase5: spec-reviewer×<N>, design-reviewer×<N>
```
where N is the actual number of spawns (0 if that reviewer was skipped).

---


## Phase 6: PR creation (GitHub)

**If gate=mcp:** Call `mcp__bosch__phase_start` with `{ num: 6, title: "PR Creation" }`.


### 6a. Validate and push

Spawn the git-agent to validate PR readiness and sync-and-push (same as ADO).

### 6b. Create the PR

Delegate to the GitHub PR sub-agent. Read the agent instructions from
`.claude/skills/feature-workflow/agents/pr-agent-github.md`:

**If gate=mcp:** Call `mcp__bosch__agent_start` with `{ name: "pr-agent-github", op: "create pull request" }`.

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of pr-agent-github.md as instructions>

    INPUT CONTEXT:
    {
      "ticketKey": "<projectKey>-XXXXX",
      "ticketUrl": "<tracker url>/browse/<projectKey>-XXXXX",
      "branch": "feature/<projectKey>-XXXXX/short-description",
      "commitMessage": "<first line of commit message>",
      "commitBody": "<commit message body>",
      "testSummary": "<X unit tests passed; live tested POST /api/v1/foo (200), GET /api/v1/bar (200)>",
      "diffStat": "<summary of changed files>"
    }
  allowedTools:
    - Bash
    - mcp__github__create_pull_request
    - mcp__github__update_pull_request
    - mcp__github__get_pull_request
    - mcp__github__list_workflow_runs
```

**If gate=mcp:** Call `mcp__bosch__agent_complete` with `{ name: "pr-agent-github" }`.

The agent will emit a JSON result block. Extract `prUrl` and tell the user.

**If gate=mcp:** Call `mcp__bosch__phase_complete` with `{ num: 6 }`.

Append to the SPAWN_LOG:
```
  phase6: pr-agent×1, git-agent×1
```
In workspace mode with multiple repos, use the actual PR and git-agent spawn counts.

---

## Phase 7: Finalize JIRA

**If gate=mcp:** Call `mcp__bosch__phase_start` with `{ num: 7, title: "Finalize JIRA" }`.

After the PR is created, finalize the JIRA ticket with work logging, cost
analysis, and status transition. All operations are delegated to the
jira-agent.

Read the agent instructions from
`.claude/skills/feature-workflow/agents/jira-agent.md` once and reuse for
all spawns in this phase.

### 7a. Log implementation work

Calculate elapsed time since the checkpoint recorded after Phase 1d:

```bash
IMPL_END=$(date +%s)
IMPL_SECONDS=$((IMPL_END - CHECKPOINT))
```

Convert to JIRA time format (round to nearest 5 minutes). Then log it:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "addWorklog",
      "ticketKey": "<ticketKey>",
      "timeSpent": "<implementation elapsed time in JIRA format>",
      "comment": "Implementation work"
    }
  allowedTools:
    - mcp__atlassian__addWorklogToJiraIssue
```

### 7b. Cost analysis comment

Compute the actual session cost autonomously and post it as a JIRA comment.

**Step 1:** Read the pricing reference:

```
Read: .claude/skills/feature-workflow/references/claude-pricing.md
```

**Step 2:** Run the JSONL cost script to compute the actual session cost:

```bash
python3 - <<'PYEOF'
import json, os

path = os.path.expanduser(os.environ.get('SESSION_JSONL_PATH', ''))

RATES = {
    'claude-sonnet-4-6': {'input': 3.00, 'cw5': 3.75, 'cw1h': 6.00, 'cr': 0.30, 'out': 15.00},
    'claude-haiku-4-5':  {'input': 1.00, 'cw5': 1.25, 'cw1h': 2.00, 'cr': 0.10, 'out': 5.00},
    'claude-opus-4-7':   {'input': 5.00, 'cw5': 6.25, 'cw1h': 10.00, 'cr': 0.50, 'out': 25.00},
}
DEFAULT = RATES['claude-sonnet-4-6']

if not path or not os.path.exists(path):
    print('ACTUAL_TOTAL=unavailable (session log not found)')
else:
    total = 0.0
    with open(path) as f:
        for line in f:
            try:
                e = json.loads(line.strip())
            except Exception:
                continue
            usage = e.get('usage') or {}
            if not usage:
                continue
            m = e.get('model', '')
            r = next((v for k, v in RATES.items() if k in m), DEFAULT)
            cc = e.get('cache_creation') or {}
            cost = (
                usage.get('input_tokens', 0) * r['input'] +
                (cc.get('ephemeral_5m_input_tokens', 0) if isinstance(cc, dict) else 0) * r['cw5'] +
                (cc.get('ephemeral_1h_input_tokens', 0) if isinstance(cc, dict) else 0) * r['cw1h'] +
                usage.get('cache_read_input_tokens', 0) * r['cr'] +
                usage.get('output_tokens', 0) * r['out']
            ) / 1_000_000
            total += cost
    print(f'ACTUAL_TOTAL=${total:.2f}')
PYEOF
```

Hold the printed `ACTUAL_TOTAL` value from the script output.

**Step 3:** Compute per-phase cost estimates and orchestrator remainder from the SPAWN_LOG:

For each phase (1–6), sum `spawns × mid-range profile cost` across all agents logged for that
phase using the agent profiles from `claude-pricing.md`. If a phase has no SPAWN_LOG entries,
its estimate is `$0.00`. Format all dollar values to two decimal places.

```
P1_COST = Σ(spawns × profile) for all phase-1 agents (or $0.00 if none)
P2_COST = Σ(spawns × profile) for all phase-2 agents (or $0.00 if none)
P3_COST = Σ(spawns × profile) for all phase-3 agents (or $0.00 if none)
P4_COST = Σ(spawns × profile) for all phase-4 agents (or $0.00 if none)
P5_COST = Σ(spawns × profile) for all phase-5 agents (or $0.00 if none)
P6_COST = Σ(spawns × profile) for all phase-6 agents (or $0.00 if none)
ORCH_COST = max(0, ACTUAL_TOTAL − (P1_COST + P2_COST + P3_COST + P4_COST + P5_COST + P6_COST))
```

If `Σ(P1..P6) > ACTUAL_TOTAL` (profiles overestimated), set `ORCH_COST = $0.00` and hold a flag
to append `(sub-agent profiles overestimated; orchestrator cost absorbed)` to the footnote.

Determine ticket batch context: `TICKET_N` (this ticket's 1-based index in the batch) and
`TICKET_TOTAL` (total tickets sharing this session). For a single-ticket run use `TICKET_N = 1`,
`TICKET_TOTAL = 1`. Compute `SHARE = ACTUAL_TOTAL / TICKET_TOTAL` (formatted to two decimal places).

**Step 4:** Compose the JIRA comment:

```markdown
## AI-Assisted Development — Cost Analysis

**Session total:** $<ACTUAL_TOTAL>
**This ticket's share:** $<SHARE> (<TICKET_N> of <TICKET_TOTAL>)

### Per-phase cost

- Phase 1 — Spec + Plan: $<P1_COST>
- Phase 2 — Branch: $<P2_COST>
- Phase 3 — Implement: $<P3_COST>
- Phase 4 — Commit: $<P4_COST>
- Phase 5 — Review: $<P5_COST>
- Phase 6 — PR: $<P6_COST>
- Orchestrator: $<ORCH_COST>

> Estimated from session token log. Phase 7 finalization not included.
```

(If ORCH_COST was clamped to $0.00, append ` (sub-agent profiles overestimated; orchestrator cost absorbed)` to the footnote.)

**Step 5:** Post the comment:

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "addComment",
      "ticketKey": "<ticketKey>",
      "commentBody": "<composed cost analysis comment>"
    }
  allowedTools:
    - mcp__atlassian__addCommentToJiraIssue
```

### 7c. Transition to success state

```
Tool: Agent
Parameters:
  prompt: |
    <paste the full contents of jira-agent.md as instructions>

    INPUT CONTEXT:
    {
      "action": "transition",
      "ticketKey": "<ticketKey>",
      "lifecycleState": "success"
    }
  allowedTools:
    - mcp__atlassian__getTransitionsForJiraIssue
    - mcp__atlassian__transitionJiraIssue
```

**If gate=mcp:** Call `mcp__bosch__phase_complete` with `{ num: 7 }`.

### Final report to user

After Phase 7 completes, tell the user:
- The PR URL
- The JIRA ticket URL (now in the success state)
- A brief summary of what was implemented
- Test results (from the test summary built in Phase 3)
- The actual session cost
- A reminder to request reviewers if needed


---

## Quick reference

| Phase | Who | Action | Gate |
|-------|-----|--------|------|
| 1-pre Ticket | **jira-agent** (Haiku) | Create or prepare ticket with AI labels | — |
| 1a Clarify | Main (Sonnet) | Ask targeted questions until fully understood | — |
| 1b Specify | **sdd-expert** (Sonnet) | Write BDD specs to `specs/<NNN>-[TODO: TICKET_PREFIX]-XXXXX-slug/` | Resolve openQuestions |
| 1c Plan | **architect** (Sonnet) | Write `execution-plan.md` with checkpoints and contracts | Acknowledge risks |
| 1d Review | Main (Sonnet) | Present spec + plan to user | **User confirms** ← only gate |
| 2 Branch | **git-agent** (Haiku) | `git checkout -b feature/<projectKey>-X/slug` | — |
| 3a Baseline + CP1 | **impl-agent** (Sonnet) ×2 | Compile+boot check ‖ first checkpoint (parallel) | Stop if baseline fails |
| 3b Checkpoints | **impl-agent** (Sonnet) | Remaining checkpoints sequentially | — |
| 4 Commit | **git-agent** (Haiku) | Squash → stage → commit | — |
| 5a Spec review | **spec-reviewer** (Sonnet) | Verify all BDD scenarios implemented + tested | Fix Critical findings |
| 5b Design review | **design-reviewer** (Sonnet) | Verify code quality against project rules | Fix Critical findings |
| 6 PR | **git-agent** (Haiku) + **pr-agent-github** (Sonnet) | Validate → sync → push → create GitHub PR | — |
| 7a Worklog | **jira-agent** (Haiku) | Log implementation time | — |
| 7b Cost | **jira-agent** (Haiku) | Post cost analysis + summary comment | — |
| 7c Transition | **jira-agent** (Haiku) | Move ticket to success state | — |

## What this is NOT

- Not for experiments or spikes — those just get coded, no ticket needed
- Not for quick fixes with no PR — commit directly without this workflow
- The ticket documents the **goal**, not the solution — implementation details
  belong in the commit message and PR description, written after the work

---

## Upgrade Path

Generated by claudboard-workflow on 2026-05-29 from template version v1.
To regenerate with updated templates, remove this directory and re-run `/claudboard-workflow`.
