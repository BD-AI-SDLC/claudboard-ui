## 1. Protocol: drop scope and workspaceRoot from shared types

- [x] 1.1 Remove `scopes: string[]` from `Project` in `protocol/src/types.ts`
- [x] 1.2 Remove `workspaceRoot: string | null` from `Project` in `protocol/src/types.ts`
- [x] 1.3 Remove `scope: string | null` from `Run` in `protocol/src/types.ts`
- [x] 1.4 Remove `workspaceRoot: string | null` from `Run` in `protocol/src/types.ts`
- [x] 1.5 Remove `scope?: string` and `workspaceRoot?: string` from `CreateRunRequest` in `protocol/src/types.ts`
- [x] 1.6 Run `npm run build -w protocol` and confirm no compile errors propagate to consumers (next steps will fix them)

## 2. Server registry: classifier emits one Project per workspace root

- [x] 2.1 Rewrite `server/src/registry/classifier.ts:19-32` so the multi-repo branch returns a single `ClassifiedRepo` with `path: rootDir`, `topology: 'multi-repo-workspace'` (no per-child enumeration)
- [x] 2.2 Remove `scopes: string[]` field from `ClassifiedRepo` interface (now always empty)
- [x] 2.3 Remove `workspaceRoot: string | null` field from `ClassifiedRepo` interface (now always null)
- [x] 2.4 Delete `getMonorepoScopes()` function from `server/src/registry/scanner.ts:48-63`
- [x] 2.5 Update `server/src/registry/routes.ts:33` to drop the `topology === 'monorepo' ? getMonorepoScopes(...) : []` branch; `upsertProject` is called without scopes
- [x] 2.6 Update `server/src/registry/persist.ts:19-35` so `upsertProject(workspaceId, repo)` no longer takes/writes `scopes` or `workspaceRoot`
- [x] 2.7 Update existing classifier test in `server/src/registry/__tests__/classifier.test.ts:20-31`: the "parent dir with meta-repo .claude + 2 child repos" assertion now expects `result.repos.length === 1` with `repos[0].path === '/work'` and `topology === 'multi-repo-workspace'`
- [x] 2.8 Add a new test in the same file: "parent dir with 3 child repos AND a workspace-meta child returns 1 Project at the root" (covers the Q2.b trust scenario)

## 3. Server DB: drop dead columns

- [x] 3.1 In `server/src/db.ts:38`, remove `scopes TEXT NOT NULL DEFAULT '[]'` from the `projects` table schema
- [x] 3.2 In `server/src/db.ts:39`, remove `workspace_root TEXT` from the `projects` table schema
- [x] 3.3 In `server/src/db.ts:63`, remove `scope TEXT` from the `runs` table schema
- [x] 3.4 In `server/src/db.ts:64`, remove `workspace_root TEXT` from the `runs` table schema
- [x] 3.5 Bump the schema version comment / version constant so an operator can see the schema changed
- [x] 3.6 Update `server/src/__tests__/integration.test.ts:67,90` (in-test schema mirror) to match the new columns

## 4. Server run driver: prompt builder collapses and parameters shrink

- [x] 4.1 Rewrite `server/src/run/prompt-builder.ts` so `buildPrompt(userPrompt: string)` returns exactly `\`/start-feature ${userPrompt}\`` — remove the `topology` and `scope` parameters
- [x] 4.2 Update `server/src/run/routes.ts:36` to call `buildPrompt(body.prompt)` (no topology/scope args)
- [x] 4.3 Update `server/src/run/routes.ts:42` to call `runFeature(record.id, body.target, prompt)` — no `scope`, no `workspaceRoot`
- [x] 4.4 Add a guard in `server/src/run/routes.ts` POST handler: if the request body includes `scope` or `workspaceRoot`, ignore them silently (do NOT 400 — see run-driver spec scenario "Old client sends a deprecated …")
- [x] 4.5 Update `server/src/run/record.ts:14-40` so `recordRun` no longer accepts or persists `scope` / `workspaceRoot` fields
- [x] 4.6 Update `server/src/run/driver.ts:39-45`: `runFeature(runId, target, prompt)` — remove `_scope` and `_workspaceRoot` parameters
- [x] 4.7 Verify no callers of `runFeature` still pass the removed parameters

