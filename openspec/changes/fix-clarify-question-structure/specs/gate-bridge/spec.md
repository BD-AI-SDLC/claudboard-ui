## ADDED Requirements

### Requirement: clarify_request tool advertises structured-question field guidance to the agent

The `clarify_request` MCP tool SHALL expose per-field guidance for the structured `ClarifyQuestion` shape so the agent populates the fields the UI renders distinctly (`group`, `text`, `why`, `options`) instead of stuffing pseudo-headings or markdown into `text`.

Specifically:

1. The tool's top-level description SHALL include a short worked example showing one structured question that uses `group`, `text`, and `why` as separate fields.
2. The `ClarifyQuestion` Zod schema SHALL attach a `.describe()` string to each of `text`, `group`, `why`, and `options` (and to `ClarifyQuestionOption.label` and `.description`) so each field's purpose appears in the JSON schema view the agent sees.
3. The `text` field description SHALL explicitly state that `text` is one plain-text question with no markdown formatting, no embedded headings, and no inline code spans — those concerns belong in the structured fields or in separate question entries.
4. The `group` field description SHALL explain that `group` is a short category label (rendered as a chip), not a full sentence.
5. The `why` field description SHALL explain that `why` is the explanatory aside ("why we are asking this") shown beneath the question, not part of the question itself.
6. The `options` field description SHALL explain that `options` turns the question into a multiple-choice selector; omit it for free-text answers.

The wire payload, persisted gate row format, and runtime behaviour of `clarify_request` SHALL be unchanged. This requirement governs only the schema descriptions and tool description surfaced to the agent.

#### Scenario: Tool description includes a structured-question example

- **GIVEN** the in-process `bosch` MCP server is constructed
- **WHEN** the registered `clarify_request` tool's description string is read
- **THEN** the description contains the words `group`, `text`, and `why` and shows them used together in an example object
- **AND** the description states that `text` must be plain text without markdown

#### Scenario: ClarifyQuestion schema exposes field-level descriptions

- **GIVEN** the `ClarifyQuestionSchema` exported from `protocol/src/mcp-schemas.ts`
- **WHEN** the schema is serialised to JSON Schema (e.g. via Zod's `.describe()` introspection)
- **THEN** every property — `text`, `group`, `why`, `options` — has a non-empty `description`
- **AND** the `text` description explicitly forbids markdown
- **AND** the `group` description identifies it as a short category label
- **AND** the `why` description identifies it as the explanatory aside

#### Scenario: Existing string-form questions remain accepted

- **GIVEN** the updated `ClarifyRequestSchema`
- **WHEN** the SKILL invokes `mcp__bosch__clarify_request({ questions: ["Which workspace are we targeting?"] })`
- **THEN** the call validates and a gate row is inserted with the question stored as-is
- **AND** the runtime behaviour matches the existing `clarify_request MCP tool pauses the run and awaits a clarification resolution` requirement
