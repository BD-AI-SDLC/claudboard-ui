import './ClaudboardForms.css'
import { useState } from 'react'
import type { ClaudboardWorkflowInput } from '@bosch-sdlc/protocol'

const STUB = '__stub__'

interface WorkflowFormProps {
  onSubmit: (inputs: ClaudboardWorkflowInput & { skill: 'workflow' }) => Promise<void>
  onCancel: () => void
  submitting?: boolean
}

interface StubField {
  value: string
  stub: boolean
}

function useStubField(initial = ''): [StubField, (v: string) => void, (s: boolean) => void] {
  const [field, setField] = useState<StubField>({ value: initial, stub: false })
  const setValue = (v: string) => setField((f) => ({ ...f, value: v }))
  const setStub = (s: boolean) => setField((f) => ({ ...f, stub: s }))
  return [field, setValue, setStub]
}

function resolveStub(f: StubField): string {
  return f.stub ? STUB : f.value
}

function StubInput({
  id,
  label,
  field,
  onValue,
  onStub,
  placeholder,
}: {
  id: string
  label: string
  field: StubField
  onValue: (v: string) => void
  onStub: (s: boolean) => void
  placeholder?: string
}) {
  return (
    <div className="cb-form__field">
      <label htmlFor={id} className="cb-form__label">{label}</label>
      <div className="cb-form__stub-row">
        <input
          id={id}
          className="cb-form__input"
          value={field.stub ? '' : field.value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={field.stub ? '[TODO]' : placeholder}
          disabled={field.stub}
          required={!field.stub}
        />
        <label className="cb-form__stub-label">
          <input
            type="checkbox"
            checked={field.stub}
            onChange={(e) => onStub(e.target.checked)}
          />
          stub
        </label>
      </div>
      {!field.stub && !field.value.trim() && (
        <p className="cb-form__error">Required — enter a value or check stub.</p>
      )}
    </div>
  )
}

export default function WorkflowForm({ onSubmit, onCancel, submitting }: WorkflowFormProps) {
  const [tracker, setTracker] = useState<'jira' | 'tr'>('jira')
  const [repo, setRepo] = useState<'ado' | 'github'>('github')

  // Jira fields
  const [jiraCloudId, setJiraCloudIdValue, setJiraCloudIdStub] = useStubField()
  const [jiraProjectKey, setJiraProjectKeyValue, setJiraProjectKeyStub] = useStubField()
  const [jiraUrlBase, setJiraUrlBaseValue, setJiraUrlBaseStub] = useStubField()
  const [jiraSprintField] = useState('customfield_10001')
  const [jiraAcField] = useState('customfield_12206')
  const [jiraStart] = useState('In Progress')
  const [jiraSuccess] = useState('In Review')
  const [jiraFailure] = useState('Blocked')

  // T&R fields
  const [trBaseUrl, setTrBaseUrlValue, setTrBaseUrlStub] = useStubField()
  const [trProjectKey, setTrProjectKeyValue, setTrProjectKeyStub] = useStubField()
  const [trStart] = useState('In Progress')
  const [trSuccess] = useState('In Review')
  const [trFailure] = useState('Blocked')

  // ADO fields
  const [adoOrg, setAdoOrgValue, setAdoOrgStub] = useStubField()
  const [adoProject, setAdoProjectValue, setAdoProjectStub] = useStubField()
  const [adoRepoId, setAdoRepoIdValue, setAdoRepoIdStub] = useStubField()

  // GitHub fields
  const [ghOwner, setGhOwnerValue, setGhOwnerStub] = useStubField()
  const [ghRepo, setGhRepoValue, setGhRepoStub] = useStubField()
  const [ghLinkingKeyword] = useState('Closes')

  function isValid(): boolean {
    if (tracker === 'jira') {
      if (!jiraCloudId.stub && !jiraCloudId.value.trim()) return false
      if (!jiraProjectKey.stub && !jiraProjectKey.value.trim()) return false
      if (!jiraUrlBase.stub && !jiraUrlBase.value.trim()) return false
    } else {
      if (!trBaseUrl.stub && !trBaseUrl.value.trim()) return false
      if (!trProjectKey.stub && !trProjectKey.value.trim()) return false
    }
    if (repo === 'ado') {
      if (!adoOrg.stub && !adoOrg.value.trim()) return false
      if (!adoProject.stub && !adoProject.value.trim()) return false
      if (!adoRepoId.stub && !adoRepoId.value.trim()) return false
    } else {
      if (!ghOwner.stub && !ghOwner.value.trim()) return false
      if (!ghRepo.stub && !ghRepo.value.trim()) return false
    }
    return true
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid()) return

    const inputs: ClaudboardWorkflowInput & { skill: 'workflow' } = {
      skill: 'workflow',
      tracker,
      repo,
      jira: tracker === 'jira' ? {
        cloudId: resolveStub(jiraCloudId),
        projectKey: resolveStub(jiraProjectKey),
        urlBase: resolveStub(jiraUrlBase),
        customFields: { sprint: jiraSprintField, acceptanceCriteria: jiraAcField },
        transitions: { start: jiraStart, success: jiraSuccess, failure: jiraFailure },
      } : undefined,
      tr: tracker === 'tr' ? {
        baseUrl: resolveStub(trBaseUrl),
        projectKey: resolveStub(trProjectKey),
        transitions: { start: trStart, success: trSuccess, failure: trFailure },
      } : undefined,
      azureDevOps: repo === 'ado' ? {
        org: resolveStub(adoOrg),
        project: resolveStub(adoProject),
        repositoryId: resolveStub(adoRepoId),
      } : undefined,
      github: repo === 'github' ? {
        owner: resolveStub(ghOwner),
        repo: resolveStub(ghRepo),
        linkingKeyword: ghLinkingKeyword,
      } : undefined,
    }

    void onSubmit(inputs)
  }

  return (
    <form className="cb-form" onSubmit={handleSubmit}>
      <h3 className="cb-form__title">Workflow — feature-workflow skill generator</h3>

      <div className="cb-form__field">
        <label className="cb-form__label">Tracker</label>
        <div className="cb-form__radio-group">
          <label className="cb-form__radio-row">
            <input type="radio" name="tracker" value="jira" checked={tracker === 'jira'} onChange={() => setTracker('jira')} />
            Atlassian Jira
          </label>
          <label className="cb-form__radio-row">
            <input type="radio" name="tracker" value="tr" checked={tracker === 'tr'} onChange={() => setTracker('tr')} />
            Bosch Track &amp; Release
          </label>
        </div>
      </div>

      <div className="cb-form__field">
        <label className="cb-form__label">Repo host</label>
        <div className="cb-form__radio-group">
          <label className="cb-form__radio-row">
            <input type="radio" name="repo" value="github" checked={repo === 'github'} onChange={() => setRepo('github')} />
            GitHub
          </label>
          <label className="cb-form__radio-row">
            <input type="radio" name="repo" value="ado" checked={repo === 'ado'} onChange={() => setRepo('ado')} />
            Azure DevOps
          </label>
        </div>
      </div>

      {tracker === 'jira' && (
        <fieldset className="cb-form__fieldset">
          <legend className="cb-form__legend">Jira configuration</legend>
          <StubInput id="jira-cloud-id" label="Cloud ID" field={jiraCloudId} onValue={setJiraCloudIdValue} onStub={setJiraCloudIdStub} placeholder="a1b2c3d4-e5f6-7890-abcd-ef1234567890" />
          <StubInput id="jira-project-key" label="Project key" field={jiraProjectKey} onValue={setJiraProjectKeyValue} onStub={setJiraProjectKeyStub} placeholder="PLAT" />
          <StubInput id="jira-url-base" label="Base URL" field={jiraUrlBase} onValue={setJiraUrlBaseValue} onStub={setJiraUrlBaseStub} placeholder="https://mycompany.atlassian.net" />
        </fieldset>
      )}

      {tracker === 'tr' && (
        <fieldset className="cb-form__fieldset">
          <legend className="cb-form__legend">Bosch T&amp;R configuration</legend>
          <StubInput id="tr-base-url" label="Base URL" field={trBaseUrl} onValue={setTrBaseUrlValue} onStub={setTrBaseUrlStub} placeholder="https://track.example.bosch.com" />
          <StubInput id="tr-project-key" label="Project key" field={trProjectKey} onValue={setTrProjectKeyValue} onStub={setTrProjectKeyStub} placeholder="MEAS" />
        </fieldset>
      )}

      {repo === 'ado' && (
        <fieldset className="cb-form__fieldset">
          <legend className="cb-form__legend">Azure DevOps configuration</legend>
          <StubInput id="ado-org" label="Organization" field={adoOrg} onValue={setAdoOrgValue} onStub={setAdoOrgStub} placeholder="my-org" />
          <StubInput id="ado-project" label="Project" field={adoProject} onValue={setAdoProjectValue} onStub={setAdoProjectStub} placeholder="MyProject" />
          <StubInput id="ado-repo-id" label="Repository ID (UUID)" field={adoRepoId} onValue={setAdoRepoIdValue} onStub={setAdoRepoIdStub} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        </fieldset>
      )}

      {repo === 'github' && (
        <fieldset className="cb-form__fieldset">
          <legend className="cb-form__legend">GitHub configuration</legend>
          <StubInput id="gh-owner" label="Owner" field={ghOwner} onValue={setGhOwnerValue} onStub={setGhOwnerStub} placeholder="myorg" />
          <StubInput id="gh-repo" label="Repository name" field={ghRepo} onValue={setGhRepoValue} onStub={setGhRepoStub} placeholder="my-repo" />
        </fieldset>
      )}

      <div className="cb-form__actions">
        <button type="button" className="cb-form__btn cb-form__btn--secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="cb-form__btn cb-form__btn--primary" disabled={submitting || !isValid()}>
          {submitting ? 'Launching…' : 'Launch Workflow'}
        </button>
      </div>
    </form>
  )
}
