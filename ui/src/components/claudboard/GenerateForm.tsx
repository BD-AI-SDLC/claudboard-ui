import './ClaudboardForms.css'
import { useState } from 'react'
import type { ClaudboardGenerateInput } from '@bosch-sdlc/protocol'

interface GenerateFormProps {
  onSubmit: (inputs: ClaudboardGenerateInput & { skill: 'generate' }) => Promise<void>
  onCancel: () => void
  submitting?: boolean
}

export default function GenerateForm({ onSubmit, onCancel, submitting }: GenerateFormProps) {
  const [staleReportPolicy, setStaleReportPolicy] = useState<'warn-continue' | 'warn-block'>('warn-continue')
  const [generateClaude, setGenerateClaude] = useState(true)
  const [generateRules, setGenerateRules] = useState(true)
  const [generateSkills, setGenerateSkills] = useState(true)

  const atLeastOne = generateClaude || generateRules || generateSkills

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!atLeastOne) return
    void onSubmit({ skill: 'generate', staleReportPolicy, generateClaude, generateRules, generateSkills })
  }

  return (
    <form className="cb-form" onSubmit={handleSubmit}>
      <h3 className="cb-form__title">Generate — artifact generation</h3>

      <div className="cb-form__field">
        <label className="cb-form__label">Stale report policy</label>
        <select
          className="cb-form__select"
          value={staleReportPolicy}
          onChange={(e) => setStaleReportPolicy(e.target.value as 'warn-continue' | 'warn-block')}
        >
          <option value="warn-continue">Warn and continue (default)</option>
          <option value="warn-block">Warn and block (require fresh analysis)</option>
        </select>
        <p className="cb-form__hint">What to do when the analysis report is older than 24 hours.</p>
      </div>

      <fieldset className="cb-form__fieldset">
        <legend className="cb-form__legend">Artifacts to generate</legend>
        <label className="cb-form__check-row">
          <input type="checkbox" checked={generateClaude} onChange={(e) => setGenerateClaude(e.target.checked)} />
          <span>CLAUDE.md</span>
        </label>
        <label className="cb-form__check-row">
          <input type="checkbox" checked={generateRules} onChange={(e) => setGenerateRules(e.target.checked)} />
          <span>Rules</span>
        </label>
        <label className="cb-form__check-row">
          <input type="checkbox" checked={generateSkills} onChange={(e) => setGenerateSkills(e.target.checked)} />
          <span>Skills</span>
        </label>
        {!atLeastOne && (
          <p className="cb-form__error">Select at least one artifact to generate.</p>
        )}
      </fieldset>

      <div className="cb-form__actions">
        <button type="button" className="cb-form__btn cb-form__btn--secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="cb-form__btn cb-form__btn--primary" disabled={submitting || !atLeastOne}>
          {submitting ? 'Launching…' : 'Launch Generate'}
        </button>
      </div>
    </form>
  )
}
