## 1. Protocol: extend Repo with featureWorkflowProjectKey

- [ ] 1.1 In `protocol/src/types.ts`, add `featureWorkflowProjectKey: string | null` to the `Repo` interface. Include the JSDoc block from proposal.md describing the three null cases (file missing, key missing/stub/TODO, unknown tracker).
- [ ] 1.2 Re-export is not required (the interface is exported and `index.ts` re-exports `types.ts` types via the existing wildcard). Verify by grepping for the existing `Repo` re-export pattern.
- [ ] 1.3 Build the protocol package: `npm run build -w protocol`. Confirm zero type errors.

## 2. Server: readFeatureWorkflowProjectKey + mapRepoRow wiring

- [ ] 2.1 In `server/src/registry/project-config.ts`, add a sibling exported function:
  ```ts
  export function readFeatureWorkflowProjectKey(repoPath: string): string | null
  ```
  Steps:
  - `existsSync` guard on `join(repoPath, '.claude', 'skills', 'feature-workflow', 'config.json')`. Return `null` when absent.
  - Try-parse the file as JSON; on parse failure, `console.warn` (matching the existing `readDefaultAutonomy` log style) and return `null`.
  - Read top-level `tracker`. Reject anything other than the literal strings `"jira"` or `"tr"` (return `null`).
  - For `tracker === "jira"`: read `parsed.jira?.projectKey`. For `tracker === "tr"`: read `parsed.tr?.projectKey`.
  - Filter the result through `isRealKey`: must be a non-empty string, must not equal `"__stub__"`, must not start with `"[TODO:"`. On any filter failure, return `null`. Otherwise return the string verbatim.
- [ ] 2.2 Extend `mapRepoRow` in the same file to populate the new field:
  ```ts
  featureWorkflowProjectKey: readFeatureWorkflowProjectKey(row.path),
  ```
- [ ] 2.3 Add `server/src/registry/__tests__/project-config.test.ts` (or extend existing if present) covering `readFeatureWorkflowProjectKey`:
  - missing config file → `null`
  - file with invalid JSON → `null` (also asserts warn was called)
  - tracker missing → `null`
  - tracker `"github"` (invalid) → `null`
  - tracker `"jira"` + `jira.projectKey = "PLAT"` → `"PLAT"`
  - tracker `"jira"` + `jira.projectKey = "__stub__"` → `null`
  - tracker `"jira"` + `jira.projectKey = "[TODO: JIRA_PROJECT_KEY]"` → `null`
  - tracker `"jira"` + `jira.projectKey = ""` → `null`
  - tracker `"jira"` + `jira` block missing entirely → `null`
  - tracker `"tr"` + `tr.projectKey = "FOO-PROJECT"` → `"FOO-PROJECT"`
  - tracker `"tr"` + `tr.projectKey` missing → `null`
  - tests use a `tmpdir`-style temporary repo path with the config file written in-test; mirror whatever fixture pattern is already used in `server/src/registry/__tests__/` (read the dir first to match convention).
- [ ] 2.4 Build the server package: `npm run build -w server`. Run `npm run typecheck -w server` and `npm run lint -w server`. Run the new tests: `npm run test -w server`.

## 3. UI: render real project key in the Kickoff preview

- [ ] 3.1 In `ui/src/components/Kickoff/Kickoff.tsx`, derive a `keyDisplay` value above the JSX return:
  ```ts
  const projectKey = project?.featureWorkflowProjectKey ?? null
  const keyDisplay = projectKey ?? '<project key>'
  const keyColor = projectKey ? 'var(--teal)' : 'var(--muted)'
  ```
- [ ] 3.2 Replace line 188 (the branch preview row). Currently:
  ```tsx
  <div>→ branch: <span style={{ color: 'var(--teal)' }}>feature/MEAS-NNNN/{slug}</span></div>
  ```
  Becomes:
  ```tsx
  <div>→ branch: <span style={{ color: keyColor }}>feature/{keyDisplay}-NNNN/{slug}</span></div>
  ```
- [ ] 3.3 No other lines in the preview change. The autonomy line, repo line, phases line, and slug derivation remain as they are.
- [ ] 3.4 Extend `ui/src/components/Kickoff/Kickoff.test.tsx` (or add it if missing) with two cases:
  - Mock `api.getRepo` to return a repo with `featureWorkflowProjectKey: "PLAT"`. Assert the preview text contains `feature/PLAT-NNNN/new-feature` (with the default empty-prompt slug fallback). Assert the span's inline color is `var(--teal)`.
  - Mock `api.getRepo` to return a repo with `featureWorkflowProjectKey: null`. Assert the preview text contains `feature/<project key>-NNNN/new-feature`. Assert the span's inline color is `var(--muted)`.
  - Mirror whatever mocking pattern is used in sibling component tests (`ui/src/components/Kickoff/` neighbours, or the broader `ui/src/components/` test set). Read the dir first.
- [ ] 3.5 Build the UI package: `npm run build -w ui`. Run `npm run typecheck -w ui` and `npm run lint -w ui` (lint includes the CSS prefix check). Run the UI tests: `npm run test -w ui`.

## 4. Full-stack verification

- [ ] 4.1 From repo root, run `npm run typecheck && npm run lint && npm test`. All three commands must pass before the PR is opened.
- [ ] 4.2 Manual verification using `/run`:
  - Start the app: `node server/dist/bin.js`.
  - Open the Kickoff page for a repo whose `.claude/skills/feature-workflow/config.json` has a real `jira.projectKey`. Confirm the branch line shows `feature/<that-key>-NNNN/<slug>` and updates the slug live as the prompt is typed.
  - Open the Kickoff page for a repo that has no config file (or one whose `jira.projectKey` is still the `[TODO: …]` template). Confirm the branch line shows `feature/<project key>-NNNN/<slug>` and the `<project key>` text is rendered in the muted color (visually distinct from the teal text on a configured repo).
  - Confirm no other preview line changed.

## 5. PR

- [ ] 5.1 Open the PR titled `feat(ui): kickoff preview shows real project key from feature-workflow config`. Body references this change directory.
- [ ] 5.2 Link the proposal directory in the PR description so the reviewer can find the design rationale without digging.
