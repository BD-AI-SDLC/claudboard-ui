import './DeleteRepoModal.css'
import { useState } from 'react'
import type { Repo as Project } from '@bosch-sdlc/protocol'

interface DeleteRepoModalProps {
  project: Project
  siblingNames: string[]
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteRepoModal({ project, siblingNames, onConfirm, onCancel }: DeleteRepoModalProps) {
  const [confirmText, setConfirmText] = useState('')
  const matches = confirmText === project.name

  return (
    <div className="delete-modal__overlay" onClick={onCancel}>
      <div className="delete-modal__card" onClick={(e) => e.stopPropagation()}>
        <h2 className="delete-modal__title">Delete repository?</h2>

        <div className="delete-modal__body">
          This will remove <strong>{project.name}</strong> and all its tracked data
          from your workspace. The files on disk are not affected.
        </div>

        {siblingNames.length > 0 && (
          <div className="delete-modal__warning">
            This workspace contains {siblingNames.length} other{' '}
            {siblingNames.length === 1 ? 'repository' : 'repositories'}{' '}
            that will also be removed: {siblingNames.join(', ')}.
          </div>
        )}

        <div className="delete-modal__label">
          Type &ldquo;{project.name}&rdquo; to confirm
        </div>
        <input
          className="delete-modal__input"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoFocus
        />

        <div className="delete-modal__actions">
          <button className="delete-modal__btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="delete-modal__btn-delete"
            disabled={!matches}
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
