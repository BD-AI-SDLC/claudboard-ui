## ADDED Requirements

### Requirement: Generated SKILL Phase 1a uses clarify_request, not inline conversation

The `feature-workflow/SKILL.md` template at `/Users/LUP1BG/Documents/claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template` SHALL describe Phase 1a (Clarify scope) as a loop of `mcp__bosch__clarify_request` tool calls, not as an inline conversation with the user. This is one specific application of a broader rule: **the orchestrator MUST use `mcp__bosch__clarify_request` as its only mechanism for asking the user something mid-run.** SKILL prose anywhere in the template MUST NOT instruct the orchestrator to print a question and rely on the next user turn arriving — that pattern silently terminates headless runs (the live stream shows the question, the orchestrator has no more work to do, the SDK iterator closes).

The Phase 1a-specific loop description is retained:

1. **Decide** whether the initial prompt already gives the orchestrator a complete picture. If yes, skip clarification entirely and proceed to Phase 1a-ws.
2. **Formulate** 1-5 targeted questions when scope is unclear. Questions should be specific, answerable in one or two sentences each, and ordered most-important-first.
3. **Call** `mcp__bosch__clarify_request({ questions: [...] })`. The run pauses until the user responds.
4. **Parse** the tool's return value (a JSON string). It is either `{"answers": ["…", …]}` (index-aligned with the input questions) or `{"skipped": true}`.
5. **On `{"skipped": true}`**: proceed with whatever scope can be inferred from the prompt alone; note the skip in the eventual spec+plan gate payload so the human can catch any gap at Phase 1d.
6. **On `{"answers": [...]}`**: integrate the answers into scope understanding. If the answers exposed a new ambiguity, formulate sharper follow-ups and call `clarify_request` again.
7. **Aim for ≤2 rounds in practice.** This is skill guidance, not a protocol limit.

The "Things worth clarifying" bullet list (which actors, edge cases, auth, validation, etc.) SHALL be retained as guidance for *what* to ask about.

The template SHALL include a clarifying comment near this section noting that answers arrive as the tool result — NOT as a fresh user turn in the conversation — and that the orchestrator must read `result.answers[i]` paired with `questions[i]` by index.

The template SHALL cross-reference the new general guidance section (per the `Generated SKILL uses clarify_request at every human-input site` requirement below) so future readers understand that Phase 1a is one application of a general rule, not an exclusive use case.

#### Scenario: Generated SKILL invokes clarify_request

- **WHEN** `/claudboard-workflow` is run in a fresh repo after the template edit
- **THEN** the generated `.claude/skills/feature-workflow/SKILL.md` contains at least one explicit reference to `mcp__bosch__clarify_request` in Phase 1a
- **AND** the prior text "Ask targeted questions until every aspect of the feature is understood" is no longer present

#### Scenario: Generated SKILL describes the skip path

- **WHEN** the generated SKILL is inspected
- **THEN** Phase 1a explicitly describes what to do when the tool returns `{"skipped": true}` (proceed with inferred scope; mention the skip in the Phase 1d gate payload)

#### Scenario: Soft cap is guidance, not enforcement

- **WHEN** the generated SKILL is inspected
- **THEN** Phase 1a recommends "≤2 rounds in practice" as guidance
- **AND** does NOT include a hard cap that prevents a third or later call

#### Scenario: Phase 1a section cross-references the general rule

- **WHEN** the generated SKILL is inspected
- **THEN** the Phase 1a section contains a cross-reference to the SKILL's top-level "Human input" subsection (or equivalent)
- **AND** does NOT describe `clarify_request` as exclusive to Phase 1a

### Requirement: Generated SKILL uses clarify_request at every human-input site

The `feature-workflow/SKILL.md` template SHALL contain a top-level "Human input" subsection (placed near the orchestration overview, before the per-phase sections) that establishes `mcp__bosch__clarify_request` as the workflow's only mechanism for the orchestrator to ask the user something mid-run. The subsection SHALL:

- State explicitly that SKILL prose MUST NOT instruct the orchestrator to print a question and wait for the next user turn — that pattern silently terminates runs driven through the headless `query()` iterator.
- Document the sub-agent relay pattern: a sub-agent that needs user input mid-execution returns `{ needsInput: { questions: string[], reason: string } }` as part of its JSON result block. The orchestrator detects this, calls `clarify_request` with the questions, then re-spawns the sub-agent with the answers appended to its INPUT CONTEXT (e.g. as a new `userAnswers: string[]` field index-aligned with the original questions).
- State that sub-agents themselves SHALL NOT call `clarify_request` directly. The orchestrator is the only caller.

