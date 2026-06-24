## Why

Interview questions in Phase 1 render with raw markdown showing through (literal `**` and `` ` ``) while the whole question block already looks heading-styled by CSS. Root cause: the agent stuffs a markdown blob into `ClarifyQuestion.text` instead of using the existing structured fields (`group`, `why`, `options`). The agent does this because the `clarify_request` MCP tool has a one-line description and the Zod schema fields carry no `.describe()` calls — so the agent sees bare optional fields with no purpose and falls back to formatting everything as freeform text.

## What Changes

- Expand the `clarify_request` MCP tool description in `server/src/gate/mcp-server.ts` with a short example that shows a structured question using `group`, `text`, and `why`.
- Add `.describe()` calls to `ClarifyQuestionSchema` fields in `protocol/src/mcp-schemas.ts` so the agent sees per-field guidance in the tool's JSON schema (what `group` means, when to use `why`, when `options` should be supplied, that `text` is a single plain-text question with no markdown).
- Render `q.text` in `InterviewPane.tsx` through a minimal inline transformer for `**bold**` and `` `code` `` as defense-in-depth, so any future strays display correctly instead of as raw symbols.
- Add a unit test for the inline-markdown transformer (renders bold and code spans, leaves plain text untouched, does not introduce HTML injection).

No breaking changes: schema shape, payload wire format, and existing string-question support are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gate-bridge`: The `clarify_request` tool's input schema and description gain explicit guidance for the structured-question shape (`group`/`text`/`why`/`options`) so the agent populates the fields the UI expects.
- `web-ui`: The `InterviewPane` active-question text renders a minimal subset of inline markdown (`**bold**`, `` `code` ``) so stray formatting characters do not appear as raw symbols.

## Impact

- **Code**: `server/src/gate/mcp-server.ts` (tool description), `protocol/src/mcp-schemas.ts` (schema `.describe()` calls), `ui/src/components/InterviewPane/InterviewPane.tsx` (inline markdown render), `ui/src/components/InterviewPane/InterviewPane.test.tsx` (new test).
- **APIs**: Tool description and per-field schema descriptions are surfaced to the agent via the Claude Agent SDK's MCP tool schema. No wire-protocol changes.
- **Dependencies**: None — the inline transformer is a few lines of regex; no new packages.
- **Behaviour**: Agents on future runs will produce better-structured questions. Existing runs in the DB are unaffected (their persisted gate payloads are unchanged).
