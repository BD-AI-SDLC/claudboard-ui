## ADDED Requirements

### Requirement: Vanilla React stack with no UI libraries

The UI SHALL be built with Vite + React 18 + TypeScript. It SHALL NOT depend on Tailwind, shadcn, Radix, MUI, Chakra, Mantine, DaisyUI, styled-components, Emotion, or any other UI component or CSS-in-JS library. Styling SHALL be plain CSS in per-component `.css` files imported alongside their `.tsx`.

#### Scenario: Dependency check excludes UI libraries

- **WHEN** the UI's `package.json` is inspected
- **THEN** none of: tailwindcss, @shadcn/*, @radix-ui/*, @mui/*, @chakra-ui/*, @mantine/*, daisyui, styled-components, @emotion/* appear in dependencies or devDependencies

#### Scenario: CSS files are colocated with components

- **WHEN** a component file `src/components/RunBanner.tsx` exists
- **THEN** its styles live in `src/components/RunBanner.css`, imported as the first statement of the `.tsx` file

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement five screens with layouts, typography, color tokens, spacing, and component shapes that visually match the bosch-workflow design at `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project`:

- **Dashboard** — workspace overview, metrics tiles, repository list with health bars, activity feed, "vertical operations" grid.
- **Project** — per-repo deep view including prereq panel.
- **Kickoff** — feature prompt entry, scope picker (for monorepo), submit.
- **Active Run** — split view with phases/agents (left), live stream (middle), telemetry rail (right), run banner with gate CTA when applicable.
- **Review Gate** — spec + plan side-by-side, approve / request-changes actions.

Each screen SHALL use the Geist and Geist Mono fonts and the existing color tokens (`--teal`, `--amber`, `--violet`, `--bg`, `--bg-2`, `--text`, `--text-2`, `--muted`, `--dim`, `--border`).

#### Scenario: Dashboard renders all required regions

- **WHEN** the user opens the dashboard with at least one workspace registered
- **THEN** the page shows: topbar with crumb + Start-feature CTA, h1 title, four metric tiles (active runs, awaiting gate, in review, merged this week), repositories card with rows matching the design's grid, activity feed card, and the vertical operations grid

#### Scenario: Active Run shows three panes

- **WHEN** the user opens a running run in the default `split` layout
- **THEN** the page shows three panes — Pipeline (left), Live stream (middle), Run telemetry (right) — with the run banner at the top

#### Scenario: Review Gate shows spec and plan

- **WHEN** the user navigates to an open gate via the Run banner's "Review spec + plan" CTA
- **THEN** the page renders the BDD spec text with Gherkin keyword highlighting and the architect plan as a numbered list of checkpoints with files and contracts; two action buttons are present: "Approve" and "Request changes"

### Requirement: Live data over REST and WebSocket

The UI SHALL fetch initial data via REST endpoints and subscribe to live updates via WebSocket. There SHALL be no mock data shipped in the production build.

#### Scenario: Dashboard fetches from REST

- **WHEN** the dashboard mounts
- **THEN** it calls `GET /api/dashboard/summary` and `GET /api/projects`; no `window.DATA` global exists in the production bundle

#### Scenario: Active Run subscribes via WebSocket

- **WHEN** the user opens an active run page
- **THEN** the page opens a WS connection to `/api/runs/:id/stream`, replays the buffered events to build initial state, then updates the pipeline/stream/telemetry incrementally

### Requirement: Gate approval flow

The Review Gate screen SHALL provide actions to approve or reject the open gate. Approve SHALL POST `{ result: "approved" }`; reject SHALL open a small inline form for the change request text and POST `{ result: "rejected", changes }`.

#### Scenario: Approve closes the gate and returns to the Run view

- **WHEN** the user clicks "Approve" on the Review Gate screen
- **THEN** the UI POSTs to `/api/runs/:id/gate/:gate_id/resolve` with `{ result: "approved" }`, the gate UI dismisses, and the user lands back on the Active Run view which now shows the workflow advancing past the gate

#### Scenario: Request changes captures feedback

- **WHEN** the user clicks "Request changes", enters text, and submits
- **THEN** the UI POSTs `{ result: "rejected", changes: <text> }` and dismisses; the run banner reflects the SKILL's next move (typically re-running the gated agents)

### Requirement: Class name prefix convention

All component-defined CSS classes SHALL be prefixed by a screen or component identifier (e.g. `run-banner__title`, `gate-step__keyword`, `dash-grid__card`) to avoid global collisions in the absence of CSS modules.

#### Scenario: Lint catches unprefixed classes

- **WHEN** a developer adds a class `.title` (no prefix) in a component CSS file
- **THEN** the CSS lint step fails CI with a message naming the offending class and file
