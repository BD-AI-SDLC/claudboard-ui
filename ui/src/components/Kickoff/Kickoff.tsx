import './Kickoff.css'
import { useEffect, useState } from 'react'
import type { Autonomy, Repo, PrereqRecord } from '@bosch-sdlc/protocol'
import { AUTONOMY_VALUES, DEFAULT_AUTONOMY } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'
import Icon from '../primitives/Icon.js'
import TopBar from '../primitives/TopBar.js'
import { foundationExists, anyFoundationStale } from '../Project/setup-utils.js'

const AUTONOMY_DESCRIPTIONS: Record<Autonomy, string> = {
  autopilot: 'Skip clarify; synthesis prints without blocking.',
  balanced: '8-dimension rubric; questions for every unclear dimension.',
  guided: 'Direction-only questions; lower-priority dimensions deferred.',
  manual: 'Free-form chat; reply when you are satisfied.',
}

interface KickoffProps {
  projectId: string
  onRunCreated?: (runId: string) => void
  /** Navigate back to the Project screen — used by the foundation-drift hint's
   *  "refresh first" link. Optional; the hint hides when not provided. */
  onBackToProject?: (projectId: string) => void
  /** When set, pre-fill the form from this run's kickoff parameters (prompt +
   *  autonomy). Used by the Active Run page's Restart button. The source run's
   *  target/repo is NOT inherited — the user picks via the existing repo flow. */
  prefillRunId?: string | null
}

export default function Kickoff({ projectId, onRunCreated, onBackToProject, prefillRunId }: KickoffProps) {
  const [project, setProject] = useState<Repo | null>(null)
  const [prereqs, setPrereqs] = useState<Record<string, PrereqRecord>>({})
  const [prompt, setPrompt] = useState('')
  const [autonomy, setAutonomy] = useState<Autonomy>(DEFAULT_AUTONOMY)
  const [submitting, setSubmitting] = useState(false)
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null)
  const [prefilling, setPrefilling] = useState<boolean>(!!prefillRunId)

  useEffect(() => {
    api.getRepo(projectId)
      .then((p) => {
        setProject(p)
        // Only inherit the repo's default autonomy when we're NOT also prefilling
        // from a source run — the source run's autonomy takes precedence below.
        if (!prefillRunId) setAutonomy(p.defaultAutonomy)
      })
      .catch(console.error)
    api.getRepoPrereqs(projectId)
      .then((p) => setPrereqs(p ?? {}))
      .catch(console.error)
  }, [projectId, prefillRunId])

  // Prefill from a source run (Restart flow). Fires once per prefillRunId change.
  useEffect(() => {
    if (!prefillRunId) return
    setPrefilling(true)
    setPrefillNotice(null)
    api.getRun(prefillRunId)
      .then((run) => {
        setPrompt(run.prompt)
        setAutonomy(run.autonomy)
      })
      .catch(() => {
        setPrefillNotice(`Could not pre-fill from run ${prefillRunId} — start fresh below.`)
      })
      .finally(() => setPrefilling(false))
  }, [prefillRunId])

  const showDriftHint = foundationExists(prereqs) && anyFoundationStale(prereqs)

  const slug = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 6)
    .join('-') || 'new-feature'

  const projectKey = project?.featureWorkflowProjectKey ?? null
  const keyDisplay = projectKey ?? '<project key>'
  const keyColor = projectKey ? 'var(--teal)' : 'var(--muted)'

  const handleSubmit = async () => {
    if (!prompt.trim() || !project) return
    setSubmitting(true)
    try {
      const run = await api.createRun({
        repoId: projectId,
        prompt,
        target: project.path,
        autonomy,
      })
      onRunCreated?.(run.id)
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        title="Start feature"
        breadcrumb={['workspace', 'Start feature']}
      />

      <div className="kickoff__page">
        <div className="kickoff__wrap">
          <div className="kickoff__card">
            <h1>Start a feature</h1>
            <div className="kickoff__sub">
              claudboard will create a Jira ticket, write a BDD spec, plan execution, then pause
              for your approval before running autonomously.
            </div>

            {showDriftHint && (
              <div className="kickoff__drift-hint" role="note">
                <span aria-hidden="true">↻</span>
                <span>
                  Foundation may be out of date —{' '}
                  <button
                    type="button"
                    className="kickoff__drift-link"
                    onClick={() => onBackToProject?.(projectId)}
                  >
                    refresh first
                  </button>
                </span>
              </div>
            )}

            {prefilling && (
              <div className="kickoff__drift-hint" role="status">
                <span aria-hidden="true">⏳</span>
                <span>Loading parameters from source run…</span>
              </div>
            )}

            {prefillNotice && !prefilling && (
              <div className="kickoff__drift-hint" role="note">
                <span aria-hidden="true">⚠</span>
                <span>{prefillNotice}</span>
              </div>
            )}

            <label className="kickoff__label">What do you want to build?</label>
            <textarea
              className="kickoff__textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the feature. Be specific about behavior, but skip implementation details — sdd-expert and architect will handle those."
              rows={4}
            />

            <fieldset className="kickoff__autonomy" aria-label="Clarification autonomy">
              <legend className="kickoff__label">Clarification autonomy</legend>
              {AUTONOMY_VALUES.map((level) => (
                <label key={level} className="kickoff__autonomy-option">
                  <input
                    type="radio"
                    name="autonomy"
                    value={level}
                    checked={autonomy === level}
                    onChange={() => setAutonomy(level)}
                    disabled={!project}
                  />
                  <span className="kickoff__autonomy-label">
                    <span className="kickoff__autonomy-name">{level}</span>
                    <span className="kickoff__autonomy-desc">{AUTONOMY_DESCRIPTIONS[level]}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {/* preview */}
            <div className="kickoff__preview">
              <div className="kickoff__preview-ph">─ preview ─</div>
              <div style={{ marginTop: '8px' }}>
                <span style={{ color: 'var(--violet)' }}>$ /start-feature</span>{' '}
                <span style={{ color: 'var(--text)' }}>
                  "{prompt.slice(0, 70)}{prompt.length > 70 ? '…' : ''}"
                </span>
              </div>
              <div style={{ marginTop: '10px', color: 'var(--muted)' }}>
                <div>→ repo: <span style={{ color: 'var(--text)' }}>{project?.path ?? '—'}</span></div>
                <div>→ branch: <span style={{ color: keyColor }}>feature/{keyDisplay}-NNNN/{slug}</span></div>
                <div>→ autonomy: <span style={{ color: 'var(--teal)' }}>{autonomy}</span></div>
                <div>→ phases: <span style={{ color: 'var(--text)' }}>1 → 7 · 1 human gate after spec + plan</span></div>
              </div>
            </div>

            <div className="kickoff__foot">
              <span className="kickoff__foot-hint">
                Spec + plan approval gate runs in ~6 min. After that the workflow is unattended.
              </span>
              <button className="kickoff__btn-ghost">Save draft</button>
              <button
                className="kickoff__submit"
                onClick={handleSubmit}
                disabled={submitting || !prompt.trim() || !project}
              >
                <Icon name="rocket" size={12} />
                {submitting ? 'Starting…' : 'Start feature'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
