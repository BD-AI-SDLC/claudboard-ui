## MODIFIED Requirements

### Requirement: Sidebar smart-target navigation

Sidebar navigation items that target a screen requiring a `projectId`, `runId`, or `gateId` SHALL be enabled only when a sensible default target exists, and SHALL be visibly disabled with an explanatory tooltip otherwise. Enabled clicks SHALL smart-pick the target according to a documented rule per item.

| Item | Enabled when | Smart target | Disabled tooltip |
|---|---|---|---|
| Overview | always | dashboard | n/a |
| Project · health | ≥1 active project | last-visited project if still active, else first by `createdAt` | "Attach a repo first" |
| Start feature | ≥1 active project AND ≥1 active project has `foundationExists(prereqs) === true` | last-visited project if foundation-ready, else first foundation-ready project (insertion order) | "Attach a repo first" when 0 projects; "Complete foundation setup on at least one project first" when projects exist but none is foundation-ready |
| Active run | ≥1 run with status `running` or `paused-user` | most recent by `createdAt` desc | "No active runs" |
| Review gate | ≥1 run with status `paused-gate` and a non-null `openGate` | oldest open gate by `createdAt` asc | "No gates awaiting review" |

The "Start feature" smart-target rule explicitly differs from "Project · health" in two ways:

- "Project · health" is the diagnostic surface for an active repo and is meaningful for foundation-incomplete repos (the page exists in large part to help complete the foundation). Any active repo is a valid target.
- "Start feature" navigates to Kickoff, which requires a foundation-ready repo. Even when `lastVisitedRepoId` points at an active-but-unprepared repo, the smart target SHALL prefer a foundation-ready repo elsewhere in the workspace rather than navigating to the unprepared one.

The enablement check and the smart-target check use the same predicate (`foundationExists` from `setup-utils.ts`). The Sidebar SHALL NOT inline a separate copy of this predicate; it SHALL import the shared helper.

#### Scenario: Disabled sidebar item does not navigate

- **WHEN** the user clicks a disabled sidebar item
- **THEN** no route change occurs and no callback fires; the item's `aria-disabled` attribute is `"true"` and `pointer-events` is `none` in CSS

#### Scenario: Tooltip surfaces reason

- **WHEN** the user hovers a disabled sidebar item
- **THEN** the browser-native `title` attribute reveals the documented per-item reason text

#### Scenario: Sidebar "Active run" jumps to the latest active run

- **WHEN** there is one run with status `running` (id `r1`, `createdAt = T`) and one with status `paused-gate` (id `r2`, `createdAt = T-10m`)
- **THEN** clicking sidebar "Active run" navigates to `/run` with `runId = r1` (paused-gate is not eligible for this item)

#### Scenario: Sidebar "Review gate" jumps to the oldest open gate

- **WHEN** there are two runs with status `paused-gate`, with open gates created at T-30m and T-5m
- **THEN** clicking sidebar "Review gate" navigates to `/gate` with the T-30m gate

#### Scenario: Sidebar items react to state changes

- **WHEN** the user attaches their first repo
- **THEN** the sidebar "Project · health" item transitions from disabled to enabled without a page reload
- **AND** the sidebar "Start feature" item remains disabled with tooltip "Complete foundation setup on at least one project first" until at least one repo achieves `foundationExists`

#### Scenario: Sidebar "Start feature" enables when foundation is present

- **GIVEN** one active project `r1` whose `prereqs` satisfies `foundationExists` (states `done` or `stale` for every foundation op)
- **WHEN** the sidebar renders
- **THEN** the "Start feature" item is enabled
- **AND** clicking it navigates to Kickoff with `repoId = r1`

#### Scenario: Sidebar "Start feature" prefers a ready repo over an unready last-visited

- **GIVEN** two active projects: `r1` (last-visited, foundation MISSING) and `r2` (foundation-ready)
- **WHEN** the sidebar renders and the user clicks "Start feature"
- **THEN** navigation goes to Kickoff with `repoId = r2`, NOT `r1`

#### Scenario: Sidebar "Start feature" stays enabled when last-visited is ready

- **GIVEN** two active projects: `r1` (last-visited, foundation-ready) and `r2` (foundation-ready)
- **WHEN** the sidebar renders and the user clicks "Start feature"
- **THEN** navigation goes to Kickoff with `repoId = r1` (last-visited preference applies when the candidate is ready)

#### Scenario: Sidebar "Start feature" disables when no repo is ready

- **GIVEN** two active projects, neither of which satisfies `foundationExists`
- **WHEN** the sidebar renders
- **THEN** the "Start feature" item is disabled with tooltip "Complete foundation setup on at least one project first"

### Requirement: Dashboard Start-feature CTA with smart project selection

The Dashboard TopBar SHALL render a "Start feature" CTA whose visibility and enablement depend on the workspace state:

- **0 active projects**: the CTA SHALL NOT be rendered. The Dashboard's empty-state ("Attach your first repo") is the primary action.
- **≥1 active project, none with `foundationExists(prereqs) === true`**: the CTA SHALL render as disabled, with a lock affordance and tooltip "Foundation is missing — run setup first".
- **≥1 active project AND ≥1 with `foundationExists(prereqs) === true`**: the CTA SHALL render as enabled (rocket affordance).

When enabled and clicked, the CTA SHALL navigate to the Kickoff screen with a smart-selected target repo:

1. The user's last-visited repo IF it satisfies `foundationExists`, else
2. The first foundation-ready repo in `repos` (insertion order).

This rule matches the Sidebar "Start feature" smart-target rule so that both entry points navigate consistently from the same workspace state.

A future multi-project picker modal (described in the prior version of this requirement) MAY replace the smart-pick behaviour for `N ≥ 2` projects; until that modal ships, the smart-pick rule above is authoritative. Documenting both side-by-side here would invite divergence; the picker SHALL be specified in its own change.

#### Scenario: Single foundation-ready project auto-selects

- **GIVEN** the workspace contains exactly one active project AND it is foundation-ready
- **WHEN** the user clicks the Dashboard TopBar "Start feature" CTA
- **THEN** the app navigates to the Kickoff screen with that project's id pre-selected

#### Scenario: Multiple projects, only one ready — ready repo is selected

- **GIVEN** the workspace contains two active projects: `r1` (foundation MISSING, last-visited) and `r2` (foundation-ready)
- **WHEN** the user clicks the Dashboard TopBar "Start feature" CTA
- **THEN** the app navigates to Kickoff with `repoId = r2`

#### Scenario: Multiple ready projects — last-visited takes precedence

- **GIVEN** the workspace contains two foundation-ready active projects: `r1` (last-visited) and `r2`
- **WHEN** the user clicks the Dashboard TopBar "Start feature" CTA
- **THEN** the app navigates to Kickoff with `repoId = r1`

#### Scenario: No foundation-ready project — CTA disabled

- **GIVEN** the workspace contains one or more active projects, none of which satisfies `foundationExists`
- **WHEN** the user views the Dashboard
- **THEN** the "Start feature" CTA is rendered as disabled with a lock affordance and the tooltip "Foundation is missing — run setup first"
- **AND** clicking it has no effect (no route change, no callback fires)
