## MODIFIED Requirements

### Requirement: Sidebar items are context-aware

Sidebar navigation items that target a screen requiring a `projectId`, `runId`, or `gateId` SHALL be enabled only when a sensible default target exists, and SHALL be visibly disabled with an explanatory tooltip otherwise. Enabled clicks SHALL smart-pick the target according to a documented rule per item.

| Item | Enabled when | Smart target | Disabled tooltip |
|---|---|---|---|
| Overview | always | dashboard | n/a |
| Project setup | ≥1 active project | last-visited project if still active, else first by `createdAt` | "Attach a repo first" |
| Start feature | ≥1 active project | 1 project → Kickoff for that project; N → open picker modal | "Attach a repo first" |
| Active run | ≥1 run with status `running` or `paused-user` | most recent by `createdAt` desc | "No active runs" |
| Review gate | ≥1 run with status `paused-gate` and a non-null `openGate` | oldest open gate by `createdAt` asc | "No gates awaiting review" |

The History / Skills / Rules / Settings items SHALL always render disabled in this change with tooltip "Coming soon" until their screens are built.

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
- **THEN** the sidebar "Project setup" and "Start feature" items transition from disabled to enabled without a page reload
