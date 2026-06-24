import './Project.css'
import './Setup.css'
import { useEffect, useRef, useState } from 'react'
import type { Repo as RepoType, PrereqRecord, ClaudboardLaunchRequest } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'
import { launchClaudboardRun } from '../../api/claudboard.js'
import StatusChip from '../primitives/StatusChip.js'
import Spark from '../primitives/Spark.js'
import TopBar from '../primitives/TopBar.js'
import SetupBanner from './SetupBanner.js'
import FoundationChain from './FoundationChain.js'
import ClaudboardLauncher from '../claudboard/ClaudboardLauncher.js'
import AnalyseForm from '../claudboard/AnalyseForm.js'
import GenerateForm from '../claudboard/GenerateForm.js'
import WorkflowForm from '../claudboard/WorkflowForm.js'
import MaintenanceGrid from './MaintenanceGrid.js'
import DeleteRepoModal from './DeleteRepoModal.js'
import PrereqInterview from '../PrereqInterview/PrereqInterview.js'
import {
  foundationDone,
  FOUNDATION_OPS,
  MAINTENANCE_OPS,
} from './setup-utils.js'
import { useActiveRuns } from '../../hooks/useActiveRuns.js'
import { runKindLabel } from '../../util/runKindLabel.js'

export const RUN_IN_PROGRESS_TOOLTIP = 'A run is in progress — only one at a time'

const CLAUDBOARD_CMDS = new Set(['analyse', 'generate', 'workflow'])
const RUN_POLL_INTERVAL_MS = 2000
const ALL_PREREQ_IDS = [
  ...FOUNDATION_OPS.map(op => op.id),
  ...MAINTENANCE_OPS.map(op => op.id),
]

interface ProjectProps {
  projectId: string
  projects?: RepoType[]
  onStartFeature?: () => void
  onDeleteProject?: (projectId: string) => void
  onRunCreated?: (runId: string) => void
  bootstrapReady?: boolean
}

