# Tasks

## 1. Server: filesystem browse endpoint (capability: workspace-registry)

- [x] 1.1 Add `GET /api/fs/browse` route to `server/src/registry/routes.ts` (or new `fs/routes.ts`)
- [x] 1.2 Implement directory listing in `server/src/registry/fs-browser.ts`: absolute-path validation, `fs.realpath`, `fs.readdir({ withFileTypes: true })`, filter to directories, detect `.git`, cap at 500 entries, hide dotfiles unless parent is dotted
- [x] 1.3 Return canonical `{ path, parent, entries: [{ name, path, isGitRepo }] }` shape
- [x] 1.4 Map errors: missing `path` → 400, EACCES → 403, ENOENT → 404, other → 500 with sanitised message
- [x] 1.5 Unit tests in `server/src/registry/__tests__/fs-browser.test.ts`: happy path, missing path, relative path, non-existent path, unreadable dir (mocked), symlink loop (mocked), git-repo detection, 500-entry cap

## 2. Server: open gate on Run list (capability: gate-bridge)

- [x] 2.1 Modify `GET /api/runs` in `server/src/run/routes.ts` to include `openGate: Gate | null` per run (LEFT JOIN against `gates` WHERE `status = 'open'`)
- [x] 2.2 Update `Run` type in `protocol/src/types.ts` to include optional `openGate?: Gate` field
- [x] 2.3 Update existing tests that read `GET /api/runs` to assert the new shape

## 3. UI: lift state to App (capability: web-ui)

- [x] 3.1 In `ui/src/App.tsx`, add state: `projects: Project[]`, `runs: Run[]`, `lastVisitedProjectId: string | null`
- [x] 3.2 Add `refreshProjects()` / `refreshRuns()` helpers (fetch via `api.getProjects()` / `api.getRuns()`)
- [x] 3.3 Fetch both on mount; poll `refreshRuns()` every 30s while app is mounted
- [x] 3.4 Pass `projects` / `runs` down to Dashboard and Sidebar as props; pass `refreshProjects` to Dashboard (for attach success)
- [x] 3.5 Set `lastVisitedProjectId` whenever `goProject(id)` is called
- [x] 3.6 Replace per-component `api.getProjects()` calls in Dashboard with prop usage; remove its `useEffect` fetch for projects

## 4. UI: sidebar context-aware navigation (capability: web-ui)

- [x] 4.1 Extend `SidebarProps` in `ui/src/components/primitives/Sidebar.tsx` with `projects: Project[]`, `runs: Run[]`, `lastVisitedProjectId: string | null`, and replace `onNavigate?: (route: string) => void` with typed callbacks: `onNavigateDashboard`, `onNavigateProject(id)`, `onStartFeature()`, `onNavigateRun(id)`, `onNavigateGate(runId, gateId)`
- [x] 4.2 Compute per-item enabled state and target IDs:
  - Project: `projects[0]` (prefer `lastVisitedProjectId` if still active)
  - Start feature: enabled if `projects.length >= 1`; resolution handled by App
  - Active run: most recent `runs.find(status === running || paused-user)`
  - Review gate: oldest `runs.find(status === paused-gate && openGate)`
- [x] 4.3 Render disabled items with `sidebar__item--disabled` class, `aria-disabled="true"`, `tabIndex={-1}`, and a `title` tooltip per item ("Attach a repo first" / "No active runs" / "No gates awaiting review" / "Coming soon")
- [x] 4.4 Add `sidebar__item--disabled` CSS in `ui/src/components/primitives/Sidebar.css`: `opacity: 0.4; cursor: not-allowed; pointer-events: none;`
- [x] 4.5 Lower-section items (`History` / `Skills` / `Rules` / `Settings`) always render disabled in this change with "Coming soon" tooltip
- [x] 4.6 Update `ui/src/App.tsx`'s sidebar wiring to pass the new callbacks and state

## 5. UI: Start feature CTA on Dashboard TopBar (capability: web-ui)

- [x] 5.1 Restore `onStartFeature` prop on `DashboardProps`; pass through to TopBar
- [x] 5.2 App passes a wrapper that opens the project picker (or auto-selects) based on `projects.length`
- [x] 5.3 When `projects.length === 0`, the TopBar's Start feature button is hidden (TopBar already gates on prop presence)

## 6. UI: project picker modal (capability: web-ui)

