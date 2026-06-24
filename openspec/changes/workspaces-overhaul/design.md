## Context

The starting state is uneven. The `workspace-registry` spec already does heavy lifting: it scans folders, classifies them as `monolith` / `monorepo` / `multi-repo-workspace`, persists them in SQLite at `~/.bosch-sdlc/state.db`, exposes `POST /api/workspaces` to attach, and exposes `GET /api/fs/browse` to drive a directory picker. The `web-ui` spec adds a Dashboard, an attach-repo modal, sidebar context-awareness, and the "no mock data in production" rule.

What's missing is everything *between* the registry and the screen: the UI has no concept of an "active" workspace (it hardcodes one in `data.js`), the Dashboard renders one shape regardless of topology (the registry's own spec says "topology is informational only — no runtime behavior branches on it" — line 5), and there is no first-run path because the attach-repo entry point is buried in a modal that's never surfaced before the user has a workspace.

This change pulls those threads together: introduce an "active workspace" as a first-class persisted thing, route the Overview off its topology, and reuse one full-page Import view for both first-run and Add-workspace.

## Goals / Non-Goals

**Goals:**

- One sidebar surface (the dropdown) for every workspace operation a user does day-to-day: switch, add, see what's active, see which has running work.
- An Overview that *means something* per topology — a monolith user does not see a one-row Services table; a multi-repo user does see services and edges; a monorepo user sees packages.
- A first-run that does not crash on an empty registry. Zero workspaces routes to Import; one or more routes to the last-active Overview.
- Persistence of the active selection across app restarts, so reopening the app puts the user back where they were.

**Non-Goals:**

- Filesystem scanning for existing `.claude/` setups outside the workspace currently being imported. The "Continue from existing setup" detected card and its dropdown sibling are deferred.
- Topology auto-detection in the Import UI. The registry still classifies after the fact, but the user picks `monolith` / `multi-repo-workspace` / `monorepo` explicitly during import. If the registry's classification later disagrees with the user's pick, the user's pick wins for display purposes (the registry's `topology` field is overwritten on attach).
- Fleshing out the Manage workspaces page. Only the route and a placeholder body ship.
- Server-side branching on topology. The server stays topology-agnostic; only the UI Overview shape changes.
- Re-doing the existing Active Run / Review Gate / Kickoff screens. They consume `activeWorkspace` for context but their shapes do not change.

## Decisions

### Decision 1: Active workspace lives in the registry, not in the UI

The active workspace is persisted server-side in the existing SQLite database, exposed via `GET /api/workspaces/active` and `PUT /api/workspaces/active`. The UI fetches it on mount and writes to it when the user picks a row in the dropdown.

**Alternative considered:** keep `activeWorkspaceId` in `localStorage` on the client. Rejected because (a) the UI already follows a "no client-side state of record" pattern — `projects` and `runs` come from REST per the `web-ui` spec's "App-level shared state" requirement — and putting active-workspace in localStorage would split that pattern; (b) a future CLI or second window needs the same answer.

Schema delta: a `kv_settings` singleton table with rows like `('active_workspace_id', '<uuid>')` keeps the addition minimal. A new `last_active_at` column on `workspaces` lets the dropdown sort by recency and lets the launch-flow pick a sensible fallback if the persisted `active_workspace_id` no longer resolves.

### Decision 2: Topology becomes a routing key for the Overview shape, NOT for any other branch

The `workspace-registry` spec line "topology is informational only" is replaced by a narrower rule: topology drives ONE thing, the Overview body shape. Nothing else branches on it — not Kickoff, not Active Run, not Review Gate. The existing `web-ui` requirement "Kickoff form is identical across topologies" stays exactly as written.

This keeps the blast radius tight: a single switch statement in the Dashboard component selects one of three sub-views. Topology drift (registry says `monolith`, user says `monorepo`) shows up in one place, not three.

**Alternative considered:** branch on topology in multiple screens (per-topology Kickoff, per-topology Active Run telemetry). Rejected because the design exploration only varies the Overview, and broader branching would multiply the surface area without a UX motive.

### Decision 3: The Import view is one screen, used in two flows

