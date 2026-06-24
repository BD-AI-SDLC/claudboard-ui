---
paths:
  - ui/src/**
---

# UI Conventions

## Component Structure

Components are **feature-grouped** under `ui/src/components/`. Each feature gets its own directory; reusable primitives live in `components/primitives/`.

```
ui/src/
├── components/
│   ├── primitives/     ← Chip, Icon, StatusChip, TopBar, Sidebar, etc.
│   ├── ActiveRun/      ← run pipeline progress view
│   ├── ReviewGate/     ← spec+plan & clarify gate review
│   ├── Project/        ← repo setup and prereq management
│   ├── Dashboard/      ← summary view and bootstrap card
│   ├── Kickoff/        ← run creation form
│   └── claudboard/     ← claudboard run views
├── api/
│   ├── client.ts       ← all API methods (single abstraction)
│   └── claudboard.ts   ← claudboard-specific API calls
├── hooks/
│   ├── useRunStream.ts      ← WebSocket event streaming
│   ├── useBootstrapStatus.ts ← polling hook
│   ├── useActiveRuns.ts     ← active run polling
│   └── useTheme.ts          ← theme preference
└── App.tsx             ← root component + client-side routing
```

### Co-location Rule

Every component directory contains exactly: `Component.tsx`, `Component.css`, and optionally `Component.test.tsx` — all in the same directory:

```
ActiveRun/
├── ActiveRun.tsx
├── ActiveRun.css
└── ActiveRun.test.tsx
```

Never place tests in a separate `__tests__/` folder for UI components.

## Props Interfaces

Define a local `interface FooProps {}` at the top of the component file. Export it only when a parent component needs to import the type:

```typescript
// Component-private props — do NOT export
interface RunBannerProps {
  runId: string
  status: RunStatus
}

export default function RunBanner({ runId, status }: RunBannerProps) {
  // ...
}
```

## CSS Naming Convention

Class names must be **prefixed with the component name in kebab-case**. This is enforced by `ui/scripts/check-css-prefixes.js` (runs in `npm run lint`):

```css
/* ✓ correct — prefix matches component name */
.active-run-container { ... }
.active-run-header { ... }
.active-run__phase-list { ... }

/* ✗ wrong — no prefix, will fail the lint check */
.container { ... }
.header { ... }
```

Theming uses CSS custom properties on the root `data-theme` attribute:

```css
:root[data-theme='dark'] {
  --bg-primary: #1a1a1a;
  --text-primary: #f0f0f0;
}
```

## API Access

**All** server API calls must go through `api/client.ts`. Never use raw `fetch()` in a component or hook:

```typescript
// ✓ correct
import { api } from '../api/client.js'
const run = await api.getRun(id)

// ✗ wrong — raw fetch bypasses the typed abstraction
const res = await fetch(`/api/runs/${id}`)
```

To add a new endpoint, add a typed method to the `api` object in `api/client.ts`. Types for the request/response shapes come from `@bosch-sdlc/protocol`.

## State Management

No state management library — use `useState` and prop drilling. Extract complex state logic into custom hooks:

```typescript
// Hook pattern: encapsulate stateful logic
export function useBootstrapStatus() {
  const [status, setStatus] = useState<BootstrapStatusResponse>({ state: 'cli-missing' })
  useEffect(() => {
    // polling / event subscription
  }, [])
  return { status, retry }
}
```

Avoid lifting state higher than necessary. `App.tsx` holds top-level route state; feature components own their own UI state.

## WebSocket Streaming

Use `useRunStream(runId)` for event streaming. Do not open WebSocket connections manually in components:

```typescript
import { useRunStream } from '../../hooks/useRunStream.js'

const { events, hydrated } = useRunStream(runId)
```

The hook deduplicates events using `eventKey` + a `seenRef` to prevent replay duplicates from the HTTP history/WS overlap window.

## Imports

All relative imports use `.js` extensions (Vite resolves them correctly at build time):

```typescript
// ✓ correct
import { api } from '../api/client.js'
import StatusChip from '../primitives/StatusChip.js'

// ✗ wrong
import { api } from '../api/client'
```

Protocol types are imported directly from the package — never re-declare them locally:

```typescript
import type { Run, WsEvent, RunStatus } from '@bosch-sdlc/protocol'
```

## Testing

Tests use **Vitest + React Testing Library**, co-located with the component:

```typescript
// ActiveRun/ActiveRun.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ActiveRun from './ActiveRun.js'

describe('ActiveRun', () => {
  it('shows loading state when not hydrated', () => {
    render(<ActiveRun runId="r1" />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})
```

Run all UI tests: `npm run test -w ui`  
Single file: `npm run test -w ui -- --reporter=verbose ActiveRun`

## No Debug Logging

Zero `console.log` in production UI code. If you need debug output during development, remove it before committing. `console.error` is acceptable only in error boundaries and catch blocks.
