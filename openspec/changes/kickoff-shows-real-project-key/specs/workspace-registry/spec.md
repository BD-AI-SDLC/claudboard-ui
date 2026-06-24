## ADDED Requirements

### Requirement: Repo carries the resolved feature-workflow project key

The protocol's `Repo` interface SHALL include a field `featureWorkflowProjectKey: string | null`. The server's repo loader (`mapRepoRow` in `server/src/registry/project-config.ts`) SHALL populate this field on every `Repo` it constructs, by calling a dedicated resolver against the repo's working tree.

The resolver SHALL read the repo's `.claude/skills/feature-workflow/config.json` file. The resolver returns `null` when the file is missing or unparseable. When the file parses, the resolver SHALL respect the top-level `tracker` field:

- When `tracker === "jira"`, the resolver reads `jira.projectKey`.
- When `tracker === "tr"`, the resolver reads `tr.projectKey`.
- Any other value of `tracker` (including missing) causes the resolver to return `null`.

The resolved value is the project key only when it is a non-empty string AND it does not equal the sentinel `"__stub__"` AND it does not start with the prefix `"[TODO:"`. In all other cases the resolver returns `null`.

The resolver SHALL NOT fall back across trackers (e.g. it does not consult `tr.projectKey` when `tracker: "jira"` and the jira key is missing). Falling back would produce a misleading project key for repos whose tracker has been deliberately switched.

The resolver SHALL log a `console.warn` (consistent with `readDefaultAutonomy`'s log style) when the file exists but JSON parsing fails. Silent return is permitted in all other branches.

#### Scenario: Configured Jira project resolves its key

- **GIVEN** a repo whose `.claude/skills/feature-workflow/config.json` contains `tracker: "jira"` and `jira.projectKey: "PLAT"`
- **WHEN** the server constructs a `Repo` for that repo
- **THEN** the returned `Repo.featureWorkflowProjectKey` is the string `"PLAT"`

#### Scenario: Configured T&R project resolves its key

- **GIVEN** a repo whose `.claude/skills/feature-workflow/config.json` contains `tracker: "tr"` and `tr.projectKey: "TR-CHARLIE"`
- **WHEN** the server constructs a `Repo` for that repo
- **THEN** the returned `Repo.featureWorkflowProjectKey` is the string `"TR-CHARLIE"`

#### Scenario: Missing config file produces a null key

- **GIVEN** a repo with no `.claude/skills/feature-workflow/config.json` file
- **WHEN** the server constructs a `Repo` for that repo
- **THEN** the returned `Repo.featureWorkflowProjectKey` is `null`

#### Scenario: Stub sentinel produces a null key

- **GIVEN** a repo whose config contains `tracker: "jira"` and `jira.projectKey: "__stub__"`
- **WHEN** the server constructs a `Repo` for that repo
- **THEN** the returned `Repo.featureWorkflowProjectKey` is `null`

#### Scenario: Un-substituted TODO template produces a null key

- **GIVEN** a repo whose config contains `tracker: "jira"` and `jira.projectKey: "[TODO: JIRA_PROJECT_KEY]"`
- **WHEN** the server constructs a `Repo` for that repo
- **THEN** the returned `Repo.featureWorkflowProjectKey` is `null`

#### Scenario: Unknown tracker produces a null key

- **GIVEN** a repo whose config contains `tracker: "github"` (or any value not in `{"jira","tr"}`)
- **WHEN** the server constructs a `Repo` for that repo
- **THEN** the returned `Repo.featureWorkflowProjectKey` is `null`

#### Scenario: Tracker is jira but jira block is missing

- **GIVEN** a repo whose config contains `tracker: "jira"` but no `jira` object at all
- **WHEN** the server constructs a `Repo` for that repo
- **THEN** the returned `Repo.featureWorkflowProjectKey` is `null`

#### Scenario: Malformed JSON in the config file

- **GIVEN** a repo whose `.claude/skills/feature-workflow/config.json` is not valid JSON
- **WHEN** the server constructs a `Repo` for that repo
- **THEN** the returned `Repo.featureWorkflowProjectKey` is `null`
- **AND** a `console.warn` message has been emitted naming the unparseable file
