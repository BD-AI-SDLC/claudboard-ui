## Why

The Kickoff ("Start a feature") page shows a live preview line meant to tell the user what the run will do with their repo:

```
→ branch: feature/MEAS-NNNN/new-feature
```

The project-key segment (`MEAS`) is a hardcoded string literal in `ui/src/components/Kickoff/Kickoff.tsx:188`. It shows on every repo, regardless of that repo's actual configuration. A user looking at this preview is told "this run will land on a branch in the MEAS Jira project" — which is wrong for every repo whose tracker isn't MEAS. The preview lies, which is worse than the preview being absent.

The real source of truth for "what project key does this repo use?" already lives on disk: each repo's `.claude/skills/feature-workflow/config.json` carries `jira.projectKey` (when `tracker: 'jira'`) or `tr.projectKey` (when `tracker: 'tr'`). The server already opens that exact file on every `getRepo` call — `server/src/registry/project-config.ts:readDefaultAutonomy` reads it to extract `clarify.defaultAutonomy` and throws the rest away. This change keeps the file-open, also extracts the tracker's project key, surfaces it through the `Repo` protocol type, and renders it in the preview.

The preview's other dynamic parts (`{slug}`, the autonomy line, the repo path) are already wired through correctly. This change finishes the job for the project-key segment only. The trailing `NNNN` placeholder stays as the literal string `NNNN` — a real ticket number isn't known until the run actually creates the Jira issue, and predicting it would be racy and dishonest.

Scope-bounded deliberately:

- The fake `RECENT_RUNS` array (Kickoff.tsx lines 30-34) is left untouched. It is a separate dead-scaffolding problem and warrants its own change.
- The branch type (`feature/`) stays hardcoded. The Kickoff page is literally named "Start a feature" so this is consistent; if/when bugfix/hotfix start-flows ship, that becomes its own change.

## What Changes

### Protocol (`@bosch-sdlc/protocol`)

- Extend `Repo` in `protocol/src/types.ts` with a new optional field:
  ```ts
  /**
   * Project key resolved from this repo's `.claude/skills/feature-workflow/config.json`.
   * - `null` when the file is missing, unparseable, or has no tracker config.
   * - `null` when the active tracker's `projectKey` is missing, the sentinel `__stub__`,
   *   or any string starting with `[TODO:` (the un-substituted template value).
   * - Otherwise the literal key as configured (e.g. `"PLAT"`, `"MEAS"`).
   *
   * The UI's Kickoff preview uses this to render the branch line; when `null`, the UI
   * renders a placeholder string instead of inventing a fake project key.
   */
  featureWorkflowProjectKey: string | null
  ```
  Field name is flat (`featureWorkflowProjectKey`) rather than nested (`featureWorkflow: { projectKey }`) to leave room for later additions without forcing the consumer to handle nested optionality on every access; later additions can be promoted to a nested shape if more than one field appears.

### Server (`server/src/registry/project-config.ts`)

- Add a sibling reader `readFeatureWorkflowProjectKey(repoPath: string): string | null`:
  - `existsSync` guard the same `config.json` path that `readDefaultAutonomy` already reads.
  - `try`/`catch` the JSON parse; log a `console.warn` and return `null` on parse failure (same pattern as `readDefaultAutonomy`).
  - Read top-level `tracker` field — accept only the literals `"jira"` and `"tr"`; anything else returns `null`.
  - When `tracker === "jira"`, read `jira.projectKey`; when `tracker === "tr"`, read `tr.projectKey`.
  - Filter the resolved value: must be a non-empty string, must not equal `"__stub__"`, must not start with `"[TODO:"`. Failing any filter returns `null`.
- Extend `mapRepoRow` to populate `featureWorkflowProjectKey: readFeatureWorkflowProjectKey(row.path)`.
- The shared JSON parse is deliberately NOT factored out yet. Two callers (`readDefaultAutonomy`, `readFeatureWorkflowProjectKey`) opening the same file is cheap and clearer than a layered cache. If a third reader is added, refactor at that point.

### UI (`ui/src/components/Kickoff/Kickoff.tsx`)

- Replace the literal `MEAS` on line 188 with a derived value:
  ```tsx
  const keyDisplay = project?.featureWorkflowProjectKey ?? '<project key>'
  // ...
  <div>→ branch: <span style={{ color: 'var(--teal)' }}>feature/{keyDisplay}-NNNN/{slug}</span></div>
  ```
- When `keyDisplay` is the placeholder `<project key>`, render it in the muted color (`var(--muted)`) instead of teal, so the UI visibly signals "this is a placeholder, not a real value."
- No new copy, no link to setup, no hint card. The visual change (muted color + literal `<project key>` text) is the only signal in this change; an actionable setup-link is a follow-up if users actually report not knowing what to do.

### Tests

- New unit tests for `readFeatureWorkflowProjectKey` covering: missing file, malformed JSON, missing tracker, unknown tracker, jira+real key, jira+`__stub__`, jira+`[TODO:` prefix, jira+empty string, jira+missing `projectKey`, tr+real key, tr+missing key.
- Extend Kickoff tests (or add a new one) to cover the rendered branch line for two cases: repo with a configured key renders `feature/PLAT-NNNN/<slug>`; repo without renders `feature/<project key>-NNNN/<slug>` in muted style.

### Out of scope

- The `RECENT_RUNS` fake-data fixture on lines 30-34.
- Branch type selection (always `feature/`).
- Surfacing other config fields (`branchPattern`, `branchTypes`, cloudId, urlBase, etc.).
- Any new endpoint or any change to the WorkflowForm.tsx setup screen.
