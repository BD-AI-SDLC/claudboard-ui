## Context

The `clarify_request` MCP tool exposes a `ClarifyQuestion` shape with structured fields (`group`, `text`, `why`, `options`) that the `InterviewPane` already renders distinctly: `group` as a violet chip, `why` as italic explanatory text, `options` as radio choices. In practice the agent ignores those fields and dumps a markdown blob into `text` — including pseudo-headings (`**Dimension 3 — …**`) and inline code (`` `unknown` ``). Two compounding faults make this look broken on screen:

1. **Producer side**: the agent has no signal that `group`/`why`/`options` exist for a reason. The MCP tool description at `server/src/gate/mcp-server.ts:220` is one sentence ("Ask the human clarifying questions before writing a spec…"), and the Zod fields in `protocol/src/mcp-schemas.ts:57` have no `.describe()` calls — so the JSON schema the agent sees is `{ text: string, group?: string, why?: string, options?: [...] }` with no hint about purpose.
2. **Renderer side**: `InterviewPane.tsx:146` renders `{q.text}` as a React text node — no markdown parser. The CSS on `.interview-pane__question-text` already applies `font-weight: 600` and `font-size: var(--fs-lg)`, so any text in there looks heading-styled. When the agent stuffs markdown in, the asterisks survive verbatim on top of an already-bold block.

## Goals / Non-Goals

**Goals:**
- Give the agent enough schema signal that it stops jamming pseudo-headings into `text` and instead uses `group` for the category, `text` for one focused question, and `why` for the explanatory aside.
- Make the UI robust to stray inline markdown (`**bold**`, `` `code` ``) in `text` so future agent drift does not surface raw symbols to the user.
- Keep the wire protocol and persisted gate payloads unchanged.

**Non-Goals:**
- Full markdown rendering in `text` (no headings, no lists, no links). Structure belongs in the structured fields, not in `text`.
- Reformatting historical gate payloads in the DB.
- Changing how the agent decides *what* to ask. Only how it shapes the resulting payload.
- Updating the existing `gate-bridge` spec's mention of `{ questions: string[] }` to the union shape — that drift is from an earlier change and is out of scope here.

## Decisions

### Decision 1: Add `.describe()` to schema fields rather than only editing the tool description

The Claude Agent SDK surfaces Zod schemas to the model as JSON schemas with per-field `description` properties when `.describe()` is present. Field-level descriptions sit right next to the field name in the schema view the model gets — much harder to ignore than a one-paragraph blob in the tool description.

Both signals will be added (description block on the tool *and* `.describe()` on each field) because they target different parts of the model's attention: the tool-level description sets the overall convention ("each question is one focused ask; use `group` for the section header"), while field descriptions reinforce on each field individually.

**Alternative considered**: only update the tool description. Rejected because field descriptions are the standard idiomatic way to convey field intent in Zod-based MCP tools, and they survive being mentally summarised away when the model is busy.

### Decision 2: Minimal inline markdown transformer, not a markdown library

A full library (`marked`, `react-markdown`) would invite the agent to use any markdown — headings, lists, links — which defeats the structural goal. A handwritten transformer for just `**bold**` and `` `code` `` (a few lines of regex producing React nodes) preserves the constraint while making strays look right.

Risk: regex-based transforms can mishandle nested or unmatched delimiters. Mitigation: the transformer treats unmatched delimiters as literal characters and never produces HTML strings — it returns React `<strong>` / `<code>` elements, so there is no path to HTML injection regardless of the input.

**Alternative considered**: render via `dangerouslySetInnerHTML` after sanitisation. Rejected — adds a sanitiser dependency and an HTML-injection surface for a problem that two regex passes can solve safely.

### Decision 3: Specs deltas for both `gate-bridge` and `web-ui`

The agent-facing schema guidance is a behavioural contract worth pinning in `gate-bridge` (the capability that owns the MCP tool surface). The inline-markdown rendering is a UI behaviour worth pinning in `web-ui` so a future refactor cannot silently regress to rendering `**` literally.

## Risks / Trade-offs

- **[Risk] Field descriptions might not be enough to change agent behaviour** → Mitigation: also add the tool-level description with a worked example; if the agent still drifts after this lands, follow up with prompt-side guidance in the SKILL itself.
- **[Risk] Inline markdown might collide with question text that legitimately contains asterisks or backticks** → Mitigation: the regex requires paired delimiters; an isolated `*` or `` ` `` is left as a literal character. Test cases cover this.
- **[Risk] Existing change `conversation-pane-interview` may still be in flight and overlap** → Mitigation: that change introduced the structured `ClarifyQuestion` shape and the `InterviewPane`; this change builds on its types without rewriting them, so the two are additive. If `conversation-pane-interview` lands first (likely), this change applies cleanly on top.