- [x] 6.1 Create `ui/src/components/Picker/ProjectPicker.tsx` and `ProjectPicker.css`
- [x] 6.2 Props: `projects: Project[]`, `onPick(projectId)`, `onCancel()`
- [x] 6.3 Modal overlay with backdrop click → cancel; `Esc` → cancel; arrow keys + Enter to select
- [x] 6.4 List items: project name (left) + path in mono font (right); hover highlight; click → `onPick(p.id)`
- [x] 6.5 In App: `pickerOpen: boolean` state; `openPicker()` opens it; on pick, set `projectId` + route to `kickoff`; on cancel, close

## 7. UI: recent runs panel on Dashboard (capability: web-ui)

- [x] 7.1 Create `ui/src/components/Dashboard/RecentRunsPanel.tsx` and `.css`; receives `runs: Run[]`, `projects: Project[]`, `onOpenRun(id)`
- [x] 7.2 Slice top 5 by `createdAt` desc; resolve project name via `projects.find(p => p.id === run.projectId)?.name ?? '(unknown)'`
- [x] 7.3 Row layout: status chip, project name, prompt summary (60-char ellipsised), relative age (e.g. "4m ago")
- [x] 7.4 Add a relative-time helper in `ui/src/util/time.ts` (no library — vanilla, returns "Xs/m/h/d ago")
- [x] 7.5 Empty state: "No runs yet — start a feature from any project."
- [x] 7.6 Replace `STATIC_FEED` block in `Dashboard.tsx` with `<RecentRunsPanel ... />`; remove the constant and its imports
- [x] 7.7 Rename Activity card header to "Recent runs", drop "last 2h"

## 8. UI: directory-browser modal (capability: web-ui)

- [x] 8.1 Add `api.browseFs(path: string)` in `ui/src/api/client.ts` → calls `GET /api/fs/browse?path=<encoded>`
- [x] 8.2 Create `ui/src/components/Attach/AttachRepoModal.tsx` and `.css`
- [x] 8.3 Props: `onPick(absolutePath)`, `onCancel()`
- [x] 8.4 Internal state: `cwd`, `entries`, `loading`, `error`, `pastePath`
- [x] 8.5 On mount, fetch `homedir()`-equivalent (the server returns `parent: null` at FS root and includes `cwd` on each response, so initial call uses no `path` query — server defaults to `homedir()` when missing-but-not-required)
   - Update server route §1: when `path` query is omitted, default to the server's `homedir()` and treat that as a valid (not-400) call
- [x] 8.6 Breadcrumb at top showing segments of `cwd`; each segment clickable to navigate up
- [x] 8.7 List of entries; click → navigate into; entries with `isGitRepo: true` render with a git glyph
- [x] 8.8 Footer: `[Cancel]`, `[Paste path ▾]` (toggles inline path input + Attach), `[Use this folder]` (attaches `cwd`)
- [x] 8.9 Replace the existing inline attach `<form>` in `Dashboard.tsx` with a button that opens `AttachRepoModal`; on pick, call `api.createWorkspace({ root: absolutePath })`, close modal, refresh projects
- [x] 8.10 Empty state and 403/404 error rendering inline (do not collapse the modal)

## 9. Integration tests

- [x] 9.1 `server/src/registry/__tests__/fs-browser.test.ts` — see 1.5
- [x] 9.2 Add a test that `GET /api/runs` includes `openGate` for runs in `paused-gate`, and `null` otherwise
- [x] 9.3 Add a smoke test that hitting `/api/fs/browse` with no query returns `homedir()` listing

## 10. Manual QA on a fresh DB

- [x] 10.1 Delete `~/.bosch-sdlc/state.db`, start dev server, confirm Dashboard renders empty state
- [x] 10.2 Click "Attach your first repo" → directory modal opens at `~`
- [x] 10.3 Navigate into a real repo, "Use this folder" → repo appears in Dashboard
- [x] 10.4 Sidebar "Project · health" and "Start feature" enable; rest stay disabled with tooltips
- [x] 10.5 Click sidebar "Start feature" with one project → routes directly to Kickoff
- [x] 10.6 Attach a second repo, click sidebar "Start feature" → picker modal lists both
- [x] 10.7 Start a feature run → sidebar "Active run" enables, routes to current run
- [x] 10.8 Pause+gate a run (via the workflow) → sidebar "Review gate" enables, routes to gate
- [x] 10.9 Lower sidebar items always disabled, tooltip on hover shows "Coming soon"
- [x] 10.10 Dashboard "Recent runs" panel shows the 5 latest with clickable rows
