---
name: ws-event
description: >
  Add a new WebSocket event type to the bosch-sdlc protocol and wire it through
  server and UI. Covers the protocol discriminated union, optional MCP tool registration,
  and UI event handler. Use this skill whenever the user asks to add a WebSocket event,
  add a new event type, emit a new event from the server, broadcast a new message kind,
  add a WS notification, or handle a new event in the UI. Also triggers when the user
  says "the skill should emit X", "track X over the wire", "add event for X",
  or "broadcast X to the UI".
---

# Add WebSocket Event Type

## Architecture

The WebSocket event system is protocol-driven. Every event kind is defined in
`protocol/src/events.ts` as a discriminated union member. The server emits events
via `broadcast(runId, event)` in `ws-server.ts`. The UI receives events in
`useRunStream` and routes them to components.

```
protocol/src/
├── events.ts         ← 1. Add WsEventKind literal, interface, union member
├── mcp-schemas.ts    ← 2. (optional) Add Zod schema if MCP tool emits this event
└── index.ts          ← 3. Verify new symbols are exported

server/src/
├── gate/mcp-server.ts  ← 4. (optional) Register MCP tool that calls emit()
└── ws-server.ts        ← broadcast() is the only send path — no changes needed

ui/src/
└── hooks/useRunStream.ts   ← 5. Events arrive here; route to components as needed
    components/ActiveRun/   ← 6. Handle the new event kind in rendering
```

## Step-by-step

### 1. Define the event in `protocol/src/events.ts`

Three co-ordinated changes are required:

```typescript
// Step 1a — add the kind to WsEventKind
export type WsEventKind =
  | 'phase-start'
  | 'phase-complete'
  | 'checkpoint-start'
  | 'checkpoint-complete'
  | 'agent-start'
  | 'agent-complete'
  | 'gate-request'
  | 'gate-resolved'
  | 'status-change'
  | 'transcript-message'
  | 'interactive-question'
  | 'my-new-event'    // ← add here (kebab-case)

// Step 1b — define the event interface (extends WsEventBase)
export interface MyNewEvent extends WsEventBase {
  kind: 'my-new-event'
  payload: {
    someField: string
    optionalField?: number
  }
}

// Step 1c — add to the WsEvent discriminated union (bottom of file)
export type WsEvent =
  | PhaseStartEvent
  | PhaseCompleteEvent
  | CheckpointStartEvent
  | CheckpointCompleteEvent
  | AgentStartEvent
  | AgentCompleteEvent
  | GateRequestEvent
  | GateResolvedEvent
  | StatusChangeEvent
  | TranscriptMessageEvent
  | InteractiveQuestionEvent
  | MyNewEvent          // ← add here
```

Naming rules:
- `WsEventKind` literal: `kebab-case` (e.g. `'my-new-event'`)
- Interface: `PascalCaseEvent` (e.g. `MyNewEvent`)
- `kind` field: must match the literal exactly

### 2. (Optional) Add Zod schema if an MCP tool emits this event

When a Claude skill needs to call an MCP tool that triggers this event, define the
input schema in `protocol/src/mcp-schemas.ts`:

```typescript
// protocol/src/mcp-schemas.ts
export const MyNewEventSchema = z.object({
  someField: z.string().min(1).describe('Description of someField for the model.'),
  optionalField: z.number().optional().describe('Optional numeric value.'),
})

export type MyNewEventInput = z.infer<typeof MyNewEventSchema>
```

### 3. Re-export from `protocol/src/index.ts`

Verify the new symbols are covered by the existing wildcard re-exports. If not, add explicit re-exports:

```typescript
// protocol/src/index.ts
export type { MyNewEvent } from './events.js'
export { MyNewEventSchema } from './mcp-schemas.js'
export type { MyNewEventInput } from './mcp-schemas.js'
```

### 4. Build protocol

```bash
npm run build -w protocol
```

TypeScript in server and ui will now pick up the new types via the workspace reference.

### 5. (Optional) Register an MCP tool in `server/src/gate/mcp-server.ts`

When a Claude skill should be able to trigger this event via an MCP tool call:

```typescript
// server/src/gate/mcp-server.ts
import { MyNewEventSchema } from '@bosch-sdlc/protocol'

// Inside createBoschMcpServer(), add to the tools array:
tool(
  'my_new_event',                     // snake_case tool name
  'Description that the model sees.',  // shown to the LLM as tool documentation
  MyNewEventSchema.shape,              // always .shape, not the schema itself
  async (input) => {
    emit('my-new-event', input)        // use the local emit() helper
    return ok()                         // void tools return ok()
  },
),
```

The `emit()` helper (defined at the top of `createBoschMcpServer`) builds the full `WsEvent`
object with `run_id` and `t` (ISO timestamp) and calls `broadcast`.

### 6. Handle the event in the UI

Events arrive in `useRunStream` and are accumulated in the `events` array. Components
receive this array and filter by kind:

```typescript
// In a component that receives events: WsEvent[]
import type { WsEvent, MyNewEvent } from '@bosch-sdlc/protocol'

const myEvents = events.filter((e): e is MyNewEvent => e.kind === 'my-new-event')

// Or handle imperatively in useEffect:
useEffect(() => {
  const latest = events.findLast((e) => e.kind === 'my-new-event')
  if (latest) {
    setSomeState(latest.payload.someField)
  }
}, [events])
```

The type guard `(e): e is MyNewEvent => e.kind === 'my-new-event'` narrows the union
so TypeScript knows `e.payload.someField` is available.

## Conventions

- **Never call `ws.send()` directly** in any server code. Always use `broadcast(runId, event)`.
- **One tool per event kind** — if a skill emits multiple related events in sequence
  (e.g. `phase-start` followed by `checkpoint-start`), that is correct; each maps to its
  own MCP tool call.
- **`t` field** — the ISO timestamp is set by the server's `emit()` helper. Do not include
  it in the MCP tool input schema.
- **`run_id` field** — similarly set by `emit()` from the `runId` closure. Not a schema field.
- **Replay-safe events** — events are buffered (last 200 per run) and replayed to late
  WebSocket joiners. Keep payload small and idempotent-friendly.

## Checklist

- [ ] `WsEventKind` union updated in `events.ts`
- [ ] Event interface defined (extends `WsEventBase`, `kind` matches literal)
- [ ] `WsEvent` union updated in `events.ts`
- [ ] (if MCP) Zod schema added to `mcp-schemas.ts` with `.describe()` on all fields
- [ ] (if MCP) Schema re-exported from `index.ts`
- [ ] `npm run build -w protocol` succeeds
- [ ] (if MCP) MCP tool registered in `gate/mcp-server.ts`
- [ ] UI component handles the new event kind
- [ ] TypeScript strict mode passes in server and ui (`npm run typecheck`)

## References

See `references/example-event.md` for an annotated example from the actual codebase.
