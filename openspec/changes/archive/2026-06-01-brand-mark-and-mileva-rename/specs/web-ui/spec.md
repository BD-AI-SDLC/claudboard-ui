## ADDED Requirements

### Requirement: Sidebar header renders the claudboard brand mark and two-tone wordmark

The Sidebar header SHALL render the canonical claudboard brand identity: a tile-glyph mark followed by the wordmark `claud` + `board` and the version pill.

The mark SHALL be implemented as a reusable primitive `<BrandMark />` exposing the design system's "knockout" tile: a teal square tile with two cells punched out — a primary cell at SVG coordinates `(5,12)` sized `7×7` with `rx=2` at full opacity, and a ghost cell at `(12,5)` sized `7×7` with `rx=2` at opacity `0.32`. Both cells SHALL reveal the surface colour behind the tile via a theme-aware CSS custom property (`--brand-cutout`, defaulting to the dark page background).

The wordmark SHALL render `claud` in lower-case in the primary text colour and `board` in lower-case in the teal accent colour, without a coloured box, padding, or border-radius around either word. The two spans SHALL be visually adjacent (no horizontal gap between them).

The previously-present `"Not for 5 year olds"` tagline element SHALL be removed entirely; the Sidebar header SHALL contain no tagline line beneath the brand row.

#### Scenario: Sidebar header includes the brand mark glyph

- **GIVEN** the app is mounted with a Sidebar
- **WHEN** the Sidebar renders
- **THEN** the `.sidebar__brand` element contains a `<BrandMark>` glyph as its first child
- **AND** the glyph renders an inline `<svg viewBox="0 0 24 24">` with exactly two `<rect>` cells at the documented coordinates
- **AND** the glyph wrapper has the teal tile background and a corner radius equal to 24% of its rendered size

#### Scenario: Wordmark is two-tone teal, not boxed

- **WHEN** the Sidebar brand row renders
- **THEN** the `claud` span has the primary text colour and no background
- **AND** the `board` span has the teal accent colour and no `background`, `padding`, or `border-radius`
- **AND** both spans render lower-case text matching the design wordmark exactly

#### Scenario: The "Not for 5 year olds" tagline is gone

- **WHEN** the Sidebar renders
- **THEN** no element with class `sidebar__brand-tagline` appears in the DOM
- **AND** the text `"Not for 5 year olds"` does not appear anywhere in the Sidebar

### Requirement: BrandMark supports an inverted variant for use on accent surfaces

The `<BrandMark variant="inverted" />` variant SHALL render with an inverted figure/ground: a `--surface-2` tile background with teal-coloured cells. This allows the mark to be placed on a teal-accent surface without disappearing into the background.

#### Scenario: Inverted variant flips tile and cells

- **GIVEN** a `<BrandMark variant="inverted" />` is rendered
- **WHEN** computed styles are inspected
- **THEN** the wrapper background is `--surface-2` (not teal)
- **AND** the cell `fill` is the teal accent (not the cutout colour)
- **AND** the ghost cell's opacity rule still applies, so the relative weight of primary vs ghost is preserved

### Requirement: Browser tab shows the claudboard identity

The browser tab and bookmark surfaces SHALL identify the app as `claudboard`, not `Bosch SDLC` or any prior working name. The page `<title>` SHALL be `claudboard`. The page SHALL declare an SVG favicon (`/favicon.svg`) whose mark geometry is identical to the inline `BrandMark` primitive — same viewBox, same two cells at the same coordinates, same tile radius scaling — so the favicon and the sidebar glyph read as the same mark at every size.

#### Scenario: index.html declares the SVG favicon and claudboard title

- **GIVEN** the built `ui/index.html` is served
- **WHEN** the document head is parsed
- **THEN** `<title>` is `claudboard`
- **AND** a `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` element is present
- **AND** the served `/favicon.svg` contains the knockout mark: one teal tile rect with `rx=5.76`, one primary cell at `(5,12)` `7×7`, one ghost cell at `(12,5)` `7×7` with `opacity=0.32`

## MODIFIED Requirements

### Requirement: Foundation setup banner and operation cards address the user with the product name "Claudboard"

The foundation setup banner (`SetupBanner`) and the foundation/maintenance operation cards (`OperationCard`, fed from `setup-utils.ts`) SHALL refer to the product as `Claudboard` in user-visible copy. The earlier working name `Mileva` SHALL NOT appear in any rendered string.

The five operation `cmd` strings displayed to the user SHALL use the `claudboard-` prefix, not the `mileva-` prefix:

- `analyse` → display `/claudboard-analyse`
- `generate` → display `/claudboard-generate`
- `claudboard-workflow` → display `/claudboard-workflow`
- `refresh` → display `/claudboard-refresh`
- `techdebt` → display `/claudboard-techdebt`

These strings are display affordances only. The server-side prereq runner (`server/src/prereq/cli-runner.ts`) continues to invoke the canonical namespaced plugin commands (`/claudboard:claudboard-analyse`, etc.); the UI's short form is for readability and does not need to be a literal invocation target.

The operation `id` keys (`analyse`, `generate`, `claudboard-workflow`, `refresh`, `techdebt`) SHALL NOT change — they are the routing keys for prereq state lookup and dependency declarations.

#### Scenario: SetupBanner headline names Claudboard

- **GIVEN** a project where at least one foundation op is `missing`
- **WHEN** the `SetupBanner` renders
- **THEN** the headline text is `"Set up Claudboard for this repo"`
- **AND** the headline text does not contain the substring `"Mileva"` (case-insensitive)

#### Scenario: Operation CTA buttons use the claudboard- command prefix

- **GIVEN** a project where the foundation has a `next` op at the `analyse` step
- **WHEN** the `SetupBanner` CTA renders
- **THEN** the button label is `"▶ Run /claudboard-analyse"`
- **AND** no rendered string anywhere in the Project view contains `/mileva-`

#### Scenario: Foundation routing keys are unchanged

- **GIVEN** a `prereqs` record keyed by the existing `id` values (`analyse`, `generate`, `claudboard-workflow`)
- **WHEN** `deriveFoundationStates(prereqs, running)` is called
- **THEN** it returns derived states for each of the three foundation ops in the same order and against the same keys as before the rename
- **AND** the resulting `VisualState` values match the pre-rename behaviour for identical inputs
