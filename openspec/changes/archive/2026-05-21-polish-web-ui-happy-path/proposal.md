## Why

The web app ships at visual parity with the bosch-workflow mock, but on a fresh machine almost every interaction outside the happy-path linear flow silently fails or shows fake data:

- The Sidebar exposes nine items; only "Overview" works. Clicking `Project · health`, `Active run`, or `Review gate` calls `setRoute(id)` without setting the required `projectId` / `runId` / `gateId`, so App.tsx silently falls back to the Dashboard. `History` / `Skills` / `Rules` / `Settings` have no handler at all and look like broken links.
- The Dashboard "Activity" panel renders a hardcoded `STATIC_FEED` of fake JIRA tickets and agent names — there is no signal that this is mock data, and it never updates.
- "Start feature" lives on the Project view's TopBar but not the Dashboard, because the previous wiring led nowhere when no project was selected. This removes the cornerstone CTA from the app's main landing page.
- "Attach repo" is a raw text input where the user has to type an absolute filesystem path from memory. Browsers will never allow native path access, so this is the user's only way in, and it's painful enough that the first-run experience feels broken.

The goal of this change is **every visible interaction does what it implies**. The app should be coherent end-to-end on a fresh machine without the user having to know which controls are wired and which are decorative.

## What Changes

- **Sidebar context-aware navigation.** Items that require a `projectId` / `runId` / `gateId` either smart-pick (first active project / most recent running run / oldest open gate) when context is available, or render as visibly disabled with a tooltip when it is not.
- **Sidebar decorative section.** `History`, `Skills`, `Rules`, `Settings` are kept in the sidebar at design fidelity but rendered disabled with a "Coming soon" tooltip — no silent no-op clicks.
- **Restore Start feature CTA on Dashboard TopBar.** Same smart logic as the sidebar's Start feature item: disabled if 0 projects, auto-select if 1, picker modal if 2+.
- **Project picker modal.** When the smart logic needs the user to choose between multiple projects, a modal overlay lists active projects; clicking one navigates to Kickoff with that project selected.
- **Recent runs panel replaces hardcoded activity feed.** Dashboard's right panel renders the 5 latest runs (across all projects), each row clickable to its Run view. Status, project name, prompt summary, and relative age are shown. No time-window filter.
- **Directory-browser modal for attach repo.** Replace the free-text "path/to/repo" input with a modal that browses the host filesystem starting at `homedir()`, with a "paste path" fallback for power users. Backed by a new server endpoint that lists subdirectories under a given absolute path.
- **State lifted to App for cross-panel coherence.** Projects and runs become App-level state, fetched once and passed to Sidebar + Dashboard. Refetched after attach, run-creation, and on WebSocket lifecycle events.

## Capabilities

### Modified Capabilities

- `web-ui`: Adds smart sidebar navigation, decorative-item disabling, restored Start-feature TopBar CTA with project picker, recent runs panel, directory-browser modal for attach.

### New / Modified Capabilities

- `workspace-registry`: Adds a `GET /api/fs/browse` endpoint that returns the immediate subdirectories of an absolute path on the host filesystem, used by the attach-repo modal. Returns only directory entries (not files), with safety checks against symlink loops and unreadable paths.

## Impact

- **No new runtime dependencies.** Filesystem browsing uses Node's built-in `fs/promises`.
- **No protocol breakage.** Existing REST/WS contracts are preserved; new endpoint is additive.
- **No DB schema change.** All new data flows are derived from existing tables.
- **UI bundle size impact**: minor — one new modal component, one new panel component, one new dir-browser component. Estimated +6 KB gzipped.
- **Out of scope** (deferred): the History / Skills / Rules / Settings screens themselves, light theme, "recent activity" beyond just runs (e.g. recent attaches or recent gate resolutions), pagination of recent runs beyond 5.
- **No breaking change to the previous `feature-workflow-web-app` change.** All deltas are additive or refine existing behaviour without changing API contracts.
