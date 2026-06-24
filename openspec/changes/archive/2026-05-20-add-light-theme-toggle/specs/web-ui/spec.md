## ADDED Requirements

### Requirement: Theme respects OS preference on first load

The web UI SHALL detect the user's operating-system colour-scheme preference on first load and apply the corresponding theme by setting `data-theme` on the `<html>` element. The detection SHALL use `window.matchMedia('(prefers-color-scheme: light)')`. If the preference cannot be determined (e.g. the API is unavailable), the UI SHALL default to the dark theme.

The UI SHALL continue to honour OS-preference changes that occur after first load **only until the user explicitly picks a theme via the sidebar toggle**. After an explicit pick, subsequent OS-preference changes SHALL NOT alter the active theme for the remainder of the session.

#### Scenario: OS prefers light, no user interaction

- **GIVEN** the user's OS reports `prefers-color-scheme: light`
- **AND** the user has not interacted with the theme toggle in this session
- **WHEN** the app loads
- **THEN** `document.documentElement.dataset.theme` is set to `"light"` before the first render commits

#### Scenario: OS prefers dark, no user interaction

- **GIVEN** the user's OS reports `prefers-color-scheme: dark` (or no preference)
- **AND** the user has not interacted with the theme toggle in this session
- **WHEN** the app loads
- **THEN** `document.documentElement.dataset.theme` is set to `"dark"` before the first render commits

#### Scenario: OS preference flips while app is open, no user override

- **GIVEN** the app is loaded with `data-theme="dark"` because the OS prefers dark
- **AND** the user has not interacted with the theme toggle
- **WHEN** the user changes their OS to prefer light
- **THEN** `data-theme` updates to `"light"` and the UI re-paints with the light palette without a reload

#### Scenario: OS preference flips after user override

- **GIVEN** the app was loaded with `data-theme="dark"`
- **AND** the user clicked the sun icon, setting `data-theme="light"`
- **WHEN** the user changes their OS to prefer dark
- **THEN** `data-theme` remains `"light"` and the UI does not change

#### Scenario: Reload after override returns to OS preference

- **GIVEN** the user clicked the sun icon during a session, overriding the dark default to light
- **WHEN** the user reloads the page
- **AND** the OS preference is still dark
- **THEN** `data-theme` is `"dark"` on the new page load (the override does not persist)

### Requirement: Sidebar footer hosts a two-button theme toggle

The sidebar's footer SHALL render a segmented two-button control with a moon icon for dark and a sun icon for light. The button corresponding to the currently active theme SHALL be visually distinguished (background `var(--surface-3)`, foreground `var(--text)`) and SHALL carry `aria-pressed="true"`; the other button SHALL carry `aria-pressed="false"`.

Each button SHALL carry an `aria-label` of `"Dark"` or `"Light"` respectively. Clicking either button SHALL set the active theme to that button's value and SHALL count as an explicit user override for the purpose of OS-preference handling.

The control SHALL be present in the sidebar footer on every screen on which the sidebar is rendered (Dashboard, Project, Kickoff, Active Run, Review Gate).

#### Scenario: Toggle reflects active theme

- **GIVEN** `data-theme` is `"dark"`
- **WHEN** the user looks at the sidebar footer
- **THEN** the moon button is rendered in the active state with `aria-pressed="true"`
- **AND** the sun button is rendered in the inactive state with `aria-pressed="false"`

#### Scenario: Clicking sun switches to light

- **GIVEN** `data-theme` is `"dark"`
- **WHEN** the user clicks the sun button
- **THEN** `data-theme` becomes `"light"`
- **AND** the sun button becomes the active one with `aria-pressed="true"`
- **AND** the UI re-paints with the light palette

#### Scenario: Clicking moon switches to dark

- **GIVEN** `data-theme` is `"light"`
- **WHEN** the user clicks the moon button
- **THEN** `data-theme` becomes `"dark"`
- **AND** the moon button becomes the active one with `aria-pressed="true"`

#### Scenario: Toggle is reachable by keyboard

- **WHEN** the user tabs through the sidebar
- **THEN** focus reaches the moon button and the sun button as distinct stops
- **AND** pressing `Enter` or `Space` on a focused button activates it identically to a click

### Requirement: All screens are usable in both themes

Every screen rendered by the UI SHALL be visually correct and meet WCAG AA contrast for text and interactive elements in both `data-theme="dark"` and `data-theme="light"`. No screen SHALL contain colours that bypass the design-token system; all colours SHALL be expressed via CSS custom properties defined in `ui/src/styles/tokens.css`.

#### Scenario: Light-mode visual pass covers every screen

- **GIVEN** the app is running with `data-theme="light"`
- **WHEN** the user opens, in turn, the Dashboard, Project, Kickoff, Active Run, Review Gate, the project-picker modal, and the attach-repo modal
- **THEN** each screen renders with the light palette throughout — no dark surfaces, no invisible-on-light text, no broken chip contrast, no black-on-light or white-on-light leaks

### Requirement: CSS lint forbids hardcoded colour literals outside tokens

The CSS lint script (`ui/scripts/check-css-prefixes.js`, invoked by `npm run lint`) SHALL fail if any colour literal (`#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`) appears in any `.css` file under `ui/src/` other than the allowlisted `ui/src/styles/tokens.css`.

Comments SHALL be stripped before scanning, so colour literals inside `/* … */` or `//` comments SHALL NOT cause the lint to fail.

#### Scenario: Hardcoded hex in component CSS fails lint

- **GIVEN** a component CSS file contains the rule `color: #ff0000;`
- **WHEN** `npm run lint` runs
- **THEN** the script exits non-zero
- **AND** the offending file path and the literal `#ff0000` are printed to stderr

#### Scenario: Hardcoded rgba in component CSS fails lint

- **GIVEN** a component CSS file contains the rule `background: rgba(0, 0, 0, 0.5);`
- **WHEN** `npm run lint` runs
- **THEN** the script exits non-zero
- **AND** the offending file path and the `rgba(...)` literal are printed to stderr

#### Scenario: Colour literal inside tokens.css passes lint

- **GIVEN** `ui/src/styles/tokens.css` contains the rule `--bg: #08090a;`
- **WHEN** `npm run lint` runs
- **THEN** the script does not flag this line
