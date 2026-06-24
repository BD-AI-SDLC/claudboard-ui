## Why

The Phase 1d spec+plan review gate currently shows the user a hallucinated summary of the spec and plan instead of the actual files written to disk. The orchestrator (Sonnet main agent) never has the spec or plan text in its context — `sdd-expert-agent` and `architect-agent` write files to disk but only return JSON metadata. The current SKILL prose asks the orchestrator to "Read the full text" before composing the gate payload, but the payload schema accepts free-text `spec` and `plan` fields, which the model fills by paraphrasing the 1a clarifying conversation. The result: the human approves something they didn't actually see, while the real spec and plan sit on disk untouched. This defeats the only human gate in the workflow.

## What Changes

- **BREAKING:** Replace the free-text `spec+plan` gate payload (`spec?: string`, `plan?: string`) with a path manifest (`workspaceRoot`, `specDir`, `specFiles[]`, `planPath`, `ticket`). No text escape hatch.
- The gate MCP handler reads the named files from disk at `gate_request` time, validates every path resolves under `workspaceRoot`, persists a content snapshot alongside the paths in the `gates` row, and emits paths + content + file stats (size, mtime) on the `gate-request` event.
- Add `GET /gates/:id/files/:idx` REST endpoint for live re-read so the UI can refresh from disk after the gate is open (drift detection groundwork).
- `ReviewGate` UI gains tabs for multi-file specs, a markdown renderer for the execution plan (replacing the placeholder checkpoint list), and a provenance header on each panel showing the file path, byte size, and last-modified time.
- The meas `feature-workflow` SKILL Phase 1d prose is rewritten to send the manifest instead of pasting file text. Documented as a coordinated downstream change in `tasks.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-driver`: Tighten the `spec+plan` gate payload schema; add server-side file read and snapshot persistence at gate-request time; add live-reread REST route.
- `web-ui`: `ReviewGate` renders authentic file content with per-file tabs, markdown plan rendering, and provenance metadata; placeholder fallbacks are removed.

## Impact

- **Protocol:** `protocol/src/types.ts` — `GatePayload` for `kind: 'spec+plan'` becomes a discriminated, required-fields shape. Breaking for any external caller of the gate MCP tool; the only known caller is the meas feature-workflow SKILL.
- **Server:** `server/src/gate/mcp-server.ts` reads files in the handler; `gates` row gains a snapshot column (or JSON extension); a new REST handler is added.
- **UI:** `ui/src/components/ReviewGate/ReviewGate.tsx` reshaped around real file content; placeholder constants removed.
- **External:** `meas/.claude/skills/feature-workflow/SKILL.md` Phase 1d prose rewritten. Not in this repo — landed as a coordinated edit, tracked in tasks.md.
- **Migration:** None for runtime data — open gates can be drained or cancelled before the schema change ships; closed gates are immutable history and unaffected by the new shape.
