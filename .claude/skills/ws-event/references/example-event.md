# Example: `interactive-question` event from the actual codebase

This shows the full end-to-end lifecycle of a WebSocket event type: protocol definition,
MCP tool registration (via Zod schema), and the server-side emit.

---

## 1. Protocol: `protocol/src/events.ts`

```typescript
// WsEventKind union includes the kind literal
export type WsEventKind =
  | 'interactive-question'   // ← kebab-case kind literal
  // ...

// Event interface extends WsEventBase
export interface InteractiveQuestionEvent extends WsEventBase {
  kind: 'interactive-question'
  payload: { toolUseId: string; questions: InteractiveQuestion[] }
}

// WsEvent discriminated union includes the new type
export type WsEvent =
  | InteractiveQuestionEvent
  // ...
```

**Key points:**
- `kind: 'interactive-question'` matches the `WsEventKind` literal exactly
- `payload` carries domain-specific data — `toolUseId` to correlate the answer, `questions` for the UI to render
- `run_id` and `t` come from `WsEventBase` — they are NOT in the payload schema

---

## 2. Protocol: `protocol/src/types.ts` (supporting types)

```typescript
// Types used by the payload — defined in types.ts, not inline in events.ts
export interface InteractiveQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: InteractiveQuestionOption[]
}
```

**Key point:** Complex payload types are defined separately in `types.ts` and referenced from the event interface. Keep `events.ts` focused on the union structure.

---

## 3. Server: emit in `server/src/prereq/cli-runner.ts`

```typescript
import { broadcast } from '../ws-server.js'
import type { WsEvent } from '@bosch-sdlc/protocol'

// Building the event object manually (in this case, not via MCP tool):
const event: WsEvent = {
  run_id: runId,
  t: new Date().toISOString(),
  kind: 'interactive-question',
  payload: { toolUseId, questions },
}
broadcast(runId, event)
```

**Key point:** `broadcast(runId, event)` is the ONLY way to send a WebSocket message.
It persists to the event log (for HTTP replay) and fans out to all connected clients.

---

## 4. Comparison: MCP-tool-driven emit (from `gate/mcp-server.ts`)

For events triggered by Claude (not by the server itself), the pattern uses the `emit` helper:

```typescript
// Inside createBoschMcpServer(), the local emit helper:
const emit = <T>(kind: WsEvent['kind'], payload: T) => {
  const event = {
    run_id: runId,
    t: new Date().toISOString(),
    kind,
    payload,
  } as WsEvent
  broadcast(runId, event)
}

// MCP tool uses emit:
tool('phase_start', 'Mark the start of a workflow phase.', PhaseStartSchema.shape,
  async (input) => {
    emit('phase-start', input)   // ← the emit helper handles run_id + t
    return ok()
  },
)
```

**Key point:** The `emit` helper takes care of `run_id` and `t` — the MCP tool input
schema (`PhaseStartSchema`) only needs the payload fields (`num`, `title`).

---

## 5. UI: handling in `ui/src/components/ActiveRun/ActiveRun.tsx` (pattern)

```typescript
import type { WsEvent, InteractiveQuestionEvent } from '@bosch-sdlc/protocol'

// Narrowing with a type guard:
const questions = events
  .filter((e): e is InteractiveQuestionEvent => e.kind === 'interactive-question')
  .flatMap((e) => e.payload.questions)

// Or in a useEffect:
useEffect(() => {
  const last = events.findLast((e) => e.kind === 'interactive-question')
  if (last) setActiveQuestion(last.payload)
}, [events])
```

**Key point:** `(e): e is InteractiveQuestionEvent` is a type predicate — TypeScript narrows
the union so `e.payload.toolUseId` and `e.payload.questions` are accessible without casting.
