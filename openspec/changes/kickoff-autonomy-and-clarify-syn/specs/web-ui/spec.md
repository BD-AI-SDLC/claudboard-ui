## MODIFIED Requirements

### Requirement: Kickoff form submits a prompt-and-autonomy request

The Kickoff screen SHALL collect two values from the user before submission: the feature prompt (free text) and the clarification autonomy level (one of `autopilot`, `balanced`, `guided`, `manual`). Both SHALL be present in the `POST /api/runs` payload. The form SHALL NOT submit if either is missing or if autonomy is not one of the four allowed values.

The autonomy control SHALL be a four-way single-select (radio group or equivalent) rendered immediately below the prompt textarea. The four options SHALL be displayed in the order `autopilot`, `balanced`, `guided`, `manual`. Each option's label SHALL include a one-line description of its behaviour, matching the descriptions used in the SKILL's autonomy table.

On mount, the autonomy selection SHALL be initialised from the project's `defaultAutonomy` value (returned by `GET /api/projects/:id`). While the project is loading, the selection SHALL display `balanced` and the Submit button SHALL be disabled. Once the project loads, the radio reflects the project default; the Submit button enables when the prompt textarea is non-empty.

The form is identical across all project topologies (monolith, monorepo, multi-repo workspace). There is no scope picker.

The preview pane SHALL echo the currently-selected autonomy value alongside the existing `repo`, `branch`, and `phases` summary, so the user sees what they are committing to before clicking Submit.

#### Scenario: Kickoff form initialises from the project default

- **GIVEN** a project whose `defaultAutonomy` is `guided`
- **WHEN** the user opens the Kickoff screen for that project
- **THEN** the autonomy radio shows `guided` selected
- **AND** the preview pane shows `autonomy: guided`

#### Scenario: Kickoff form falls back to `balanced` when project default is unset or invalid

- **GIVEN** a project whose `defaultAutonomy` is missing or not one of the four allowed values (the server normalises it to `balanced`)
- **WHEN** the user opens the Kickoff screen for that project
- **THEN** the autonomy radio shows `balanced` selected

#### Scenario: Kickoff submits prompt and autonomy

- **GIVEN** the Kickoff form is loaded for a project whose default is `balanced`
- **WHEN** the user enters `"Add invoice PDF"` in the prompt, selects `manual` in the autonomy radio, and clicks Submit
- **THEN** the UI POSTs `/api/runs` with `{ projectId, target, prompt: "Add invoice PDF", autonomy: "manual" }`
- **AND** on 201 response, the user is navigated to the Active Run page for the new run

#### Scenario: Kickoff form is identical across topologies (autonomy included)

- **WHEN** the user opens the Kickoff screen for a monolith Project
- **AND WHEN** the user opens the Kickoff screen for a monorepo Project
- **AND WHEN** the user opens the Kickoff screen for a multi-repo-workspace Project
- **THEN** all three screens render the same form: prompt textarea + autonomy radio + preview pane + Submit. No scope picker. No topology-specific fields.

#### Scenario: Submit is disabled until project loads

- **GIVEN** the user has just navigated to the Kickoff screen and the project record has not yet loaded
- **WHEN** the user types in the prompt textarea
- **THEN** the Submit button remains disabled
- **AND** once the project record loads, the autonomy radio updates to the project default and (if the prompt is non-empty) the Submit button enables

### Requirement: Active Run header surfaces the selected autonomy

The Active Run screen's run-metadata header SHALL display the run's `autonomy` value as a single read-only chip alongside the existing run metadata (cost, tokens, status). The chip SHALL render the autonomy as a lowercase string (`autopilot`, `balanced`, `guided`, or `manual`).

The chip SHALL NOT be interactive — autonomy is a kickoff-time decision and cannot be changed mid-run.

#### Scenario: Active Run displays the run's autonomy

- **GIVEN** a run created with `autonomy: "guided"`
- **WHEN** the user opens the Active Run screen for that run
- **THEN** the metadata header includes a chip displaying `guided`
- **AND** the chip is not clickable, has no menu, and shows no edit affordance
