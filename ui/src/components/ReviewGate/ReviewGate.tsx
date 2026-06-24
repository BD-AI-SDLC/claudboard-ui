import './ReviewGate.css'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { GateFileSnapshot, GateFileLiveResponse } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'
import Icon from '../primitives/Icon.js'
import TopBar from '../primitives/TopBar.js'

interface ReviewGateProps {
  runId: string
  gateId: string
  workspaceRoot?: string
  specFiles?: GateFileSnapshot[]
  plan?: GateFileSnapshot | null
  onResolved?: () => void
}

function renderGherkinLine(line: string, idx: number) {
  const trimmed = line.trimStart()

  if (trimmed.startsWith('#')) {
    return <div key={idx} className="gate-step__keyword--comment">{line}</div>
  }

  if (trimmed.startsWith('Feature:')) {
    return <div key={idx} className="gate-step__keyword--feature">{line}</div>
  }

  if (trimmed.startsWith('Scenario:') || trimmed.startsWith('Scenario Outline:')) {
    return <div key={idx} className="gate-step__keyword--scenario">{line}</div>
  }

  for (const kw of ['Given', 'When', 'Then', 'But']) {
    if (trimmed.startsWith(kw + ' ')) {
      const rest = line.slice(line.indexOf(kw) + kw.length)
      const parts = rest.split(/"([^"]+)"/)
      return (
        <div key={idx} style={{ paddingLeft: '16px' }}>
          <span className="gate-step__keyword">{kw}</span>
          {parts.map((p, i) =>
            i % 2 === 1
              ? <span key={i} className="gate-step__string">"{p}"</span>
              : <span key={i}>{p}</span>
          )}
        </div>
      )
    }
  }

  if (trimmed.startsWith('And ') || trimmed.startsWith('And\t')) {
    const rest = line.slice(line.indexOf('And') + 3)
    const parts = rest.split(/"([^"]+)"/)
    return (
      <div key={idx} style={{ paddingLeft: '16px' }}>
        <span className="gate-step__keyword--and">And</span>
        {parts.map((p, i) =>
          i % 2 === 1
            ? <span key={i} className="gate-step__string">"{p}"</span>
            : <span key={i}>{p}</span>
        )}
      </div>
    )
  }

  if (trimmed === '') return <div key={idx} style={{ height: '8px' }} />

  return <div key={idx}>{line}</div>
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

function relativeTo(workspaceRoot: string | undefined, absPath: string): string {
  if (!workspaceRoot) return absPath
  const root = workspaceRoot.endsWith('/') ? workspaceRoot : workspaceRoot + '/'
  return absPath.startsWith(root) ? absPath.slice(root.length) : absPath
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatMtime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - d.getTime()) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

interface PanelMeta {
  snapshot: GateFileSnapshot
  live: GateFileLiveResponse | null
  view: 'snapshot' | 'live'
}

type TabEntry =
  | { kind: 'spec'; index: number; meta: PanelMeta }
  | { kind: 'plan'; meta: PanelMeta }

function activeContent(meta: PanelMeta): { content: string; size: number; mtime: string } {
  if (meta.view === 'live' && meta.live) {
    return { content: meta.live.content, size: meta.live.size, mtime: meta.live.mtime }
  }
  return { content: meta.snapshot.content, size: meta.snapshot.size, mtime: meta.snapshot.mtime }
}

function tabHasDrift(meta: PanelMeta): boolean {
  return meta.live?.drifted === true
}

