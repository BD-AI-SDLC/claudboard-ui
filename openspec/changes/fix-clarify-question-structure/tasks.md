## 1. Producer-side: schema and tool-description guidance

- [x] 1.1 Add `.describe(...)` to every field of `ClarifyQuestionSchema` in `protocol/src/mcp-schemas.ts` (`text`, `group`, `why`, `options`) plus `ClarifyQuestionOptionSchema` (`label`, `description`). The `text` description must explicitly forbid markdown, embedded headings, and inline code.
- [x] 1.2 Rewrite the `clarify_request` tool description in `server/src/gate/mcp-server.ts` (currently one line at ~line 220) to a short paragraph that includes a worked example of a structured question using `group`, `text`, and `why` together, and states that each question should be one focused ask.
- [x] 1.3 Rebuild the protocol package so the updated schema descriptions are picked up by the server (`pnpm -r build` or equivalent).

## 2. Renderer-side: minimal inline markdown in InterviewPane

- [x] 2.1 Add a small `renderInlineMarkdown(text: string): ReactNode` helper in `ui/src/components/InterviewPane/InterviewPane.tsx` (or a co-located helper file) that converts paired `**bold**` to `<strong>` and paired `` `code` `` to `<code>`, leaves plain text alone, and treats unpaired delimiters as literal characters. Must return React nodes — no `dangerouslySetInnerHTML`.
- [x] 2.2 Apply `renderInlineMarkdown` to the active card's `.interview-pane__question-text` content (replace `{q.text}` at `InterviewPane.tsx:146`).
- [x] 2.3 Apply `renderInlineMarkdown` to the agent bubble text for completed thread entries (replace `{pq.text}` at `InterviewPane.tsx:132`).
- [x] 2.4 Leave the `group` chip, `why` block, `options` labels/descriptions, user answer bubble, and textarea unchanged — they continue to render as plain text.

## 3. Tests

- [x] 3.1 Add unit tests for `renderInlineMarkdown` in `ui/src/components/InterviewPane/InterviewPane.test.tsx` covering: paired `**bold**` produces `<strong>`, paired `` `code` `` produces `<code>`, plain text is untouched, single `*` is literal, lone `**` is literal, unmatched `` ` `` is literal, mixed content (text + bold + code) renders in order, no HTML injection from a string like `"<script>"`.
- [x] 3.2 Add a render test that the `InterviewPane` active card uses `renderInlineMarkdown` for the question text (asserts the DOM contains `<strong>` / `<code>` when present).
- [x] 3.3 Add a render test that the `group` chip does NOT use `renderInlineMarkdown` (passes a `group` containing `**foo**` and asserts the chip renders literal `**` characters with no `<strong>` child).
- [x] 3.4 Add a unit test (or schema-introspection test) asserting that the JSON schema produced from `ClarifyQuestionSchema` has non-empty `description` strings on every property, and that the `text` description contains a forbidding word like `markdown`, `plain`, or `no formatting`.

## 4. Verify end-to-end

- [x] 4.1 Run the full test suite (`pnpm test` or equivalent) and ensure everything passes.
- [ ] 4.2 Start the dev server, launch a Phase-1 run that triggers `clarify_request`, and confirm the agent now populates `group`/`text`/`why` separately and the InterviewPane renders them in their distinct slots (chip, plain question, italic aside) — no literal `**` or backticks visible.
- [ ] 4.3 Manually verify the defense-in-depth path by submitting a synthetic gate payload with `**bold**` and `` `code` `` in `text` (via direct API call or a stubbed run) and confirming the rendered DOM has `<strong>` and `<code>` elements instead of literal symbols.