export default function Project({ projectId, projects = [], onStartFeature, onDeleteProject, onRunCreated, bootstrapReady = true }: ProjectProps) {
  const [project, setProject] = useState<RepoType | null>(null)
  const [prereqs, setPrereqs] = useState<Record<string, PrereqRecord>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [runErrors, setRunErrors] = useState<Record<string, string>>({})
  const [activeRun, setActiveRun] = useState<{ id: string; cmd: string } | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [prereqModal, setPrereqModal] = useState<'analyse' | 'generate' | 'workflow' | null>(null)
  const [prereqModalSubmitting, setPrereqModalSubmitting] = useState(false)
  const [prereqModalError, setPrereqModalError] = useState<string | null>(null)
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  const { hasActive, primary } = useActiveRuns(projectId)
  const prevHasActive = useRef(false)

  useEffect(() => {
    api.getRepo(projectId).then(setProject).catch(console.error)
    api.getRepoPrereqs(projectId).then((p) => setPrereqs(p ?? {})).catch(console.error)
  }, [projectId])

  // Stop any polling when the component unmounts or the project changes
  useEffect(() => {
    return () => {
      for (const t of pollTimers.current.values()) clearInterval(t)
      pollTimers.current.clear()
    }
  }, [projectId])

  // When an active run completes, re-fetch prereqs to reflect any state changes
  useEffect(() => {
    if (prevHasActive.current && !hasActive) {
      api.getRepoPrereqs(projectId).then((updated) => setPrereqs(updated ?? {})).catch(console.error)
    }
    prevHasActive.current = hasActive
  }, [hasActive, projectId])

  const handleClaudboardPrereq = async (inputs: ClaudboardLaunchRequest) => {
    if (!project || !onRunCreated || hasActive) return
    setPrereqModalSubmitting(true)
    setPrereqModalError(null)
    try {
      const { runId } = await launchClaudboardRun(projectId, inputs)
      setPrereqModal(null)
      onRunCreated(runId)
    } catch (err) {
      setPrereqModalError(err instanceof Error ? err.message : String(err))
    } finally {
      setPrereqModalSubmitting(false)
    }
  }

  const handleRunPrereq = async (cmd: string) => {
    if (!project || hasActive) return
    if (CLAUDBOARD_CMDS.has(cmd) && onRunCreated) {
      setPrereqModal(cmd as 'analyse' | 'generate' | 'workflow')
      return
    }
    setRunning((prev) => ({ ...prev, [cmd]: true }))
    setRunErrors((prev) => {
      const { [cmd]: _drop, ...rest } = prev
      void _drop
      return rest
    })

    let runId: string | null = null
    try {
      const run = await api.runPrereq(cmd, { target: project.path })
      runId = run.id
      setActiveRun({ id: run.id, cmd })
    } catch (err) {
      console.error(err)
      setRunning((prev) => ({ ...prev, [cmd]: false }))
      setRunErrors((prev) => ({
        ...prev,
        [cmd]: err instanceof Error ? err.message : 'Failed to start run',
      }))
      return
    }

    // The 201 only means "run record created"; the actual CLI subprocess takes
    // 60–180s. Poll the run status until done/failed so the OperationCard keeps
    // showing "Running…" the entire time, then refresh prereq state.
    const id = runId
    const timer = setInterval(async () => {
      try {
        const run = await api.getRun(id)
        if (run.status === 'running') return

        clearInterval(timer)
        pollTimers.current.delete(cmd)

        if (run.status === 'failed') {
          setRunErrors((prev) => ({
            ...prev,
            [cmd]: run.errorMessage ?? 'Run failed with no error message recorded.',
          }))
        }

        try {
          const updated = await api.getRepoPrereqs(projectId)
          setPrereqs(updated ?? {})
        } catch (err) {
          console.error(err)
        }
        setRunning((prev) => ({ ...prev, [cmd]: false }))
        // Run is over — unmount the inline interview section.
        setActiveRun((cur) => (cur?.id === id ? null : cur))
      } catch (err) {
        // Transient fetch error — keep polling; if it persists the user can
        // navigate away to break out.
        console.error(err)
      }
    }, RUN_POLL_INTERVAL_MS)
    pollTimers.current.set(cmd, timer)
  }

  if (!project) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <TopBar title="Project" breadcrumb={[projectId]} />
        <div className="project__loading">Loading project…</div>
      </div>
    )
  }

  const mark = project.name.slice(0, 2).toUpperCase()
  const fdnDone = foundationDone(prereqs)
  const siblingNames = projects
    .filter(p => p.projectId === project.projectId && p.id !== project.id)
    .map(p => p.name)

  const forcedDisabledRunning = hasActive
    ? Object.fromEntries(ALL_PREREQ_IDS.map(id => [id, true]))
    : running

  const topBarStartFeatureDisabled = !fdnDone || hasActive

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        title={project.name}
        breadcrumb={['project', project.name]}
        onStartFeature={onStartFeature}
        startFeatureDisabled={topBarStartFeatureDisabled}
      />

      {deleteModalOpen && (
        <DeleteRepoModal
          project={project}
          siblingNames={siblingNames}
          onConfirm={() => onDeleteProject?.(project.projectId)}
          onCancel={() => setDeleteModalOpen(false)}
        />
      )}

      <div className="project__page">
        {/* project header */}
        <div className="project__head">
          <div className="project__head-mark">{mark}</div>
          <div className="project__head-info">
            <div className="project__head-name">{project.name}</div>
            <div className="project__head-path">{project.path}</div>
            <div className="project__head-chips">
              <span className="project__head-badge">{project.topology}</span>
              {project.path && (
                <span className="project__head-badge" style={{ fontFamily: 'var(--font-mono)' }}>
                  {project.path}
                </span>
              )}
            </div>
          </div>
          <div className="project__head-status">
            <StatusChip status="idle" />
            {onDeleteProject && (
              <button
                className="project__btn-delete"
                onClick={() => setDeleteModalOpen(true)}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {hasActive && primary && onRunCreated && (
          <div
            className="project__active-run-banner"
            role="button"
            tabIndex={0}
            onClick={() => onRunCreated(primary.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onRunCreated(primary.id)
              }
            }}
          >
            {runKindLabel(primary.kind)} running — open run
          </div>
        )}

        {/* metrics */}
        <div className="project__metric-grid">
          <div className="project__metric">
            <div className="project__metric-label">Onboarding readiness</div>
            <div className="project__metric-value">
              {Object.keys(prereqs).length > 0
                ? Math.round((Object.values(prereqs).filter((p) => (p as PrereqRecord).state === 'done').length / Object.values(prereqs).length) * 100)
                : 0}
              <span style={{ fontSize: '14px', color: 'var(--muted)' }}>%</span>
            </div>
          </div>
          <div className="project__metric">
            <div className="project__metric-label">Generated artifacts</div>
            <div className="project__metric-value">—</div>
          </div>
          <div className="project__metric">
            <div className="project__metric-label">Features shipped via /start-feature</div>
            <div className="project__metric-value">—</div>
            <div className="project__metric-sub">
              <Spark data={[0.3, 0.5, 0.4, 0.7, 0.6, 0.8, 0.5]} />
            </div>
          </div>
          <div className="project__metric">
            <div className="project__metric-label">Avg run · cost</div>
            <div className="project__metric-value">—</div>
          </div>
        </div>

        {Object.entries(runErrors).map(([cmd, msg]) => (
          <div key={cmd} className="project__run-error" role="alert">
            <div className="project__run-error-head">
              <strong>{cmd} failed</strong>
              <button
                type="button"
                className="project__run-error-close"
                aria-label="Dismiss"
                onClick={() =>
                  setRunErrors((prev) => {
                    const { [cmd]: _drop, ...rest } = prev
                    void _drop
                    return rest
                  })
                }
              >
                ×
              </button>
            </div>
            <div className="project__run-error-body">{msg}</div>
          </div>
        ))}

        {!fdnDone && (
          <>
            <SetupBanner
              prereqs={prereqs}
              running={forcedDisabledRunning}
              onRunNext={handleRunPrereq}
              bootstrapReady={bootstrapReady}
              runningTooltip={hasActive ? RUN_IN_PROGRESS_TOOLTIP : undefined}
            />
            <FoundationChain
              prereqs={prereqs}
              running={forcedDisabledRunning}
              onRun={handleRunPrereq}
              bootstrapReady={bootstrapReady}
              runningTooltip={hasActive ? RUN_IN_PROGRESS_TOOLTIP : undefined}
            />
            {activeRun && <PrereqInterview runId={activeRun.id} cmd={activeRun.cmd} />}
            <MaintenanceGrid
              prereqs={prereqs}
              running={forcedDisabledRunning}
              onRun={handleRunPrereq}
              bootstrapReady={bootstrapReady}
              runningTooltip={hasActive ? RUN_IN_PROGRESS_TOOLTIP : undefined}
            />
          </>
        )}
        {fdnDone && (
          <>
            <MaintenanceGrid
              prereqs={prereqs}
              running={forcedDisabledRunning}
              onRun={handleRunPrereq}
              bootstrapReady={bootstrapReady}
              runningTooltip={hasActive ? RUN_IN_PROGRESS_TOOLTIP : undefined}
            />
            {activeRun && <PrereqInterview runId={activeRun.id} cmd={activeRun.cmd} />}
            <FoundationChain
              prereqs={prereqs}
              running={forcedDisabledRunning}
              onRun={handleRunPrereq}
              bootstrapReady={bootstrapReady}
              runningTooltip={hasActive ? RUN_IN_PROGRESS_TOOLTIP : undefined}
            />
            {onRunCreated && (
              <ClaudboardLauncher repoId={projectId} onRunCreated={onRunCreated} disabled={hasActive} />
            )}
          </>
        )}
      </div>

      {prereqModal && (
        <div
          className="cb-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget && !prereqModalSubmitting) setPrereqModal(null) }}
        >
          <div className="cb-modal">
            {prereqModalError && (
              <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{prereqModalError}</p>
            )}
            {prereqModal === 'analyse' && (
              <AnalyseForm
                onSubmit={(inputs) => handleClaudboardPrereq(inputs)}
                onCancel={() => { setPrereqModal(null); setPrereqModalError(null) }}
                submitting={prereqModalSubmitting}
              />
            )}
            {prereqModal === 'generate' && (
              <GenerateForm
                onSubmit={(inputs) => handleClaudboardPrereq(inputs)}
                onCancel={() => { setPrereqModal(null); setPrereqModalError(null) }}
                submitting={prereqModalSubmitting}
              />
            )}
            {prereqModal === 'workflow' && (
              <WorkflowForm
                onSubmit={(inputs) => handleClaudboardPrereq(inputs)}
                onCancel={() => { setPrereqModal(null); setPrereqModalError(null) }}
                submitting={prereqModalSubmitting}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
