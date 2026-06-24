import './ClaudboardForms.css'
import { useState } from 'react'
import type { ClaudboardAnalyseInput } from '@bosch-sdlc/protocol'

interface AnalyseFormProps {
  onSubmit: (inputs: ClaudboardAnalyseInput & { skill: 'analyse' }) => Promise<void>
  onCancel: () => void
  submitting?: boolean
}

export default function AnalyseForm({ onSubmit, onCancel, submitting }: AnalyseFormProps) {
  const [ecosystemLevel, setEcosystemLevel] = useState(false)
  const [acceptTopology, setAcceptTopology] = useState(true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void onSubmit({ skill: 'analyse', ecosystemLevel, acceptTopology })
  }

  return (
    <form className="cb-form" onSubmit={handleSubmit}>
      <h3 className="cb-form__title">Analyse — codebase discovery</h3>

      <label className="cb-form__check-row">
        <input
          type="checkbox"
          checked={ecosystemLevel}
          onChange={(e) => setEcosystemLevel(e.target.checked)}
        />
        <span>Analyse at ecosystem level (workspace/multi-repo)</span>
      </label>
      <p className="cb-form__hint">Enable when CWD is a microservice within a larger multi-repo workspace and you want cross-service dependency mapping.</p>

      <label className="cb-form__check-row">
        <input
          type="checkbox"
          checked={acceptTopology}
          onChange={(e) => setAcceptTopology(e.target.checked)}
        />
        <span>Auto-accept topology without prompting</span>
      </label>
      <p className="cb-form__hint">When checked, the skill confirms the detected topology automatically. Uncheck to review misclassifications interactively (not recommended for non-interactive runs).</p>

      <div className="cb-form__actions">
        <button type="button" className="cb-form__btn cb-form__btn--secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="cb-form__btn cb-form__btn--primary" disabled={submitting}>
          {submitting ? 'Launching…' : 'Launch Analyse'}
        </button>
      </div>
    </form>
  )
}