export default function ReviewGate({
  runId,
  gateId,
  workspaceRoot,
  specFiles,
  plan,
  onResolved,
}: ReviewGateProps) {
  const [showChanges, setShowChanges] = useState(false)
  const [changes, setChanges] = useState('')
  const [resolving, setResolving] = useState(false)
  const [activeTab, setActiveTab] = useState(0)

  const initialSpecMeta: PanelMeta[] = (specFiles ?? []).map((f) => ({
    snapshot: f,
    live: null,
    view: 'snapshot' as const,
  }))
  const initialPlanMeta: PanelMeta | null = plan
    ? { snapshot: plan, live: null, view: 'snapshot' as const }
    : null

  const [specMeta, setSpecMeta] = useState<PanelMeta[]>(initialSpecMeta)
  const [planMeta, setPlanMeta] = useState<PanelMeta | null>(initialPlanMeta)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  // Unified flat tab list: all spec tabs first, then the plan tab
  const tabs: TabEntry[] = [
    ...specMeta.map((meta, index): TabEntry => ({ kind: 'spec', index, meta })),
    ...(planMeta ? [{ kind: 'plan' as const, meta: planMeta }] : []),
  ]

  // Clamp activeTab so an empty-specs gate (plan-only) lands on index 0
  const clampedTab = Math.min(activeTab, Math.max(0, tabs.length - 1))
  const activeEntry = tabs[clampedTab] ?? null

  async function fetchLive(index: string): Promise<GateFileLiveResponse> {
    const res = await fetch(`/api/gates/${gateId}/files/${index}`)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${res.status}: ${text}`)
    }
    return res.json() as Promise<GateFileLiveResponse>
  }

  async function refreshSpec(idx: number) {
    setRefreshing(`spec:${idx}`)
    setRefreshError(null)
    try {
      const live = await fetchLive(String(idx))
      setSpecMeta((prev) => {
        const next = [...prev]
        const cur = next[idx]
        if (cur) next[idx] = { ...cur, live, view: 'live' }
        return next
      })
    } catch (err) {
      setRefreshError((err as Error).message)
    } finally {
      setRefreshing(null)
    }
  }

  async function refreshPlan() {
    if (!planMeta) return
    setRefreshing('plan')
    setRefreshError(null)
    try {
      const live = await fetchLive('plan')
      setPlanMeta({ ...planMeta, live, view: 'live' })
    } catch (err) {
      setRefreshError((err as Error).message)
    } finally {
      setRefreshing(null)
    }
  }

  function toggleSpecView(idx: number) {
    setSpecMeta((prev) => {
      const next = [...prev]
      const cur = next[idx]
      if (cur && cur.live) next[idx] = { ...cur, view: cur.view === 'snapshot' ? 'live' : 'snapshot' }
      return next
    })
  }

  function togglePlanView() {
    if (!planMeta || !planMeta.live) return
    setPlanMeta({ ...planMeta, view: planMeta.view === 'snapshot' ? 'live' : 'snapshot' })
  }

  function handleRefreshActive() {
    if (!activeEntry) return
    if (activeEntry.kind === 'spec') {
      refreshSpec(activeEntry.index)
    } else {
      refreshPlan()
    }
  }

  function handleToggleActiveView() {
    if (!activeEntry) return
    if (activeEntry.kind === 'spec') {
      toggleSpecView(activeEntry.index)
    } else {
      togglePlanView()
    }
  }

  const handleApprove = async () => {
    setResolving(true)
    try {
      await api.resolveGate(runId, gateId, { result: 'approved' })
      onResolved?.()
    } catch (err) {
      console.error(err)
    } finally {
      setResolving(false)
    }
  }

  const handleReject = async () => {
    if (!changes.trim()) return
    setResolving(true)
    try {
      await api.resolveGate(runId, gateId, { result: 'rejected', changes })
      onResolved?.()
    } catch (err) {
      console.error(err)
    } finally {
      setResolving(false)
    }
  }

  const activeFileMeta = activeEntry?.meta ?? null
  const activeFileContent = activeFileMeta ? activeContent(activeFileMeta) : null
  const activeDrifted = activeFileMeta ? tabHasDrift(activeFileMeta) : false

  const isRefreshingActive =
    activeEntry?.kind === 'spec'
      ? refreshing === `spec:${activeEntry.index}`
      : refreshing === 'plan'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        title="Review gate"
        breadcrumb={['runs', runId, 'review']}
      />

      <div className="review-gate__head">
        <div className="review-gate__head-icon">
          <Icon name="flag" size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="review-gate__head-title">Approve to enter autonomous mode</div>
          <div className="review-gate__head-sub">
            After approval, the remaining phases run unattended. This is the only human checkpoint.
          </div>
        </div>
        <div className="review-gate__actions">
          <button
            className="review-gate__btn review-gate__btn--danger"
            onClick={() => setShowChanges((v) => !v)}
            disabled={resolving}
          >
            <Icon name="edit" size={12} />
            Request changes
          </button>
          <button
            className="review-gate__btn review-gate__btn--amber"
            onClick={handleApprove}
            disabled={resolving}
          >
            <Icon name="check" size={12} />
            Approve · start autonomy
          </button>
        </div>
      </div>

      {showChanges && (
        <div className="review-gate__action-row" style={{ borderBottom: '1px solid var(--border)' }}>
          <textarea
            className="review-gate__changes-input"
            rows={4}
            placeholder="Describe the changes you want…"
            value={changes}
            onChange={(e) => setChanges(e.target.value)}
          />
          <div className="review-gate__action-row-buttons">
            <button
              className="review-gate__btn review-gate__btn--danger"
              onClick={handleReject}
              disabled={resolving || !changes.trim()}
            >
              Submit changes
            </button>
            <button
              className="review-gate__btn review-gate__btn--ghost"
              onClick={() => setShowChanges(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Unified tab row: SPECS group | divider | PLAN group */}
      <div className="review-gate__tabs">
        {specMeta.length > 0 && (
          <>
            <span className="review-gate__tab-group-label">SPECS:</span>
            {tabs
              .filter((t): t is Extract<TabEntry, { kind: 'spec' }> => t.kind === 'spec')
              .map((entry) => (
                <button
                  key={entry.meta.snapshot.path}
                  className={`review-gate__tab${clampedTab === entry.index ? ' review-gate__tab--active' : ''}`}
                  onClick={() => setActiveTab(entry.index)}
                >
                  {basename(entry.meta.snapshot.path)}
                  {tabHasDrift(entry.meta) && (
                    <span className="review-gate__tab-drift-dot" aria-hidden="true" />
                  )}
                </button>
              ))}
          </>
        )}

        {specMeta.length > 0 && planMeta && (
          <span className="review-gate__tab-divider" aria-hidden="true" />
        )}

        {planMeta && (
          <>
            <span className="review-gate__tab-group-label">PLAN:</span>
            <button
              key={`plan:${planMeta.snapshot.path}`}
              className={`review-gate__tab${clampedTab === tabs.length - 1 && activeEntry?.kind === 'plan' ? ' review-gate__tab--active' : ''}`}
              onClick={() => setActiveTab(tabs.findIndex((t) => t.kind === 'plan'))}
            >
              {basename(planMeta.snapshot.path)}
              {tabHasDrift(planMeta) && (
                <span className="review-gate__tab-drift-dot" aria-hidden="true" />
              )}
            </button>
          </>
        )}
      </div>

      {/* Single content panel */}
      {activeEntry && activeFileMeta && activeFileContent ? (
        <>
          <div className="review-gate__provenance">
            <span className="review-gate__provenance-path">
              {relativeTo(workspaceRoot, activeFileMeta.snapshot.path)}
            </span>
            <span className="review-gate__provenance-sep">·</span>
            <span>{formatSize(activeFileContent.size)}</span>
            <span className="review-gate__provenance-sep">·</span>
            <span title={activeFileContent.mtime}>{formatMtime(activeFileContent.mtime)}</span>
            <button
              className="review-gate__btn review-gate__btn--ghost review-gate__btn--sm review-gate__provenance-refresh"
              onClick={handleRefreshActive}
              disabled={isRefreshingActive}
            >
              <Icon name="refresh" size={11} />
              {isRefreshingActive ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {activeDrifted && (
            <div className="review-gate__drift">
              <Icon name="alert" size={12} />
              <span>
                {activeFileMeta.view === 'snapshot'
                  ? 'Showing snapshot · click to load current'
                  : 'Showing current · click to load snapshot'}
              </span>
              <button
                className="review-gate__btn review-gate__btn--ghost review-gate__btn--sm"
                onClick={handleToggleActiveView}
              >
                {activeFileMeta.view === 'snapshot' ? 'Load current' : 'Load snapshot'}
              </button>
            </div>
          )}

          {activeEntry.kind === 'spec' ? (
            <div className="review-gate__spec">
              {activeFileContent.content.split('\n').map((line, i) => renderGherkinLine(line, i))}
            </div>
          ) : (
            <div className="review-gate__plan">
              <ReactMarkdown>{activeFileContent.content}</ReactMarkdown>
            </div>
          )}
        </>
      ) : (
        <div className="review-gate__empty">No files in this gate.</div>
      )}

      {refreshError && (
        <div className="review-gate__error">Refresh failed: {refreshError}</div>
      )}
    </div>
  )
}