The first-run empty state (zero workspaces) and the "Add workspace" affordance from the dropdown both route to the same `import` screen. The UI does not render an empty Dashboard — when there is no active workspace, the route is `import`, full stop.

The Import screen has two import cards (Open local folder, Clone from Git URL) and a topology picker that appears after a folder is chosen (or a URL is entered and cloned). The "Continue from existing setup" card is deferred — that's the only difference between the design's first-run and the change as scoped.

**Alternative considered:** use a modal for "Add workspace" while keeping first-run as a full page. Rejected because (a) the user explicitly asked for "whole body" for the Add flow; (b) reusing one screen halves the maintenance surface; (c) the Import view needs space for the topology picker step which would be cramped in a modal.

The existing `web-ui` requirement "Directory-browser modal for attach repo" is replaced by "Directory-browser inside the Import view" — the modal becomes a sub-pane within the screen, scoped to one of the two cards.

### Decision 4: Manage workspaces ships as routing + placeholder, not as a full page

The dropdown's `⚙ Manage workspaces` row is rendered visible-but-disabled with a tooltip ("Coming soon"). Clicking it does nothing in this change. The route `manage` exists and renders a stub body so a future change can flesh out the page without re-wiring the dropdown or the routing.

**Alternative considered:** omit the row from the dropdown until the page is built. Rejected because the row is part of the design's information architecture — the user explicitly asked for it to "show but grey out" so the future surface area is communicated.

### Decision 5: Three React sub-views, not one parameterised Dashboard

The adaptive Overview is implemented as three distinct components — `OverviewMono`, `OverviewMulti`, `OverviewMonoz` — selected by a switch on `activeWorkspace.topology`. They share atomic pieces (KPI strip, Recent runs row) via the existing component library in `components.jsx`.

**Alternative considered:** one Dashboard component with conditional blocks. Rejected because the shapes diverge meaningfully (multi has edges + tagged runs; monoz has modules + module-tagged runs; mono has neither) and a conditional Dashboard becomes a tangle of `topology === 'X' && …` blocks that hide the layout. Three named components show the shape in their names.

The selection happens in `screen-dashboard.jsx`, which becomes a thin router:

```
function ScreenDashboard({ activeWorkspace, goto, workflowInstalled }) {
  if (!activeWorkspace) return null;                    // app router shouldn't even reach this
  switch (activeWorkspace.topology) {
    case 'monolith':              return <OverviewMono  {...} />;
    case 'multi-repo-workspace':  return <OverviewMulti {...} />;
    case 'monorepo':              return <OverviewMonoz {...} />;
  }
}
```

### Decision 6: Clone Git URL clones synchronously, then attaches

The new `POST /api/workspaces` shape `{ remoteUrl: "https://…" }` performs a git clone into `~/dev/<repo-name>` (configurable later), then runs the same classification + persistence flow as the existing `{ root }` shape. The endpoint blocks until clone completes. There is no progress streaming in v1 — the UI shows a spinner and surfaces clone failures inline.

**Alternative considered:** WebSocket progress events for the clone. Rejected for v1 — most clones are sub-10-second; a spinner with an inline error is sufficient. If clone times routinely exceed UX tolerance later, add streaming then.

### Decision 7: Launch-flow restore is "if it still resolves, use it"

On app mount the UI calls `GET /api/workspaces/active`. If the response includes an `activeWorkspace` whose `path` still exists on disk (the registry already detects detached workspaces and marks `status: "detached"`), the UI routes to its Overview. Otherwise the UI routes to Import. The registry's existing "Removed repo is marked detached" rule does the disk-existence check for us.

If `active_workspace_id` is null (first run, never picked) and any workspaces exist (e.g. user attached one then quit before picking), the UI auto-selects the most-recently-attached one by `last_active_at` (fallback: `createdAt`) and routes there.

## State machine

