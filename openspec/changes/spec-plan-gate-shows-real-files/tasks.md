## 1. Protocol — payload schema

- [x] 1.1 Add a discriminated union for `GatePayload` in `protocol/src/types.ts`: `kind: 'spec+plan'` → `{ ticket, workspaceRoot, specDir, specFiles[], planPath }` (all required, `specFiles` non-empty); `kind: 'clarify'` keeps the existing `{ questions }` shape.
- [x] 1.2 Remove the loose `spec?: string` / `plan?: string` fields and the `[key: string]: unknown` escape hatch from `GatePayload`.
- [x] 1.3 Add types for the snapshot delivered by the server on the `gate-request` event: per-file `{ path, content, size, mtime, drifted? }`, plus the top-level path manifest.
- [x] 1.4 Add types for the `GET /gates/:id/files/:idx` REST response (content + size + mtime + drifted + snapshotMtime).
- [x] 1.5 Build `protocol/` and confirm consumers in `server/` and `ui/` still typecheck against the new shape (expect breakages — they will be fixed in groups 2 and 4).

## 2. Server — gate MCP handler

- [x] 2.1 In `server/src/gate/mcp-server.ts`, add a Zod schema for the new `spec+plan` payload (matches Decision: path manifest, non-empty `specFiles`).
- [x] 2.2 Add a `resolveUnderWorkspace(workspaceRoot, relPath)` helper that uses `fs.realpath` on both sides and rejects any result not strictly under the realpath of `workspaceRoot`. Unit-test the path-traversal cases (`../`, absolute path, symlink-to-outside).
- [x] 2.3 In the `gate_request` handler for `kind: 'spec+plan'`: validate the manifest, resolve all paths, read each file (UTF-8), enforce a per-file size cap (default 1 MB, configurable env var), and assemble the snapshot.
- [x] 2.4 On any read failure, missing file, traversal, or oversize: throw a tool-level error before any DB insert or event emit. Confirm via test that no row is inserted and no event is broadcast.
- [x] 2.5 Extend the `gates` SQLite table with a `snapshot` JSON column (additive — older code ignores it). Add the migration in whichever spot the existing schema lives.
- [x] 2.6 Persist `{ payload, snapshot }` in the gate row on success. Include path manifest + per-file content + size + mtime in the `gate-request` event payload.
- [x] 2.7 Keep the `clarify` branch of `gate_request` untouched.

## 3. Server — live re-read REST route

- [x] 3.1 Add `GET /gates/:gateId/files/:fileIndex` route (sibling to existing gate resolution routes).
- [x] 3.2 Load the gate row; reject 404 if `:gateId` not found or its kind is not `spec+plan`.
- [x] 3.3 Resolve `:fileIndex`: integer `0..specFiles.length-1` addresses spec files, literal `"plan"` addresses the plan. Out-of-range → 404.
- [x] 3.4 Re-resolve the file's path against the stored `workspaceRoot` using the same traversal guard (defence in depth). Read current disk content; compute drift by comparing content bytes to the snapshot.
- [x] 3.5 Return `{ path, content, size, mtime, drifted, snapshotMtime }`. Do NOT mutate the snapshot in the gate row.
- [x] 3.6 Add route tests: matches snapshot → `drifted: false`; on-disk edit → `drifted: true`; out-of-range index → 404; non-spec+plan gate → 404.

## 4. UI — ReviewGate reshape

- [x] 4.1 In `ui/src/components/ReviewGate/ReviewGate.tsx`, update props to accept the new snapshot shape: `specFiles: { path, content, size, mtime }[]`, `plan: { path, content, size, mtime } | null`.
- [x] 4.2 Remove `PLACEHOLDER_SPEC` and `PLACEHOLDER_PLAN` and every fallback path that references them.
- [x] 4.3 Add a tab strip for `specFiles`. Tab label = file basename. Selected tab body renders through the existing Gherkin highlighter.
- [x] 4.4 Replace the structured `PlanCheckpoint[]` renderer with a markdown renderer fed by `plan.content`. Pick the existing markdown component used elsewhere in the UI if one exists; otherwise add `react-markdown` to `ui/package.json`.
- [x] 4.5 Add a provenance header to each panel showing relative path, byte size (human-readable: `1.2 KB`), and mtime (relative + tooltip with absolute ISO).
- [x] 4.6 Add a refresh control on each panel that calls `GET /gates/:id/files/:idx` and replaces the panel content with the live response. When `drifted` is true, show a banner with "Showing snapshot · click to load current" / "Showing current · click to load snapshot."
- [x] 4.7 Empty-state message when `specFiles.length === 0` or `plan === null` (per the spec — no placeholder text).
- [x] 4.8 Update `ReviewGate.css` for the tab strip, provenance header, drift banner.
- [x] 4.9 Wire the new payload shape from `ActiveRun.tsx` (or wherever ReviewGate is invoked) — `gate-request` event payload now carries the snapshot directly.

## 5. Tests

- [x] 5.1 Update `server/src/gate/__tests__/routes.test.ts` for the new payload shape: happy path, validation errors, traversal rejection, missing file, oversize file.
- [x] 5.2 Add tests for the new `/gates/:id/files/:idx` route (covered in 3.6 — close that loop here if not done inline).
- [x] 5.3 Update `server/src/__tests__/integration.test.ts` to use the new payload shape end-to-end.
- [x] 5.4 Update `server/src/run/__tests__/pause-resume.test.ts` if it constructs a `spec+plan` payload directly.
- [x] 5.5 Add a UI test for `ReviewGate` covering: multi-file tabs render, plan markdown renders, provenance header shows path/size/mtime, drift banner appears when API reports drift, empty state.
- [ ] 5.6 Manual smoke test: start the dev server, fire a synthetic `spec+plan` gate request via a small script that passes real meas spec paths, open the UI, verify the actual file content renders and tabs switch.

## 6. Coordinated downstream — meas SKILL

- [~] 6.1 SKIPPED. Investigated `craftsphere.cloud/.claude/skills/feature-workflow/SKILL.md` (only `feature-workflow/SKILL.md` on disk; no `meas` directory exists). Phase 1d is at line 406 and contains no `gate_request` invocation, no `<full text…>` placeholder, and no bosch MCP reference — the SKILL has never been wired to the bosch gate. There is nothing to "replace." Confirmed with user 2026-05-21.
- [~] 6.2 SKIPPED. Quick Reference table (line 1095+) describes 1d as "Present spec + plan to user → User confirms" with no payload. No edit applies. Confirmed with user 2026-05-21.
- [~] 6.3 SKIPPED. No SKILL edit shipping — coordination constraint moot. Note recorded in CHANGELOG.md: until a consumer SKILL is wired to emit the new manifest, Phase 1d will not surface a gate to the UI.

## 7. Cutover

- [ ] 7.1 Before merging, drain or cancel any `paused-gate` runs in any active bosch instance (these will fail validation against the new schema).
- [x] 7.2 Update `CHANGELOG.md` noting the breaking payload change and pointing to the meas SKILL edit as a paired update.
- [ ] 7.3 After merging both repos, run a smoke `start feature` flow through to Phase 1d in meas and verify the gate displays real spec + plan content in the UI.
