import './ImportView.css'
import { useState } from 'react'
import type { Project } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'
import Icon from '../primitives/Icon.js'
import AttachRepoModal from '../Attach/AttachRepoModal.js'

interface ImportViewProps {
  isAddMode: boolean
  onAttach: (project: Project) => void
  onCancel: () => void
}

type Step = 'cards' | 'folder'

export default function ImportView({ isAddMode, onAttach, onCancel }: ImportViewProps) {
  const [step, setStep] = useState<Step>('cards')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const title = isAddMode ? 'Add a project' : 'Get started — point me at a project'

  async function handleFolderPick(path: string) {
    setSubmitting(true)
    setSubmitError('')
    try {
      const project = await api.createProject({ root: path })
      await api.setActiveProject(project.id)
      onAttach(project)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to attach project')
      setSubmitting(false)
    }
  }

  if (step === 'folder') {
    return (
      <div className="import__page">
        <div className="import__topbar">
          <button className="import__back" onClick={() => setStep('cards')}>← Back</button>
          <span className="import__topbar-title">Open local folder</span>
          {isAddMode && <button className="import__cancel" onClick={onCancel}>Cancel</button>}
        </div>
        {submitError && <div className="import__error" style={{ margin: '12px 24px 0' }}>{submitError}</div>}
        {submitting && <div className="import__hint" style={{ margin: '12px 24px 0' }}>Attaching…</div>}
        <div className="import__browser-wrap">
          <AttachRepoModal
            onPick={handleFolderPick}
            onCancel={() => setStep('cards')}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="import__page">
      <div className="import__topbar">
        <span className="import__topbar-title">{title}</span>
        {isAddMode && <button className="import__cancel" onClick={onCancel}>Cancel</button>}
      </div>

      <div className="import__body">
        <h1 className="import__h1">{title}</h1>
        <p className="import__sub">
          {isAddMode
            ? 'Open a local folder to add another project.'
            : 'Point claudboard at a project to start tracking feature runs.'}
        </p>

        <div className="import__cards">
          <div className="import__card" onClick={() => setStep('folder')}>
            <div className="import__card-ico" style={{ background: 'var(--teal-dim)', color: 'var(--teal)' }}>
              <Icon name="folder" size={22} />
            </div>
            <div>
              <div className="import__card-title">Open local folder</div>
              <div className="import__card-desc">Browse and select a directory on your machine</div>
            </div>
            <Icon name="chevR" size={16} className="import__card-chev" />
          </div>
        </div>
      </div>
    </div>
  )
}
