---
paths:
  - protocol/src/**
---

# Protocol Conventions

`protocol/` is the single source of truth for all cross-boundary contracts in bosch-sdlc. Both `server/` and `ui/` import from `@bosch-sdlc/protocol`. Never define shared types locally in either package — add them here and re-export.

## File Organisation

```
protocol/src/
├── types.ts        ← TypeScript interfaces: REST shapes, run/gate/repo models
├── events.ts       ← WsEvent discriminated union and per-event interfaces
├── mcp-schemas.ts  ← Zod schemas for MCP tool inputs (passed to tool().shape)
└── index.ts        ← re-exports everything; the only import target for consumers
```

One concern per file. Do not add new files unless a new concern warrants its own namespace. All new symbols must be re-exported from `index.ts`.

## Naming Conventions

| Symbol | Convention | Example |
|--------|-----------|---------|
| Zod schema | `PascalCaseSchema` | `PhaseStartSchema` |
| Inferred type from schema | `PascalCaseInput` | `PhaseStartInput` |
| TypeScript interface | `PascalCase` | `Run`, `Gate`, `SpecPlanGatePayload` |
| WsEvent interface | `PascalCaseEvent` | `PhaseStartEvent`, `GateRequestEvent` |
| `kind` literal | `kebab-case` | `'phase-start'`, `'gate-request'` |

## Schema-First Pattern

Always define the Zod schema first in `mcp-schemas.ts`, then export the inferred TypeScript type. Never write a hand-rolled interface where a Zod-inferred type would do:

```typescript
// mcp-schemas.ts — define Zod schema
export const PhaseStartSchema = z.object({
  num: z.number().int().positive(),
  title: z.string().min(1),
})

// Export inferred type
export type PhaseStartInput = z.infer<typeof PhaseStartSchema>
```

Pass `.shape` (not the full schema) when registering an MCP tool on the server:

```typescript
// server/src/gate/mcp-server.ts
import { PhaseStartSchema } from '@bosch-sdlc/protocol'
tool('phase_start', 'Description', PhaseStartSchema.shape, async (input) => { ... })
```

## Zod `.describe()` on MCP-Facing Fields

Add `.describe()` to every field in schemas used as MCP tool inputs. The Agent SDK passes these descriptions to the model as the parameter documentation:

```typescript
export const ClarifyQuestionSchema = z.object({
  text: z.string().min(1).describe(
    'The question as a single plain-text sentence ending with "?". One focused ask only.',
  ),
  group: z.string().optional().describe(
    'Short section header (2-5 words) shown as a chip above the question.',
  ),
  why: z.string().optional().describe(
    'One sentence explaining why this question matters.',
  ),
})
```

## WsEvent Pattern

Adding a new WebSocket event type requires three co-ordinated changes in `events.ts`:

```typescript
// 1. Add the kind to WsEventKind
export type WsEventKind =
  | 'phase-start'
  | 'my-new-event'    // ← add here
  // ...

// 2. Define the event interface (extends WsEventBase)
export interface MyNewEvent extends WsEventBase {
  kind: 'my-new-event'
  payload: { someField: string }
}

// 3. Add to the WsEvent union (at the bottom of the file)
export type WsEvent =
  | PhaseStartEvent
  | MyNewEvent           // ← add here
  // ...
```

Then re-export from `index.ts` if not already covered by a wildcard.

## TypeScript Strictness

The protocol package runs with `strict: true`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`. Follow these patterns:

- Use `T | null` instead of `T | undefined` for nullable fields (aligns with SQLite NULL mapping).
- Use `readonly` arrays for constant-valued exports: `export const FOO: readonly Foo[] = [...] as const`
- Inline JSDoc on ambiguous or domain-specific fields:

```typescript
export interface PrereqRecord {
  /** Populated only when `state === 'stale'`; null otherwise. */
  staleReason: StaleReason | null
}
```

## No Tests in Protocol

The protocol package has no test files. Types are validated by the consuming packages (`server/` runs Jest, `ui/` runs Vitest). If a schema is wrong, the consumer tests catch it via TypeScript strict-mode compilation.

## Build

Build protocol before server or ui:

```bash
npm run build -w protocol   # tsc only — outputs to protocol/dist/
```

After any protocol change, consumers pick up the new types automatically (workspace `*` reference). You do not need to bump the version for local workspace usage.
