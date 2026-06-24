## ADDED Requirements

### Requirement: InterviewPane question text renders a minimal subset of inline markdown

The `InterviewPane` component SHALL render the active question's `text` (and the agent bubble text for completed questions in the thread) through a minimal inline-markdown transformer that recognises:

1. `**bold**` — paired double-asterisks become `<strong>` elements.
2. `` `code` `` — paired backticks become `<code>` elements.

The transformer SHALL:

- Leave plain text untouched (no element wrapping, no whitespace changes).
- Treat unpaired delimiters (a single `*`, a single `` ` ``, or `**` with no closing `**`) as literal characters — no broken HTML, no swallowed content.
- Produce React element nodes only (no `dangerouslySetInnerHTML`, no HTML strings).
- Not recognise block-level markdown — headings, lists, blockquotes, links, and images SHALL render as literal text. Structure belongs in the `group`/`why`/`options` fields, not in `text`.

This rendering applies to:

- The active question card's question text (`.interview-pane__question-text`).
- The agent-side bubble text for already-answered questions in the thread.

It does NOT apply to the `group` chip, the `why` italic block, the `options` labels and descriptions, the user answer bubbles, or the textarea input — those render as plain text.

#### Scenario: Bold and code markers render as styled elements

- **GIVEN** an active question with `text = "Reply \`unknown\` if you don't know — we'll mark it as a **risk**."`
- **WHEN** the `InterviewPane` renders the active card
- **THEN** the question text DOM contains a `<code>` element with the text `unknown`
- **AND** the question text DOM contains a `<strong>` element with the text `risk`
- **AND** no literal `*`, `**`, or `` ` `` characters appear in the rendered question text

#### Scenario: Plain text questions render unchanged

- **GIVEN** an active question with `text = "Which workspace are we targeting?"`
- **WHEN** the `InterviewPane` renders the active card
- **THEN** the question text DOM contains the exact string `Which workspace are we targeting?`
- **AND** the DOM contains no `<strong>` or `<code>` children

#### Scenario: Unpaired delimiters render as literal characters

- **GIVEN** an active question with `text = "What is 2 * 3 in this context?"`
- **WHEN** the `InterviewPane` renders the active card
- **THEN** the rendered question text contains the literal character `*`
- **AND** the DOM contains no `<strong>` child

#### Scenario: Block markdown is not interpreted

- **GIVEN** an active question with `text = "# Heading line\n- bullet"`
- **WHEN** the `InterviewPane` renders the active card
- **THEN** the rendered question text contains the literal characters `#` and `-`
- **AND** the DOM contains no `<h1>`, `<ul>`, or `<li>` child

#### Scenario: Group chip text is not transformed

- **GIVEN** an active question with `group = "Constraints / **scope**"`
- **WHEN** the `InterviewPane` renders the active card
- **THEN** the group chip contains the literal characters `**` around the word `scope`
- **AND** the chip DOM contains no `<strong>` child
