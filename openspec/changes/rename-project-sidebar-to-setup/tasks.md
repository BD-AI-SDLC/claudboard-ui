## 1. UI: rename the sidebar label

- [x] 1.1 In `ui/src/components/primitives/Sidebar.tsx`, locate the `navItems` array (currently around line 83). On the item with `id: 'project'` (currently line 92–98), change `label: 'Project · health'` to `label: 'Project setup'`. No other field changes — `id`, `icon`, `enabled`, `tooltip`, and `handler` stay exactly as they are. The route target is unchanged.
- [x] 1.2 Before saving, grep the workspace for any other live reference to the old label so the rename does not leak:
  ```bash
  grep -rn "Project · health" ui/ server/ protocol/
  ```
  Expected matches after step 1.1: zero hits inside `ui/src/**` outside `Sidebar.tsx` itself, zero hits in `server/` or `protocol/`. (Static design HTML under `ui/designs/*.html` is frozen reference material and is out of scope — see proposal "Out of scope". If a match shows up there, ignore it.)

## 2. UI: update the existing test assertion

- [x] 2.1 In `ui/src/components/primitives/Sidebar.test.tsx`, locate the existing positive assertion (currently line 30):
  ```ts
  expect(screen.getByText('Project · health')).toBeTruthy()
  ```
  Change the string literal to `'Project setup'`. No other test in the file references this label; no new test case is added.
- [x] 2.2 Do NOT add a negative assertion against the old string. Per `design.md` D4, the existing positive assertion is the guardrail — it fails clearly if the rename is reverted, and a separate negative would diverge from the file's positive-only convention without buying coverage.

## 3. Spec: update the canonical web-ui spec

- [x] 3.1 In `openspec/specs/web-ui/spec.md`, the requirement currently titled `Sidebar items are context-aware` (around line 555) contains a smart-target table and a "Sidebar items react to state changes" scenario that both name the old label. Apply two textual edits:
  - Table row (currently line 561): `| Project · health | ≥1 active project | last-visited project if still active, else first by `createdAt` | "Attach a repo first" |` → `| Project setup | ≥1 active project | last-visited project if still active, else first by `createdAt` | "Attach a repo first" |`. Columns 2–4 are unchanged.
  - Scenario sentence (currently line 591): `- **THEN** the sidebar "Project · health" and "Start feature" items transition from disabled to enabled without a page reload` → `- **THEN** the sidebar "Project setup" and "Start feature" items transition from disabled to enabled without a page reload`. The surrounding scenario header and `WHEN` line are unchanged.
- [x] 3.2 Re-read the surrounding requirement (the full block between `### Requirement: Sidebar items are context-aware` and the next `### Requirement:` heading) and confirm no third reference to "Project · health" remains. A grep over the whole spec file is the simplest backstop:
  ```bash
  grep -n "Project · health" openspec/specs/web-ui/spec.md
  ```
  Expected: zero matches after the two edits above.
- [x] 3.3 The change's own delta lives in `openspec/changes/rename-project-sidebar-to-setup/specs/web-ui/spec.md` and was authored as part of the proposal. No further edits to that file are needed during implementation — it documents the contract change; step 3.1 actually applies it to the canonical spec.

## 4. Verification

- [x] 4.1 From repo root: `npm run typecheck -w ui && npm run lint -w ui && npm run test -w ui`. Typecheck PASS. Lint PASS (or pre-existing failures only — verify by stashing this change and re-running lint; any failure present on a clean `main` is not introduced here). Tests PASS, with the Sidebar test now asserting the new label.
- [x] 4.2 From repo root: `npm run build`. PASS — only the UI bundle should rebuild meaningfully; protocol and server are untouched.
- [x] 4.3 Manual verification using the `launch-app` skill. Confirm:
  - The Workflow sidebar renders five entries; the second one reads `Project setup`.
  - Clicking it routes to the same `Project` view as before (the foundation / maintenance dashboard).
  - When no project is attached, the entry is disabled with the unchanged tooltip "Attach a repo first".
  - The icon (shield) is unchanged.
  - The other four entries (Overview, Start feature, Active run, Review gate) are unchanged in label and behaviour.

## 5. PR

- [ ] 5.1 The branch was cut off `main` per the per-change branching rule before the proposal was written (`chore/rename-project-sidebar-to-setup`). Do NOT bundle this change with any other in-flight OpenSpec change.
- [ ] 5.2 Commit using Conventional Commits. Suggested message:
  ```
  chore(ui): rename sidebar "Project · health" to "Project setup"
  ```
  Body: one-line note that this aligns the label with what the routed page actually contains (foundation setup + maintenance), and references this OpenSpec change directory.
- [ ] 5.3 Open the PR with the same title. Body links `openspec/changes/rename-project-sidebar-to-setup/` and notes that the in-flight `hydrate-repo-prereqs` and `foundation-ops-as-one-shot` changes carry the old label in their own deltas and will be updated on their next iteration (no coordination commit needed here).
- [ ] 5.4 After merge, archive the change directory under `openspec/changes/archive/<YYYY-MM-DD>-rename-project-sidebar-to-setup/` per the project's archival convention (or use the `openspec-archive-change` skill). The canonical spec edit from §3 is the live promotion; archiving is metadata-only.