```
┌────────────────────────────────────────────────────────────────┐
│                       APP LAUNCH                                │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  GET /api/workspaces
                  GET /api/workspaces/active
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        zero workspaces   active resolves   active is null/stale
              │               │               │
              ▼               ▼               ▼
         ┌────────┐      ┌─────────┐     auto-pick most-recent
         │ Import │      │Overview │     by last_active_at
         └────────┘      │ (typed) │           │
              │          └─────────┘           ▼
              │               ▲           ┌─────────┐
              │     switch    │           │Overview │
              │   (dropdown)  │           │ (typed) │
              │       │       │           └─────────┘
              ▼       │       │
        attach ok ────┘       │
              │               │
              └───────────────┘
                  ▲
        add ws    │
   (dropdown) ────┘    ┌─────────┐
                       │ Manage  │  ← stub, no actions
                       └─────────┘
```

## Data model

**Workspace (extended):**

| Field             | Type      | Source     | Notes |
|-------------------|-----------|------------|-------|
| `id`              | uuid      | existing   | |
| `name`            | string    | existing   | basename of path on attach; renamable in Manage (later) |
| `path`            | abs path  | existing   | |
| `topology`        | enum      | existing   | `monolith` \| `monorepo` \| `multi-repo-workspace`; user-pickable on attach |
| `status`          | enum      | existing   | `active` \| `detached` |
| `createdAt`       | ISO ts    | existing   | |
| `lastActiveAt`    | ISO ts    | **new**    | set to `now()` whenever this workspace becomes active |
| `mark`            | string    | **new**    | 1–2 char glyph for the icon; derived from `name` on attach (first letter or two), editable in Manage (later) |

**Singleton settings (`kv_settings` table):**

| Key                    | Value type | Notes |
|------------------------|------------|-------|
| `active_workspace_id`  | uuid \| null | currently-selected workspace; null on first run |

## Screen routing

| Route          | Component         | Mount condition |
|----------------|-------------------|-----------------|
| `import`       | `ScreenImport`    | no `activeWorkspace`, OR user clicked `+ Add workspace` |
| `dashboard`    | `ScreenDashboard` (which dispatches to `OverviewMono` / `OverviewMulti` / `OverviewMonoz`) | `activeWorkspace` resolves |
| `manage`       | `ScreenManage` (stub) | user clicked `⚙ Manage workspaces` — but the dropdown row is disabled in this change, so this route is effectively dead-but-wired |
| `project`, `kickoff`, `run`, `gate`, `analytics`, `history`, `settings` | unchanged | unchanged — they keep working off `activeWorkspace` for context |

## Sidebar changes

| Section                    | Before                        | After |
|----------------------------|-------------------------------|-------|
| Brand                      | `cb / claudboard / v1.4`      | unchanged |
| Workspace picker           | static div, opens nothing     | `WorkspaceSwitcher` dropdown (open/close, lists workspaces, Add / Manage rows) |
| Workflow nav               | unchanged                     | unchanged |
| Project nav                | unchanged                     | unchanged |
| **Repos in workspace**     | lists up to 5 repos           | **removed** — the Overview is the workspace home for this information |
| Theme toggle / footer      | unchanged                     | unchanged |

## Risks / Trade-offs

- **[Risk] The `workspace-registry` spec currently asserts "topology is informational only."** This change directly modifies that line. Mitigation: the MODIFIED spec delta narrows the rule to "topology drives the Overview shape and nothing else" — every other surface stays topology-agnostic, so the registry's intent (don't fork business logic on topology) is preserved.
- **[Risk] User-picked topology can disagree with registry-detected topology.** A user might pick `monolith` for a folder that contains `packages/*`. Mitigation: on attach, the registry persists the user's pick to `topology`; the registry's classification logic still runs but only as a sanity check that surfaces a warning toast ("we detected this as monorepo; you picked monolith — using monolith"). No hard error.
- **[Risk] The Clone-Git-URL endpoint can hang on slow networks.** Mitigation: the endpoint has a 60s timeout; failures surface inline in the Import view. Streaming progress is explicitly out of scope.
- **[Risk] Removing the "Repos in workspace" sidebar section is a regression for users who used it as a quick repo-jump shortcut.** Mitigation: the Overview's Services / Modules directory provides the same affordance (click a row → Project view). The sidebar repo list was a duplicate of that.
- **[Risk] Manage stub leaves a visible disabled affordance with no value yet.** Mitigation: the tooltip is explicit ("Coming soon"); the route is reachable so the next change can fill in the body without UI re-wiring.
