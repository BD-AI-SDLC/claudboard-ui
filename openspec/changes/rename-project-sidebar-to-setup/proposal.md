## Why

The Workflow sidebar carries five entries. Four are single-noun labels — **Overview**, **Start feature**, **Active run**, **Review gate**. The fifth, **Project · health**, is the only one with the `Foo · bar` shape and the only one whose label diverges from what the page it routes to actually does.

The label is a holdover. It was coined when the page was envisioned as a "project health dashboard"; in practice the page (`ui/src/components/Project/Project.tsx`) is the place a user lands to **set up and maintain a project's foundation**:

- `SetupBanner` + `FoundationChain` — the analyse → generate → workflow onboarding chain.
- `MaintenanceGrid` — re-run individual prereqs.
- `PrereqInterview` — the CLI-driven interactive prereq flow when a step is mid-question.
- `DeleteRepoModal` trigger — destructive project ops.

Almost everything on the page is setup or repair-of-setup. "Health" telegraphs diagnostics; what users actually do here is **finish the setup their project needs to become run-ready**. The label mis-sets the expectation on first click and re-mis-sets it every time a new contributor reads the sidebar.

A second smaller cost: the `Foo · bar` shape is unique in the sidebar. The middle dot reads as "the page's *health* aspect of the *Project*" — a sub-noun decomposition that implies a sibling ("Project · settings", "Project · history") which doesn't and won't exist in this part of the IA. Renaming to a flat `Project setup` matches every other sidebar entry's shape and stops implying a sibling tree that isn't there.

This change is deliberately narrow: rename the label, update the spec text that names it, and add nothing else. A prior change (`remove-coming-soon-sidebar`, design.md D-non-goals) considered this rename and declined it as "adding scope without proportionate benefit"; the difference now is that the rename is the *whole* change rather than a tangent inside a deletion, and the `Project setup` framing is grounded in what the page contains rather than in disambiguating from a section that no longer exists.

## What Changes

### UI (`ui/src/components/primitives/Sidebar.tsx`)

- In the `navItems` array (currently line 93), change the `'project'` item's `label` from `'Project · health'` to `'Project setup'`. No other field on that item changes — `id`, `icon` (`shield`), `enabled` predicate, `tooltip`, and `handler` are all unchanged. The route target (`ProjectView` rendered at `/project`) is unchanged. The sidebar's smart-target rule for this item is unchanged.

### UI (`ui/src/components/primitives/Sidebar.test.tsx`)

- Update the existing assertion at line 30 from `expect(screen.getByText('Project · health')).toBeTruthy()` to `expect(screen.getByText('Project setup')).toBeTruthy()`. No other test in the file references this label.

### Specs (`openspec/specs/web-ui/spec.md`)

Republished as a `MODIFIED Requirement` in `specs/web-ui/spec.md` of this change. Two textual touch-points in the canonical `Sidebar smart-target navigation` requirement:

- The smart-target table row (line 561 today): `| Project · health | … |` → `| Project setup | … |`. The "Enabled when", "Smart target", and "Disabled tooltip" columns are unchanged.
- The "Sidebar items react to state changes" scenario (line 591 today): the sentence "**THEN** the sidebar 'Project · health' and 'Start feature' items transition…" → "**THEN** the sidebar 'Project setup' and 'Start feature' items transition…".

No other content in the requirement changes. The smart-target rule, scenarios, and parallel reasoning about "Start feature" are all unchanged.

## Out of scope

- **Page-level UI under `/project`.** The `TopBar title={project.name}` (`Project.tsx:185`) renders the project's own name, not "Project · health". No on-page string changes. The page's content is exactly what this change is *renaming to match* — touching it would defeat the point.
- **The page's URL / route id.** The internal route id is `'project'` and the URL is `/project`. Both stay. Changing the route would force callers and bookmarks to rebreak for zero user-visible benefit.
- **The `shield` icon.** Health-coded as it is, the icon still reads as "the place that protects the project's foundation," and renaming-the-icon would be a separate visual decision that belongs in a UI/IA refresh. Keep.
- **Other label changes.** The four sibling labels are fine as they stand. This change touches one label, one test assertion, and two spec lines.
- **In-flight changes that reference `Project · health` in their own change-scoped specs** (`hydrate-repo-prereqs`, `foundation-ops-as-one-shot`). Per the agreed strategy, those rebase on next touch — they ship their existing labels and update on their next iteration rather than blocking on a rename PR. No coordination commit is needed in this change. Archived changes (under `openspec/changes/archive/`) are historical and stay untouched.
- **Renaming the `Project/` component directory or its main `Project.tsx` file** to `ProjectSetup`. The component already covers more than setup (delete-project lives there too) and the directory name reads fine without coupling to the sidebar label. A future split (e.g. extracting maintenance into its own surface) would be the right time to revisit the directory shape, not this rename.

## Out of scope (no architecture impact)

This change does not touch protocol types, DB schema, server routes, WebSocket events, MCP tools, or any test outside `Sidebar.test.tsx`. The blast radius is two production-code edits and two spec edits.