## 5. Server prereq runner: unchanged at call sites, verified once per workspace

- [x] 5.1 Read `server/src/registry/prereqs.ts` and confirm detection reads under `project.path/.claude/` (will now resolve to the workspace root for multi-repo, via the symlink)
- [x] 5.2 Verify in `server/src/registry/routes.ts` that prereq detection is called once per upserted Project, which under the new classifier means once per workspace — no code change should be required here, just verification
- [x] 5.3 Add an integration test: scan a fixture multi-repo workspace with N children, assert exactly one Project row and one set of prereq rows are written

## 6. UI: Kickoff scope picker removed

- [x] 6.1 Delete the scope `<select>` element in `ui/src/components/Kickoff/Kickoff.tsx:87-100` (or whatever the current line range is)
- [x] 6.2 Delete the `const [scope, setScope] = useState('')` state and any `setScope` calls
- [x] 6.3 Delete the `isMonorepo` derived variable and any branches that depended on it
- [x] 6.4 Delete the `isMonorepo && scope && (<div>→ scope: …</div>)` summary line
- [x] 6.5 Update the submit handler so the POST body is `{ projectId, target, prompt }` only — no `scope`, no `workspaceRoot`
- [x] 6.6 Remove any `.kickoff__scope` CSS rules from `ui/src/components/Kickoff/Kickoff.css`

## 7. UI: protocol consumers compile after type changes

- [x] 7.1 Grep `ui/src/` for `.scope`, `.workspaceRoot`, `scopes` and update each consumer to drop the references
- [x] 7.2 If any Project card or Project view rendered `project.scopes.length` or similar, replace with topology badge per the web-ui spec scenario "Topology badge is informational"
- [x] 7.3 Run `npm run typecheck` from repo root; confirm zero errors

## 8. Spec archival prep

- [x] 8.1 Confirm `openspec validate unify-workspace-as-single-project --strict` passes (or document any acceptable warnings)
- [x] 8.2 Confirm the three spec deltas in `openspec/changes/unify-workspace-as-single-project/specs/{workspace-registry,run-driver,web-ui}/spec.md` parse without errors

## 9. Manual QA on a fresh DB

- [ ] 9.1 Delete `~/.bosch-sdlc/state.db`
- [ ] 9.2 Start the server (`npm run dev -w server`) and UI (`npm run dev -w ui`)
- [ ] 9.3 Dashboard renders empty state
- [ ] 9.4 Attach a multi-repo workspace via the directory browser (e.g. a parent dir with a meta-repo `.claude/` and 2+ child repos); confirm exactly ONE Project card appears for the workspace root, none for the children
- [ ] 9.5 Open Kickoff for the workspace Project; confirm no scope dropdown is shown
- [ ] 9.6 Submit a prompt; confirm in the browser DevTools network tab that the POST body is `{ projectId, target, prompt }` with no `scope` / `workspaceRoot`
- [ ] 9.7 In the server logs / Run view, confirm the SDK is invoked with `cwd = <workspace root>` and prompt starting `/start-feature ` with no `[scope: ...]` prefix
- [ ] 9.8 Attach a monorepo Project; confirm no scope dropdown is shown on Kickoff
- [ ] 9.9 Attach a monolith Project; confirm form behavior is identical to the monorepo case
- [ ] 9.10 Confirm topology badges render correctly on each Project card ("Workspace" / "Monorepo" / "Monolith")
- [ ] 9.11 Confirm prereq panel for the multi-repo workspace shows ONE row per prereq (analyse/generate/workflow/refresh/techdebt), not N×5

## 10. Change notes and CHANGELOG

- [x] 10.1 Add a `BREAKING` section to the change notes / repo CHANGELOG: "Schema change — delete `~/.bosch-sdlc/state.db` before upgrading. Re-attach your workspaces from the Dashboard."
- [x] 10.2 Note the protocol changes: `scope` and `workspaceRoot` removed from `Project`, `Run`, `CreateRunRequest`. Old clients sending these fields are silently tolerated.
- [x] 10.3 Note the UX change: Kickoff no longer has a scope picker for any topology.
