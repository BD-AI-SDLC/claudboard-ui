## ADDED Requirements

### Requirement: Kickoff branch preview shows the repo's configured project key

The Kickoff page's preview row labelled `→ branch:` SHALL render the project key resolved from the open repo's feature-workflow configuration. The full rendered string SHALL follow the shape `feature/<KEY>-NNNN/<slug>`, where:

- `<KEY>` is the value of `Repo.featureWorkflowProjectKey` when that value is a non-null string.
- `NNNN` is the literal placeholder text `NNNN` and SHALL NOT be replaced by a predicted ticket number.
- `<slug>` continues to be the slugified prompt as it is today (lowercased, non-alphanumerics replaced with `-`, first 6 tokens, defaulting to `new-feature` when the prompt is empty).

The branch line is the only preview line affected by this requirement; the repo line, autonomy line, and phases line remain unchanged.

#### Scenario: Configured repo renders its real project key

- **GIVEN** the Kickoff page is open on a repo whose `featureWorkflowProjectKey` is `"PLAT"`
- **AND** the user has typed the prompt `"Add user audit log"`
- **THEN** the branch preview row reads `→ branch: feature/PLAT-NNNN/add-user-audit-log`
- **AND** the `feature/PLAT-NNNN/add-user-audit-log` text is rendered in the teal accent color (`var(--teal)`)

#### Scenario: Slug updates live and key stays stable

- **GIVEN** the Kickoff page is open on a repo whose `featureWorkflowProjectKey` is `"PLAT"`
- **WHEN** the user edits the prompt from `"Add user audit log"` to `"Migrate scheduler"`
- **THEN** the branch preview row updates to `→ branch: feature/PLAT-NNNN/migrate-scheduler`
- **AND** the `PLAT` segment does not change

### Requirement: Kickoff branch preview shows a muted placeholder when no project key is configured

When the open repo's `featureWorkflowProjectKey` is `null`, the branch preview row SHALL render the literal placeholder text `<project key>` in place of the project key segment. The full rendered string SHALL be `feature/<project key>-NNNN/<slug>`. The placeholder text SHALL be styled with the muted color (`var(--muted)`) instead of the teal accent, so that the preview visibly signals "this is a placeholder, not a real value." No additional copy, hint card, or setup-link CTA is added by this change.

#### Scenario: Unconfigured repo renders a muted placeholder

- **GIVEN** the Kickoff page is open on a repo whose `featureWorkflowProjectKey` is `null`
- **AND** the user has typed the prompt `"Migrate scheduler"`
- **THEN** the branch preview row reads `→ branch: feature/<project key>-NNNN/migrate-scheduler`
- **AND** the `feature/<project key>-NNNN/migrate-scheduler` text is rendered in the muted color (`var(--muted)`)
- **AND** no inline link, hint card, or call-to-action is rendered next to the placeholder

#### Scenario: Repo not yet loaded falls back the same way

- **GIVEN** the Kickoff page has mounted but `getRepo` has not resolved yet (so `project` is `null`)
- **THEN** the branch preview row reads `→ branch: feature/<project key>-NNNN/new-feature`
- **AND** the placeholder is rendered in the muted color
