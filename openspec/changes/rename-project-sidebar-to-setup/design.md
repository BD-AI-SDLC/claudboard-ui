## Context

The sidebar's Workflow section has five entries. Four are single-noun labels; one ("Project · health") uses a `Foo · bar` shape and labels the page in a way that doesn't match what users do there. This change renames the label to `Project setup`. `proposal.md` carries the motivation; this document captures the design choices that aren't already obvious from "swap one string."

## Goals / Non-Goals

**Goals:**

- The sidebar nav item that routes to the `Project` view SHALL render the label `Project setup` rather than `Project · health`.
- The spec text that names this label SHALL be updated to match, so the live `web-ui` spec and the running UI stay in lockstep.
- The change SHALL be reversible by a single revert commit (one component file, one test file, one spec file).
- The change SHALL leave the item's behaviour — enablement predicate, tooltip, route handler, smart-target rule, icon — entirely unchanged.

**Non-Goals:**

- Designing or building a real "Project settings" surface. The current `/project` page is not a settings page; this change is renaming to match what the page *is*, not to seed a new surface.
- Renaming the `Project/` component directory, the `Project.tsx` component, the `'project'` route id, or the `/project` URL. None of these are user-visible the way the sidebar label is, and changing them adds scope (broken imports, breaks bookmarks) without proportionate benefit.
- Replacing the `shield` icon. The icon still reads "protect the project's foundation" plausibly enough; an icon refresh is a separate visual decision.
- Touching the other four sidebar labels. They're fine.
- Coordinating with the in-flight `hydrate-repo-prereqs` and `foundation-ops-as-one-shot` changes that reference the old label in their own change-scoped specs. Those rebase on next touch per the agreed strategy.

## Decisions

### D1: `Project setup`, not `Project settings`

The page contains the foundation-setup flow (`SetupBanner`, `FoundationChain`, `PrereqInterview`) and the maintenance-of-setup flow (`MaintenanceGrid`, re-run prereqs). The destructive op (`DeleteRepoModal`) is the only thing that arguably belongs under a "settings" framing, and it's a small slice of the page.

"Settings" carries a strong UX expectation — toggles, preferences, defaults, API keys — that this page does not deliver. A new contributor clicking `Project settings` and finding a prereq dashboard would feel mis-routed. `Project setup` matches what the page actually shows on first paint, and the maintenance-of-setup framing stays internally consistent ("setup needs upkeep").

If a real settings surface (theme defaults per repo, run defaults, API key overrides) is later built, it can take the `Project settings` label cleanly, because this rename has not consumed it.

### D2: Drop the middle dot, keep the `Project` prefix

The `Foo · bar` shape was unique to this entry and implied a sibling tree (`Project · history`, `Project · settings`, …) that the IA does not contain. Dropping the dot aligns the entry with the rest of the Workflow section's flat-noun shape.

Keeping `Project` as the leading word — rather than collapsing to a bare `Setup` — preserves the entry's scope ("the place where you set up *the project*"), which a bare `Setup` would lose. A bare `Setup` would also read ambiguously next to the install-time bootstrap setup (`SetupBanner` is used for both repo onboarding *and* CLI bootstrap on the Dashboard); the `Project` prefix narrows it.

### D3: Single canonical spec, no design impact

`openspec/specs/web-ui/spec.md` is the single authoritative source for the sidebar contract. Two text touch-points are updated (the table row and one scenario sentence). The requirement's structure, smart-target rule, parallel "Start feature" reasoning, and all other scenarios are untouched — the spec delta republishes the requirement verbatim except for the renamed string in those two places, per the OpenSpec convention for `MODIFIED Requirements`.

No new requirement is being added, no requirement removed. This is a textual edit inside an existing requirement, expressed as a `MODIFIED` block.

### D4: Update the existing assertion; do not add a new test

`Sidebar.test.tsx` already asserts the presence of every Workflow label via `screen.getByText(...)`. The right edit is to update the existing literal `'Project · health'` to `'Project setup'`, not to add a new "and does not render the old label" assertion. The reasons:

- A negative assertion against the old string is brittle: the string is not in the repo after this change, so there's nothing to guard against re-introduction other than the existing positive assertion (which fails clearly if the rename is reverted).
- The current test pattern is positive-only ("the Workflow section renders the real entries"); a one-off negative assertion would diverge from the convention without buying coverage.

### D5: In-flight changes rebase, this change does not coordinate

Three in-flight changes name the old label inside their own `specs/web-ui/spec.md` deltas: `hydrate-repo-prereqs` (multiple touch-points), `foundation-ops-as-one-shot` (smart-target table + one scenario), and `remove-coming-soon-sidebar` (mentions only, in proposal/design narrative — no spec delta).

The agreed strategy is: this rename ships first as a standalone change; each in-flight change updates its own delta on its next touch. The alternative — coordinating four PRs around one label — pays a coordination cost that the per-change branching rule explicitly avoids. The cost of the chosen strategy is small: any of those changes that lands *before* this rename will republish the old label in its own delta, which then gets superseded when the rename lands or when that change next iterates. No incorrect behaviour ships either way (the label only exists in spec text, not in any cross-file contract).

### D6: No protocol, server, DB, or WS impact

The change touches: one UI file, one UI test, one spec file. It does not change any cross-boundary type, route signature, DB column, MCP tool, or WebSocket event. The "monorepo build order" critical rule (protocol → server → ui) is not relevant — only `ui` rebuilds.
