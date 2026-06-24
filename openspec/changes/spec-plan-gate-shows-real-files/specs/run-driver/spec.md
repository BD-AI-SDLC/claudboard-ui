## ADDED Requirements

### Requirement: spec+plan gate payload is a path manifest, not free text

The `mcp__bosch__gate_request` MCP tool, when invoked with `kind: 'spec+plan'`, SHALL accept a payload of exactly the shape `{ ticket: string, workspaceRoot: string, specDir: string, specFiles: string[], planPath: string }`. The schema SHALL NOT accept any free-text `spec` or `plan` field on this kind. Requests with the legacy text-payload shape SHALL be rejected with a validation error before any side effects occur (no row inserted, no event emitted, no deferred created).

`specDir` is interpreted relative to `workspaceRoot`. Each entry in `specFiles` is interpreted relative to `specDir`. `planPath` is interpreted relative to `workspaceRoot`. `specFiles` SHALL contain at least one entry.

#### Scenario: New manifest payload is accepted and validated

- **GIVEN** a run is paused at Phase 1d with `workspaceRoot = "/work/meas"`, `specDir = "specs/001-FOO-1-bar"`, `specFiles = ["business-behavior-spec.md", "authorization-spec.md"]`, `planPath = "specs/001-FOO-1-bar/execution-plan.md"`, all of which exist on disk
- **WHEN** the orchestrator calls `mcp__bosch__gate_request({ kind: 'spec+plan', payload: { ticket: 'FOO-1', workspaceRoot, specDir, specFiles, planPath } })`
- **THEN** the tool accepts the payload, creates the gate row, and suspends until the gate is resolved

#### Scenario: Legacy free-text payload is rejected

- **GIVEN** the bosch MCP server is running
- **WHEN** an `mcp__bosch__gate_request({ kind: 'spec+plan', payload: { spec: "feature: foo …", plan: "step 1 …" } })` call arrives
- **THEN** the tool returns a validation error
- **AND** no `gates` row is inserted
- **AND** no `gate-request` event is emitted
- **AND** no `paused-gate` status change is recorded

#### Scenario: Empty specFiles is rejected

- **GIVEN** a payload with `specFiles: []`
- **WHEN** `gate_request` is invoked
- **THEN** the tool returns a validation error and creates no gate row

### Requirement: spec+plan gate reads files from disk at request time

When `mcp__bosch__gate_request` is invoked with `kind: 'spec+plan'`, the server SHALL read every file named in the payload manifest from disk before suspending the run, and SHALL persist the resulting content snapshot in the `gates` row alongside the original payload. The persisted snapshot SHALL include, for each file, the resolved absolute path, the UTF-8 file contents, the byte size, and the last-modified timestamp.

The `gate-request` WebSocket event for this kind SHALL carry both the path manifest and the per-file content + metadata, so the UI can render without an additional fetch round-trip.

#### Scenario: Snapshot is written when the gate opens

- **GIVEN** a payload referencing two spec files (4 KB and 2 KB) and one plan file (8 KB), all readable from disk
- **WHEN** `gate_request` is invoked
- **THEN** the `gates` row contains a snapshot of all three files with their absolute paths, full contents, byte sizes, and mtimes
- **AND** the emitted `gate-request` event payload includes the same per-file content and metadata

#### Scenario: Missing file aborts the request

- **GIVEN** a payload where `specFiles[1]` resolves to a path that does not exist on disk
- **WHEN** `gate_request` is invoked
- **THEN** the tool returns a tool-level error citing the missing file
- **AND** no `gates` row is inserted
- **AND** no `gate-request` event is emitted
- **AND** the partial snapshot (the file that did read successfully) is discarded

#### Scenario: File larger than configured cap aborts the request

- **GIVEN** the per-file size cap is configured to 1 MB
- **AND** the resolved `planPath` is a 5 MB file on disk
- **WHEN** `gate_request` is invoked
- **THEN** the tool returns a tool-level error citing the size cap and the offending path
- **AND** no `gates` row is inserted and no `gate-request` event is emitted

### Requirement: spec+plan gate paths are confined to workspaceRoot

The server SHALL resolve every path referenced by a `spec+plan` payload (the `specDir`, each entry in `specFiles`, and `planPath`) against `workspaceRoot` using filesystem realpath semantics (following symlinks). Every resolved path MUST be a descendant of the resolved `workspaceRoot`. Any request where any resolved path escapes `workspaceRoot` SHALL be rejected with a tool-level error before any file is read.

#### Scenario: Path traversal in specDir is rejected

- **GIVEN** a payload with `workspaceRoot = "/work/meas"` and `specDir = "../../etc"`
- **WHEN** `gate_request` is invoked
- **THEN** the tool returns a tool-level error identifying the path-traversal attempt
- **AND** no `/etc` contents are read, persisted, or emitted

#### Scenario: Symlink that points outside workspaceRoot is rejected

- **GIVEN** a payload where `specFiles[0]` resolves to a symlink pointing at `/etc/passwd`
- **WHEN** `gate_request` is invoked
- **THEN** the tool returns a tool-level error and reads nothing

### Requirement: spec+plan gate supports live re-read after opening

The server SHALL expose `GET /gates/:gateId/files/:fileIndex` returning the current on-disk content for the addressed file in a `spec+plan` gate, along with its current byte size and last-modified timestamp. The response SHALL also indicate whether the live content differs from the snapshot captured at gate-open (a boolean `drifted` flag and the snapshot's mtime).

The endpoint SHALL only serve files that were part of the gate's original manifest. `:fileIndex` 0..N-1 addresses the spec files in declared order; the plan is addressed by `:fileIndex = "plan"`.

The snapshot persisted at gate-open SHALL NOT be mutated by live re-reads.

#### Scenario: Live re-read returns current disk content

- **GIVEN** a gate was opened with `specFiles[0]` containing "version A" text on disk
- **AND** that file is subsequently edited on disk to contain "version B"
- **WHEN** `GET /gates/<gateId>/files/0` is called
- **THEN** the response body contains "version B"
- **AND** `drifted` is `true`
- **AND** the snapshot stored in the gate row still contains "version A"

#### Scenario: Live re-read returns drifted=false when content is unchanged

- **GIVEN** a gate was opened with `specFiles[0]` containing some text on disk
- **AND** the file has not been modified since gate-open
- **WHEN** `GET /gates/<gateId>/files/0` is called
- **THEN** the response body matches the snapshot
- **AND** `drifted` is `false`

#### Scenario: Out-of-range fileIndex returns 404

- **GIVEN** a gate with `specFiles.length === 2`
- **WHEN** `GET /gates/<gateId>/files/5` is called
- **THEN** the server responds 404

#### Scenario: Plan file is addressable by index "plan"

- **GIVEN** a gate was opened with a `planPath` pointing at a readable file
- **WHEN** `GET /gates/<gateId>/files/plan` is called
- **THEN** the response body contains the current on-disk plan content
- **AND** `drifted` reflects whether it differs from the snapshot
