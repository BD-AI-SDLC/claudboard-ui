## Context

The previous change (`feature-workflow-web-app`) delivered 78 tasks and visual parity with the bosch-workflow mock. What it deferred was the wiring between the polished mock and the real backend for any path that wasn't strictly linear — Dashboard → click row → Project → Start feature → Run → Gate.

This change is **scoped strictly to the happy-path UX**, not to building out the four sidebar sections that weren't designed (History / Skills / Rules / Settings) and not to a theme system.

## Decisions

### 1. Smart-pick navigation logic for sidebar items

| Sidebar item | When enabled | Resolves to | When disabled |
|---|---|---|---|
| Overview | always | `/dashboard` | never |
| Project · health | ≥1 active project | first active project (by `createdAt` asc), or last-visited if tracked | tooltip: "Attach a repo first" |
| Start feature | ≥1 active project | 1 project → Kickoff with that project; N projects → picker modal | tooltip: "Attach a repo first" |
| Active run | ≥1 run with status `running` or `paused-user` | most recent by `createdAt` desc | tooltip: "No active runs" |
| Review gate | ≥1 run with status `paused-gate` and an open gate | oldest open gate by `createdAt` asc | tooltip: "No gates awaiting review" |
| History / Skills / Rules / Settings | never (this change) | n/a | tooltip: "Coming soon" |

"Last-visited project" is tracked in App component state only (not persisted). If unset, smart-pick falls back to the first active project. Persistence is out of scope.

### 2. State lifting

Currently each screen fetches independently. To make the sidebar enable/disable decisions, multiple consumers need the same data. We lift two queries to App:

```
App
├── projects: Project[]            (api.getProjects)
├── runs:     Run[]                (api.getRuns)
└── openGates: Gate[]              (derived from runs OR new endpoint, see §4)
```

Refetch triggers:
- App mount
- After successful attach-repo (refetch projects)
- After successful run creation (refetch runs)
- WebSocket lifecycle events (`status-change`, `gate-request`, `gate-resolved`) when a global WS subscription is open

A global WS subscription is out of scope for this change — refetching on REST mutations is sufficient for v1. Background polling of `runs` every 30s is acceptable as a fallback for "Active run / Review gate" sidebar freshness; we will implement polling rather than global WS to keep the change small.

### 3. Project picker modal

A minimal modal overlay component (not a generic Modal primitive — too much surface for one use site). Lists active projects with name + path. Click → close modal + navigate. Cancel → close modal. Keyboard: `Esc` closes; arrow keys + Enter navigate. No search (deferred — fewer than ~20 projects is the realistic ceiling).

### 4. Open gates lookup

Two ways to resolve the "oldest open gate" for the sidebar:

| Option | Pros | Cons |
|---|---|---|
| A. Derive from `runs[]` then `GET /api/runs/:id` for each `paused-gate` run | No new endpoint | N+1 fetches when many paused runs |
| B. Add `GET /api/gates?status=open` | Single round trip | New endpoint to test |

**Decision: A.** In the realistic case (≤2 runs paused on gates at any time) the N+1 cost is negligible, and we don't need a new endpoint. If this becomes a hot path we can revisit. The existing `Run` shape doesn't currently expose the open gate; we'll add it as an optional field `openGate?: Gate` on the runs list response, populated server-side via a single LEFT JOIN. This is cheaper than a separate endpoint and avoids extra fetches.

### 5. Directory-browser modal (attach repo)

The browser security model forbids absolute-path access from any client-side picker (`<input type="file" webkitdirectory>`, `showDirectoryPicker()`, drag-and-drop all expose only relative paths). Since the server runs locally with the user's filesystem privileges, we expose a thin browse endpoint and build the picker in the UI.

**Endpoint shape:**

```
GET /api/fs/browse?path=<absolute-path>

200 OK
{
  path: "/Users/lup1bg/Documents",       // canonicalised
  parent: "/Users/lup1bg",               // null at filesystem root
  entries: [
    { name: "BoschProjects", path: "/Users/lup1bg/Documents/BoschProjects", isGitRepo: true },
    { name: "Notes",         path: "/Users/lup1bg/Documents/Notes",         isGitRepo: false }
  ]
}

400 Bad Request   — missing/relative path
403 Forbidden     — path is not readable by the server process
404 Not Found     — path does not exist
```

**Safety rules:**
- `path` must be absolute (`path.isAbsolute`). Reject otherwise.
- Resolve via `fs.realpath` first to prevent symlink-loop attacks; if realpath fails (broken symlink), return 404.
- Only return entries that are directories (skip files).
- Skip entries whose name starts with `.` unless the parent path itself is dotted (so we don't permanently hide `.config`-style explicit nav). Show `isGitRepo: true` for entries containing `.git`.
- Hard cap entries returned at 500 to prevent UI lockup on giant `node_modules`-style dirs.
- No cross-server-process privilege escalation — server runs as the user, so the user can read whatever the server can read. This is the intended trust model.

**UI behavior:**
- Modal opens at `homedir()`.
- Breadcrumb at the top shows the current path with each segment clickable.
- A list of subdirectories below; entries marked with the git glyph if `isGitRepo`.
- "Up" button (or breadcrumb click) navigates to `parent`.
- Bottom row: `[ Cancel ]   [ Paste path ▾ ]   [ Use this folder ]`. "Use this folder" attaches the current path. "Paste path" reveals an inline text input that takes any absolute path — power-user escape hatch.
- Loading state per navigation; errors shown inline (e.g. "Permission denied").

### 6. Recent runs panel

Fixed at 5 latest runs, sorted by `createdAt` desc. Each row:

```
[status chip] [project name] [prompt summary, 60 chars max] [relative age]
```

Click anywhere on the row → navigate to the Run view (sets `runId`, routes to `run`). Empty state: "No runs yet — start a feature from any project."

Project name is resolved via the same App-level `projects[]` state — no extra fetches.

### 7. Disabled sidebar items

CSS-level treatment:
- Reduced opacity (0.4)
- `cursor: not-allowed`
- `pointer-events: none` on the click handler (still focusable for tooltip visibility)
- Native `title` attribute for the tooltip — keeps the change small. A custom tooltip primitive is deferred.

## Risks / Trade-offs

- **`title`-attribute tooltips look ugly on Linux/Windows.** Accepted to keep this change scoped; can swap for a custom tooltip primitive in a follow-up.
- **Polling `runs` every 30s** is a small server load but is the simplest way to keep the sidebar's "Active run / Review gate" enabled-state fresh without a global WS. If the run count grows large in the future, switch to event-pushed deltas.
- **No persistence of "last visited project"** means each browser tab starts fresh. Acceptable for a local-dev tool; a `localStorage` upgrade is one line later if desired.
- **Modal stack is single-deep** (only one modal at a time, no nested). Picker and attach modals never need to coexist; if they ever do, refactor to a stack.

## Open questions

None — all UX choices were decided in the explore session (Q1–Q6).
