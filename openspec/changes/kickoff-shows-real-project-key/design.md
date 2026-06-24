## Context

The Kickoff page renders a live preview of what `/start-feature` will do with the user's input. Three of four lines in that preview are already dynamic — the repo path, the autonomy, the phase count all derive from real state. The fourth, the branch line, is hardcoded with the literal string `MEAS-NNNN`. The lie is harmless in dev when the developer happens to be working on a MEAS-project repo and never notices, and visible the moment any other repo is opened.

The data needed to render the line truthfully already exists on disk and is already read once per `getRepo` call. The server's `readDefaultAutonomy` opens `<repo>/.claude/skills/feature-workflow/config.json`, extracts one field, and discards the rest. The change is therefore narrow: read one more field from the same parsed JSON, plumb it through one new field on `Repo`, render it in one component.

## Goals / Non-Goals

**Goals:**
- The Kickoff branch preview SHALL display the project key configured for the user's repo when one is set.
- When no project key is configured, the preview SHALL render a visible placeholder (`<project key>`) in a muted style — never a fabricated key.
- The protocol's `Repo` shape SHALL carry the resolved project key as a wire-level optional, with `null` as the unambiguous "not configured" value.
- The server-side resolver SHALL respect the configured `tracker` (`jira` vs `tr`) and read the corresponding project key.

**Non-Goals:**
- Touching the `RECENT_RUNS` fake-data fixture on Kickoff.tsx lines 30-34.
- Adding a branch-type selector. The preview stays `feature/...`; this screen is "Start a feature".
- Predicting the real ticket number that Jira/T&R will assign. The literal placeholder `NNNN` is preserved.
- Surfacing other config fields (`branchPattern`, `cloudId`, `urlBase`, GitHub fields, customFields). They remain server-only.
- Adding a setup-link CTA inside the preview when the key is missing. The placeholder + muted style is the only signal in this change.
- Adding any new HTTP endpoint or any change to the WorkflowForm setup screen.
- Caching the per-repo config parse. The two readers each open and parse the file independently per `getRepo` call. This is consistent with the existing reader and cheap at current call volumes.

## Decisions

### D1: `featureWorkflowProjectKey` lives flat on `Repo`, not nested

The Repo shape on the wire grows by exactly one optional field. The nested shape (`featureWorkflow: { projectKey: string | null } | null`) requires consumers to handle outer-null and inner-null separately on every read, which is friction for one field. A flat `featureWorkflowProjectKey: string | null` collapses both "config file missing" and "key not configured" into a single null check — which is what the consuming UI actually wants.

When (and only when) a second sibling field appears (`branchPattern`, branch-types, tracker name for display), promote both fields together into a nested `featureWorkflow: { projectKey, ... } | null` shape in one change. Until then, flat is honest.

### D2: Three "not configured" states collapse to `null`

Reading the config file can leave the resolved key as any of:
- `undefined` — the `jira` or `tr` block isn't present at all
- `"__stub__"` — the deliberately-skipped form sentinel (`stubbableString` in `protocol/src/claudboard/common.ts`)
- `"[TODO: JIRA_PROJECT_KEY]"` — the un-substituted template literal in the default config
- empty string — degenerate but possible if hand-edited

All four cases mean the same thing to the UI: "no project key to show." The resolver returns `null` for all of them. The UI does not distinguish between "form-stub" and "template-default" and "missing block" — those are setup-state distinctions, not preview-state distinctions, and live elsewhere (the WorkflowForm and the prereq machinery).

### D3: `null` versus empty string on the wire

`null` is chosen over `""` to match `protocol-conventions.md` ("Use `T | null` instead of `T | undefined` for nullable fields — aligns with SQLite NULL mapping") and to keep the UI's null-coalescing read (`?? '<project key>'`) trivial. Empty string would be a "present but empty" signal the resolver never emits.

### D4: Placeholder text is `<project key>` rendered muted, not `—`

The Kickoff page already uses `—` for the repo path when project is not loaded yet (line 187: `{project?.path ?? '—'}`). That `—` means "data not yet loaded" — a transient state. For the project key, `null` means "no value is configured" — a stable state with a clear remediation (set up the workflow config). Using the same `—` glyph would conflate transient-loading with stable-unconfigured.

`<project key>` is the conventional placeholder shape (matches Markdown angle-brackets, matches the convention used inside the config file's own template literals like `[TODO: JIRA_PROJECT_KEY]`). The muted color (`var(--muted)`) carries the "this isn't real" signal visually. No additional copy, no hint card, no link — those are follow-ups if usage data shows users don't understand the placeholder.

### D5: Tracker resolution is "first match by literal", not "fall back across trackers"

When `tracker: "jira"`, only `jira.projectKey` is consulted. When `tracker: "tr"`, only `tr.projectKey` is consulted. The resolver does NOT try `jira` then fall back to `tr` (or vice versa). The `tracker` field is the source of truth for "which key is the real one for this repo"; falling back would produce the same lying-preview problem in a different shape (showing a Jira key on a repo whose tracker is T&R).

Unknown tracker values, missing tracker, or any tracker value not in `{"jira","tr"}` returns `null`. This is conservative: a new tracker added in the future will produce a placeholder preview until the resolver is updated, which is the right failure mode.

### D6: No shared JSON parse helper, yet

`readDefaultAutonomy` and the new `readFeatureWorkflowProjectKey` will each `readFileSync` + `JSON.parse` the same file on the same `getRepo` call. A reasonable instinct is to factor out a `loadFeatureWorkflowConfig(repoPath)` helper that returns the parsed object and is called once.

That refactor is deferred. Two motivations:
- The current call volume (one per repo fetch, never on a hot path) makes the duplicate I/O cost a non-issue.
- Sharing the parse forces a shared type — at which point a JSON schema is the right abstraction, and at which point the right answer is probably a Zod schema in `protocol/src/claudboard/` (paralleling the existing `workflow.ts` schema, which is for the *input* side of the form). That is its own change with its own scope. Coupling it to this one would obscure the simple field-plumbing this change actually delivers.

When the third reader is added, that's the trigger to factor out a shared parse and probably promote it to a typed Zod load.

### D7: The UI does not call any new endpoint

The new field rides on the existing `GET /api/repos/:id` and `GET /api/repos` responses (both already shaped by `mapRepoRow`). No new client method, no new server route. This is intentional — adding a dedicated endpoint for one optional string would expand the API surface for no win.

### D8: Test coverage shape

The resolver has more interesting branches than the UI render. Tests bias accordingly:
- Server: thorough table-driven unit tests on `readFeatureWorkflowProjectKey` — one assertion per real/sentinel/missing case. These pin down D2 and D5 as testable contracts.
- UI: two-case Kickoff render test — one with a key, one without. Verifies the rendered text, color class, and that the slug remains dynamic. No need for an exhaustive cross-product; the resolver already covers the value space.

## Risks / Trade-offs

- **Schema growth on `Repo`.** Adding a field to `Repo` ripples through every server response that returns one and every UI consumer that types one. Tracked in tasks; the build will surface anything missed.
- **Stale state.** The config file is read fresh on each `getRepo` call, so edits propagate immediately. There is no caching to invalidate. If a future caching layer is added at the registry level, the cache key must include the file's mtime.
- **Confusing UX when the placeholder shows.** A user may see `feature/<project key>-NNNN/<slug>` and not know what to do. Acceptable risk: this change preserves the truth ("no key configured"); the actionable next step (set it up) is a follow-up surface to design separately.
- **Two-reader duplication.** Per D6, deferred. Documented so the next reviewer who notices the pattern doesn't refactor it without scope.
