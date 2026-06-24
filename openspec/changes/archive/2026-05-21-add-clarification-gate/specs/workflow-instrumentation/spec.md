## ADDED Requirements

### Requirement: Generated SKILL Phase 1a uses clarify_request, not inline conversation

The `feature-workflow/SKILL.md` template at `/Users/LUP1BG/Documents/claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template` SHALL describe Phase 1a (Clarify scope) as a loop of `mcp__bosch__clarify_request` tool calls, not as an inline conversation with the user. The prior prose "Ask targeted questions until every aspect of the feature is understood" SHALL be replaced with explicit instructions to:

1. **Decide** whether the initial prompt already gives the orchestrator a complete picture. If yes, skip clarification entirely and proceed to Phase 1a-ws.
2. **Formulate** 1-5 targeted questions when scope is unclear. Questions should be specific, answerable in one or two sentences each, and ordered most-important-first.
3. **Call** `mcp__bosch__clarify_request({ questions: [...] })`. The run pauses until the user responds.
4. **Parse** the tool's return value (a JSON string). It is either `{"answers": ["…", …]}` (index-aligned with the input questions) or `{"skipped": true}`.
5. **On `{"skipped": true}`**: proceed with whatever scope can be inferred from the prompt alone; note the skip in the eventual spec+plan gate payload so the human can catch any gap at Phase 1d.
6. **On `{"answers": [...]}`**: integrate the answers into scope understanding. If the answers exposed a new ambiguity (e.g. the answer to "Which actors?" introduces a new actor whose permissions are unclear), formulate sharper follow-ups and call `clarify_request` again.
7. **Aim for ≤2 rounds in practice.** This is skill guidance, not a protocol limit. The orchestrator decides when scope is sufficient.

The "Things worth clarifying" bullet list (which actors, edge cases, auth, validation, etc.) SHALL be retained as guidance for *what* to ask about, not as instructions to ask the user inline.

The template SHALL include a clarifying comment near the rewritten section noting that answers arrive as a tool result — NOT as a fresh user turn in the conversation — and that the orchestrator must read `result.answers[i]` paired with `questions[i]` by index.

#### Scenario: Generated SKILL invokes clarify_request

- **WHEN** `/claudboard-workflow` is run in a fresh repo after the template edit
- **THEN** the generated `.claude/skills/feature-workflow/SKILL.md` contains at least one explicit reference to `mcp__bosch__clarify_request`
- **AND** the prior text "Ask targeted questions until every aspect of the feature is understood" is no longer present

#### Scenario: Generated SKILL describes the skip path

- **WHEN** the generated SKILL is inspected
- **THEN** Phase 1a explicitly describes what to do when the tool returns `{"skipped": true}` (proceed with inferred scope; mention the skip in the Phase 1d gate payload)

#### Scenario: Soft cap is guidance, not enforcement

- **WHEN** the generated SKILL is inspected
- **THEN** Phase 1a recommends "≤2 rounds in practice" as guidance
- **AND** does NOT include a hard cap that prevents a third or later call (the orchestrator may still call `clarify_request` an arbitrary number of times if scope remains unclear)

### Requirement: SKILL guidance permits zero rounds when prompt is sufficient

The template SHALL explicitly state that zero rounds of clarification is a valid outcome when the initial prompt is unambiguous and complete. The orchestrator SHALL NOT call `clarify_request` purely as ceremony; the decision is contextual.

#### Scenario: Thorough prompt produces no clarify call

- **GIVEN** a user kicks off a run with a prompt that already specifies the workspace, actors, error cases, auth, and validation rules
- **WHEN** the orchestrator reaches Phase 1a
- **THEN** it MAY proceed directly to Phase 1a-ws without calling `mcp__bosch__clarify_request`
- **AND** the SKILL guidance explicitly permits this outcome