The template SHALL be updated at the following four sites so the prose calls `clarify_request` instead of printing a prompt and stalling:

1. **Phase 1a-ws (Affected repos inference and confirmation).** Build a question string containing the inferred affected-repos list, justifications, and the legal answer forms (`confirm` / `add <repo>` / `remove <repo>`). Call `mcp__bosch__clarify_request({ questions: [<that string>] })`. Parse `result.answers[0]`:
   - case-insensitive `confirm` → hold the inferred list, proceed to 1b.
   - starts with `add ` → parse the repo name, add to `affectedRepos`, re-spawn the architect-agent with the adjusted list, loop back to a new `clarify_request` call.
   - starts with `remove ` → parse the repo name, remove from `affectedRepos`, re-spawn the architect-agent, loop.
   - `{"skipped": true}` → proceed with the inferred list as-is (treat as confirm).
2. **Phase 3 (Develop and test) — implementation-agent blocker.** When the implementation-agent returns `{ completed: false, blocker: "..." }`, build a question describing the blocker and call `clarify_request({ questions: ["<blocker>\n\nHow should I proceed? (retry / skip / abort / <custom>)"] })`. Parse the answer:
   - `retry` → re-spawn the implementation-agent on the same checkpoint.
   - `skip` → mark the checkpoint blocked, move to the next.
   - `abort` → halt the workflow via the non-recoverable failure path.
   - any other text → treat as custom guidance, pass to the implementation-agent in a follow-up spawn as additional INPUT CONTEXT.
3. **Phase 5a (Spec review) — escalation after one failed fix cycle.** Where the prior prose said "present the remaining findings to the user and ask for guidance," call `clarify_request({ questions: ["<remaining findings>\n\nHow should I proceed? (retry / accept-as-is / abort / <custom>)"] })`. Parse with the same scheme as the Phase 3 blocker.
4. **Phase 5b (Design review) — escalation after one failed fix cycle.** Same pattern as 5a.

The template's "Quick reference" table at the bottom SHALL reflect these uses (the "Gate" column for the affected phases now mentions `clarify_request`).

#### Scenario: Generated SKILL contains the Human input subsection

- **WHEN** `/claudboard-workflow` is run and the generated SKILL is inspected
- **THEN** the SKILL contains a "Human input" subsection at the top level (above per-phase sections)
- **AND** the subsection explicitly states that `clarify_request` is the only mechanism for the orchestrator to ask the user something

#### Scenario: Generated SKILL documents the sub-agent relay pattern

- **WHEN** the generated SKILL is inspected
- **THEN** the "Human input" subsection documents the `needsInput` field in sub-agent JSON result blocks
- **AND** describes the orchestrator's re-spawn behavior with `userAnswers` appended to INPUT CONTEXT
- **AND** states that sub-agents SHALL NOT call `clarify_request` directly

#### Scenario: Phase 1a-ws uses clarify_request

- **WHEN** the generated SKILL is inspected
- **THEN** the Phase 1a-ws section contains an explicit `mcp__bosch__clarify_request` call
- **AND** the section does NOT end with raw "Confirm or adjust?" prose followed by the next phase
- **AND** the parsing logic for `confirm` / `add <repo>` / `remove <repo>` is documented

#### Scenario: Phase 3 blocker handling uses clarify_request

- **WHEN** the generated SKILL is inspected
- **THEN** the Phase 3 section describing implementation-agent blockers contains an explicit `mcp__bosch__clarify_request` call
- **AND** the prior phrasing "present the blocker description to the user and wait for guidance" is no longer present

#### Scenario: Phase 5a and 5b escalations use clarify_request

- **WHEN** the generated SKILL is inspected
- **THEN** the Phase 5a section's "after one failed fix cycle" branch contains an explicit `mcp__bosch__clarify_request` call
- **AND** the Phase 5b section's "after one failed fix cycle" branch contains an explicit `mcp__bosch__clarify_request` call

#### Scenario: A run that hits Phase 1a-ws actually pauses

- **GIVEN** a fresh feature run against a multi-repo workspace with a prompt that triggers affected-repos inference
- **WHEN** the orchestrator reaches Phase 1a-ws and the architect-agent returns the inferred list
- **THEN** the orchestrator calls `mcp__bosch__clarify_request` with a question containing the list
- **AND** the run transitions to `paused-gate`
- **AND** the Active Run page renders the inline ClarifyComposer with the question
- **AND** typing `confirm` and pressing Enter resolves the gate and the run proceeds to Phase 1b
- **AND** the run does NOT terminate at Phase 1a-ws (as it did before this change)

