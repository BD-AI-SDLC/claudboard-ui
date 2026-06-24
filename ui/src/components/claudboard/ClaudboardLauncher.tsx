import './ClaudboardForms.css'
import { useState, useEffect } from 'react'
import type { ClaudboardLaunchRequest } from '@bosch-sdlc/protocol'
import { fetchClaudboardAvailability, launchClaudboardRun } from '../../api/claudboard.js'
import AnalyseForm from './AnalyseForm.js'
import GenerateForm from './GenerateForm.js'
import WorkflowForm from './WorkflowForm.js'

const RUN_IN_PROGRESS_TOOLTIP = 'A run is in progress — only one at a time'

type ModalSkill = 'analyse' | 'generate' | 'workflow' | null

interface ClaudboardLauncherProps {
  repoId: string
  onRunCreated: (runId: string) => void
  disabled?: boolean
}

export default function ClaudboardLauncher({ repoId, onRunCreated, disabled: externalDisabled = false }: ClaudboardLauncherProps) {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [installHint, setInstallHint] = useState<string | undefined>()
  const [openModal, setOpenModal] = useState<ModalSkill>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchClaudboardAvailability()
      .then(({ installed: ok, installHint: hint }) => {
        setInstalled(ok)
        setInstallHint(hint)
      })
      .catch(() => {
        setInstalled(false)
        setInstallHint('Could not contact server to check claudboard availability.')
      })
  }, [])

  async function handleSubmit(inputs: ClaudboardLaunchRequest) {
    if (externalDisabled) return
    setSubmitting(true)
    setError(null)
    try {
      const { runId } = await launchClaudboardRun(repoId, inputs)
      setOpenModal(null)
      onRunCreated(runId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const notInstalled = !installed
  const tooltip = externalDisabled
    ? RUN_IN_PROGRESS_TOOLTIP
    : installed === false
    ? (installHint ?? 'claudboard plugin is not installed')
    : undefined
  const isDisabled = externalDisabled || notInstalled

  return (
    <div className="cb-launcher">
      <p className="cb-launcher__title">Claudboard skills</p>
      <div className="cb-launcher__buttons">
        {(['analyse', 'generate', 'workflow'] as const).map((skill) => (
          <button
            key={skill}
            className="cb-launcher__btn"
            disabled={isDisabled}
            title={tooltip}
            onClick={() => {
              if (isDisabled) return
              setOpenModal(skill)
            }}
          >
            {skill.charAt(0).toUpperCase() + skill.slice(1)}
          </button>
        ))}
      </div>
      {!externalDisabled && installed === false && installHint && (
        <p className="cb-launcher__hint">{installHint}</p>
      )}

      {openModal && (
        <div
          className="cb-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setOpenModal(null) }}
        >
          <div className="cb-modal">
            {error && <p className="cb-form__error" style={{ marginBottom: 12 }}>{error}</p>}
            {openModal === 'analyse' && (
              <AnalyseForm
                onSubmit={(inputs) => handleSubmit(inputs)}
                onCancel={() => setOpenModal(null)}
                submitting={submitting}
              />
            )}
            {openModal === 'generate' && (
              <GenerateForm
                onSubmit={(inputs) => handleSubmit(inputs)}
                onCancel={() => setOpenModal(null)}
                submitting={submitting}
              />
            )}
            {openModal === 'workflow' && (
              <WorkflowForm
                onSubmit={(inputs) => handleSubmit(inputs)}
                onCancel={() => setOpenModal(null)}
                submitting={submitting}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
