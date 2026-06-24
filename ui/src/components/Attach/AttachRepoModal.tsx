import './AttachRepoModal.css'
import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'
import Icon from '../primitives/Icon.js'

interface AttachRepoModalProps {
  onPick: (absolutePath: string) => void
  onCancel: () => void
}

type FsEntry = { name: string; path: string; isGitRepo: boolean }

export default function AttachRepoModal({ onPick, onCancel }: AttachRepoModalProps) {
  const [cwd, setCwd] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pastePath, setPastePath] = useState('')

  useEffect(() => {
    navigate(undefined)
  }, [])

  async function navigate(path: string | undefined) {
    setLoading(true)
    setError(null)
    try {
      const result = await api.browseFs(path)
      setCwd(result.path)
      setParent(result.parent)
      setEntries(result.entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse filesystem')
    } finally {
      setLoading(false)
    }
  }

  function handleBreadcrumbClick(segments: string[], index: number) {
    const targetPath = segments.slice(0, index + 1).join('/') || '/'
    navigate(targetPath)
  }

  const breadcrumbSegments = cwd ? cwd.split('/').filter(Boolean) : []

  return (
    <div className="attach__overlay" onClick={onCancel}>
      <div className="attach__modal" onClick={(e) => e.stopPropagation()}>
        {/* Header / Breadcrumb */}
        <div className="attach__header">
          <span className="attach__crumb-sep">/</span>
          {breadcrumbSegments.map((seg, i) => (
            <span key={i} className="attach__crumb-part">
              <button
                className="attach__crumb-btn"
                onClick={() => handleBreadcrumbClick(breadcrumbSegments, i)}
              >
                {seg}
              </button>
              {i < breadcrumbSegments.length - 1 && (
                <span className="attach__crumb-sep">/</span>
              )}
            </span>
          ))}
        </div>

        {/* Error bar */}
        {error && (
          <div className="attach__error-bar">{error}</div>
        )}

        {/* Entry list */}
        <div className="attach__list">
          {loading && (
            <div className="attach__loading">Loading…</div>
          )}

          {!loading && parent !== null && (
            <div
              className="attach__entry"
              onClick={() => navigate(parent)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(parent)}
            >
              <Icon name="folder" size={14} className="attach__entry-icon" />
              <span className="attach__entry-name">..</span>
            </div>
          )}

          {!loading && entries.map((entry) => (
            <div
              key={entry.path}
              className="attach__entry"
              onClick={() => navigate(entry.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(entry.path)}
            >
              <Icon name="folder" size={14} className="attach__entry-icon" />
              <span className="attach__entry-name">{entry.name}</span>
              {entry.isGitRepo && (
                <span className="attach__git-badge" title="Git repository">
                  <Icon name="branch" size={10} />
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="attach__footer">
          <button className="attach__btn-ghost" onClick={onCancel}>
            Cancel
          </button>

          <div className="attach__paste-group">
            <button
              className="attach__btn-ghost"
              onClick={() => setPasteOpen((o) => !o)}
            >
              Paste path {pasteOpen ? '▴' : '▾'}
            </button>
            {pasteOpen && (
              <>
                <input
                  className="attach__paste-input"
                  type="text"
                  placeholder="/absolute/path/to/repo"
                  value={pastePath}
                  onChange={(e) => setPastePath(e.target.value)}
                  autoFocus
                />
                <button
                  className="attach__btn-ghost"
                  disabled={!pastePath.startsWith('/')}
                  onClick={() => {
                    if (pastePath.startsWith('/')) onPick(pastePath)
                  }}
                >
                  Attach
                </button>
              </>
            )}
          </div>

          <div className="attach__spacer" />

          <button
            className="attach__btn-primary"
            onClick={() => onPick(cwd)}
            disabled={!cwd}
          >
            Use this folder
          </button>
        </div>
      </div>
    </div>
  )
}