### Requirement: SKILL guidance permits zero rounds when prompt is sufficient

The template SHALL explicitly state that zero rounds of clarification is a valid outcome when the initial prompt is unambiguous and complete. The orchestrator SHALL NOT call `clarify_request` purely as ceremony; the decision is contextual.

#### Scenario: Thorough prompt produces no clarify call

- **GIVEN** a user kicks off a run with a prompt that already specifies the workspace, actors, error cases, auth, and validation rules
- **WHEN** the orchestrator reaches Phase 1a
- **THEN** it MAY proceed directly to Phase 1a-ws without calling `mcp__bosch__clarify_request`
- **AND** the SKILL guidance explicitly permits this outcome

### Requirement: claudboard-workflow SKILL template emits typed MCP events

The SKILL template at `claude-repo-scan/skills/claudboard-workflow/references/SKILL.md.template` (and any included partials) SHALL be edited so that the generated `feature-workflow/SKILL.md` invokes the `bosch` MCP server's typed tools at every phase boundary, every checkpoint boundary, and every sub-agent invocation.

Specifically, the generated SKILL SHALL:
- Call `mcp__bosch__phase_start({ num, title })` immediately on entering each of the seven phases.
- Call `mcp__bosch__phase_complete({ num })` immediately on exiting each phase.
- Call `mcp__bosch__checkpoint_start({ num, title })` / `mcp__bosch__checkpoint_complete({ num })` around each checkpoint in Phase 3.
- Call `mcp__bosch__agent_start({ name, op })` / `mcp__bosch__agent_complete({ name })` around every `Agent` tool invocation.

#### Scenario: Generated SKILL contains phase tool calls

- **WHEN** `/claudboard-workflow` is run in a fresh repo after the template edit
- **THEN** the generated `.claude/skills/feature-workflow/SKILL.md` contains explicit references to `mcp__bosch__phase_start` and `mcp__bosch__phase_complete` for phases 1 through 7

#### Scenario: Generated SKILL wraps Agent calls

- **WHEN** the generated SKILL invokes the architect-agent
- **THEN** the SKILL prose instructs the orchestrator to call `mcp__bosch__agent_start({ name: "architect-agent", op: <op> })` before, and `mcp__bosch__agent_complete({ name: "architect-agent" })` after

### Requirement: Phase 1d uses gate_request instead of free-form approval

The template SHALL replace the Phase 1d "wait for user approval" prose with a single `mcp__bosch__gate_request` call carrying a structured payload of the BDD spec text, the architect plan, and the ticket reference. The SKILL SHALL branch on the tool's return value: `"approved"` proceeds to Phase 2; `{ status: "rejected", changes }` re-runs the sdd-expert and architect agents with the change requests injected.

#### Scenario: Generated SKILL replaces approval prose with gate_request

- **WHEN** `/claudboard-workflow` is re-run after the template edit
- **THEN** the generated SKILL's Phase 1d section calls `mcp__bosch__gate_request({ kind: "spec+plan", payload: { ticket, spec, plan } })` and does NOT contain the prior "ask the user to approve" prose

#### Scenario: Approved gate continues to Phase 2

- **WHEN** the web app resolves a gate with `"approved"` and the generated SKILL receives that result
- **THEN** the SKILL advances to Phase 2 (branch creation) without further user interaction

#### Scenario: Rejected gate re-runs gated agents

- **WHEN** the web app resolves a gate with `{ status: "rejected", changes: "Add empty-payload scenario" }`
- **THEN** the SKILL re-invokes sdd-expert-agent and architect-agent with the change request as additional context, then re-issues `gate_request` with the updated payload

### Requirement: Detect old generated SKILLs and refuse to drive them

The web app's `run-driver` SHALL detect whether a repo's `.claude/skills/feature-workflow/SKILL.md` was generated by the post-edit template by scanning for the presence of at least one `mcp__bosch__` tool reference. If absent, the driver SHALL reject kickoff for that repo and surface a "Re-generate feature-workflow" action in the Project screen.

#### Scenario: Repo with pre-edit SKILL is rejected

- **WHEN** the user attempts to kick off a feature in a repo whose feature-workflow SKILL contains no `mcp__bosch__` references
- **THEN** the kickoff is rejected with HTTP 409 and a message: "This repo's feature-workflow was generated with an older template. Re-run /claudboard-workflow to update."

#### Scenario: Project screen shows re-generate CTA

- **WHEN** the Project screen loads for a repo with an outdated SKILL
- **THEN** the prereq panel for `workflow` shows `state: "stale"` with a "Re-generate" button that POSTs `/api/prereqs/claudboard-workflow`
