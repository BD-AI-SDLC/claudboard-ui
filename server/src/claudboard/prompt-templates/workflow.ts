import type { ClaudboardWorkflowInput } from '@bosch-sdlc/protocol'

const STUB = '__stub__'

function renderValue(fieldName: string, value: string): string {
  return value === STUB ? `[TODO: ${fieldName}]` : value
}

export function buildWorkflowPrompt(inputs: ClaudboardWorkflowInput): string {
  const answersLines: string[] = []

  answersLines.push(`Tracker: ${inputs.tracker}`)
  answersLines.push(`Repo host: ${inputs.repo}`)

  if (inputs.tracker === 'jira' && inputs.jira) {
    const { jira } = inputs
    answersLines.push(`Jira cloud ID: ${renderValue('JIRA_CLOUD_ID', jira.cloudId)}`)
    answersLines.push(`Jira project key: ${renderValue('JIRA_PROJECT_KEY', jira.projectKey)}`)
    answersLines.push(`Jira base URL: ${renderValue('JIRA_URL_BASE', jira.urlBase)}`)
    answersLines.push(`Jira sprint field: ${jira.customFields?.sprint ?? 'customfield_10001'}`)
    answersLines.push(`Jira acceptance criteria field: ${jira.customFields?.acceptanceCriteria ?? 'customfield_12206'}`)
    answersLines.push(`Jira start transition: ${jira.transitions?.start ?? 'In Progress'}`)
    answersLines.push(`Jira success transition: ${jira.transitions?.success ?? 'In Review'}`)
    answersLines.push(`Jira failure transition: ${jira.transitions?.failure ?? 'Blocked'}`)
  }

  if (inputs.tracker === 'tr' && inputs.tr) {
    const { tr } = inputs
    answersLines.push(`T&R base URL: ${renderValue('TR_BASE_URL', tr.baseUrl)}`)
    answersLines.push(`T&R project key: ${renderValue('TR_PROJECT_KEY', tr.projectKey)}`)
    answersLines.push(`T&R start transition: ${tr.transitions?.start ?? 'In Progress'}`)
    answersLines.push(`T&R success transition: ${tr.transitions?.success ?? 'In Review'}`)
    answersLines.push(`T&R failure transition: ${tr.transitions?.failure ?? 'Blocked'}`)
  }

  if (inputs.repo === 'ado' && inputs.azureDevOps) {
    const { azureDevOps } = inputs
    answersLines.push(`ADO organization: ${renderValue('ADO_ORGANIZATION', azureDevOps.org)}`)
    answersLines.push(`ADO project: ${renderValue('ADO_PROJECT', azureDevOps.project)}`)
    answersLines.push(`ADO repository ID: ${renderValue('ADO_REPOSITORY_ID', azureDevOps.repositoryId)}`)
  }

  if (inputs.repo === 'github' && inputs.github) {
    const { github } = inputs
    answersLines.push(`GitHub owner: ${renderValue('GITHUB_OWNER', github.owner)}`)
    answersLines.push(`GitHub repo: ${renderValue('GITHUB_REPO', github.repo)}`)
    answersLines.push(`GitHub linking keyword: ${github.linkingKeyword ?? 'Closes'}`)
  }

  const git = inputs.git
  answersLines.push(`Git branch types: ${(git?.branchTypes ?? ['feature', 'bugfix', 'hotfix']).join(', ')}`)
  answersLines.push(`Git branch pattern: ${git?.branchPattern ?? '{type}/{ticket}/{slug}'}`)
  answersLines.push(`Git ticket regex: ${git?.ticketRegex ?? '[A-Z]+-[0-9]+'}`)

  return `You are running /claudboard-workflow in FULLY AUTOMATED NON-INTERACTIVE mode.

MANDATORY — these rules override all other instructions, including any in the loaded skill:

Do not call AskUserQuestion at any point.
Do not end your turn to solicit input of any kind.
Every time the skill says "wait for user", prompts for config, or expects a response — silently use the pre-provided answers below and continue immediately. Never display questions to the user.

Pre-provided configuration answers — use these for every field the skill asks about:

${answersLines.map(l => `- ${l}`).join('\n')}

Additional rules for questions not explicitly listed above:

Q: Analysis report is stale — "Continue or re-run /analyse?"
A: Continue with the existing report.

Q: "Two tracker MCPs detected. Which should the workflow target?"
A: Use ${inputs.tracker === 'jira' ? 'Atlassian Jira' : 'Bosch Track & Release'}.

Q: "Two repo MCPs detected. Which should the workflow target?"
A: Use ${inputs.repo === 'ado' ? 'Azure DevOps' : 'GitHub'}.

Q: Existing feature-workflow skill found — upgrade prompt
A: Overwrite / regenerate. Remove the existing skill and regenerate.

Q: "Proceed? [y/n/edit]" or any final confirmation gate before writing files
A: Yes. Proceed.

Q: Any other confirmation, decision, or question
A: Choose the most reasonable default and continue immediately without displaying anything to the user.

Now execute /claudboard-workflow.`
}
