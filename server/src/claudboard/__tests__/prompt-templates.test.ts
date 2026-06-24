import { buildAnalysePrompt } from '../prompt-templates/analyse.js'
import { buildGeneratePrompt } from '../prompt-templates/generate.js'
import { buildWorkflowPrompt } from '../prompt-templates/workflow.js'

const PREAMBLE_FRAGMENT = 'Do not call AskUserQuestion'

describe('buildAnalysePrompt', () => {
  it('includes the non-interactive preamble', () => {
    const prompt = buildAnalysePrompt({ ecosystemLevel: false, acceptTopology: true })
    expect(prompt).toContain(PREAMBLE_FRAGMENT)
  })

  it('includes all submitted fields in Provided answers block', () => {
    const prompt = buildAnalysePrompt({ ecosystemLevel: true, acceptTopology: false })
    expect(prompt).toContain('Analyse at ecosystem level: yes')
    expect(prompt).toContain('Accept topology without prompting: no')
  })

  it('ends with skill invocation line', () => {
    const prompt = buildAnalysePrompt({ ecosystemLevel: false, acceptTopology: true })
    expect(prompt).toContain('Now execute /claudboard-analyse.')
  })
})

describe('buildGeneratePrompt', () => {
  it('includes the non-interactive preamble', () => {
    const prompt = buildGeneratePrompt({
      staleReportPolicy: 'warn-continue',
      generateClaude: true,
      generateRules: true,
      generateSkills: true,
    })
    expect(prompt).toContain(PREAMBLE_FRAGMENT)
  })

  it('includes all submitted fields in Provided answers block', () => {
    const prompt = buildGeneratePrompt({
      staleReportPolicy: 'warn-block',
      generateClaude: false,
      generateRules: true,
      generateSkills: false,
    })
    expect(prompt).toContain('warn-block')
    expect(prompt).toContain('Generate CLAUDE.md: no')
    expect(prompt).toContain('Generate rules: yes')
    expect(prompt).toContain('Generate skills: no')
  })

  it('ends with skill invocation line', () => {
    const prompt = buildGeneratePrompt({
      staleReportPolicy: 'warn-continue',
      generateClaude: true,
      generateRules: true,
      generateSkills: true,
    })
    expect(prompt).toContain('Now execute /claudboard-generate.')
  })
})

describe('buildWorkflowPrompt', () => {
  const baseInputs = {
    tracker: 'jira' as const,
    repo: 'github' as const,
    jira: {
      cloudId: 'a1b2c3',
      projectKey: 'PLAT',
      urlBase: 'https://example.atlassian.net',
    },
    github: {
      owner: 'myorg',
      repo: 'my-repo',
      linkingKeyword: 'Closes',
    },
  }

  it('includes the non-interactive preamble', () => {
    const prompt = buildWorkflowPrompt(baseInputs)
    expect(prompt).toContain(PREAMBLE_FRAGMENT)
  })

  it('includes tracker and repo fields in Provided answers block', () => {
    const prompt = buildWorkflowPrompt(baseInputs)
    expect(prompt).toContain('Tracker: jira')
    expect(prompt).toContain('Repo host: github')
    expect(prompt).toContain('Jira cloud ID: a1b2c3')
    expect(prompt).toContain('GitHub owner: myorg')
  })

  it('renders stub sentinel as TODO placeholder', () => {
    const prompt = buildWorkflowPrompt({
      ...baseInputs,
      jira: { ...baseInputs.jira, cloudId: '__stub__' },
    })
    expect(prompt).toContain('[TODO: JIRA_CLOUD_ID]')
    expect(prompt).not.toContain('__stub__')
  })

  it('ends with skill invocation line', () => {
    const prompt = buildWorkflowPrompt(baseInputs)
    expect(prompt).toContain('Now execute /claudboard-workflow.')
  })
})
