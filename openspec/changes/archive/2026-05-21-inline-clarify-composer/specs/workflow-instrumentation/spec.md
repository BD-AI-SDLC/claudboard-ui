## MODIFIED Requirements

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

## ADDED Requirements

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
