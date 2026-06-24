import './App.css'
import { useState, useEffect, useCallback } from 'react'
import type {
  Repo,
  Run,
  Project,
  SpecPlanGateEventPayload,
  SpecPlanGateSnapshot,
} from '@bosch-sdlc/protocol'
import { api } from './api/client.js'
import { foundationExists } from './components/Project/setup-utils.js'
import { useTheme } from './hooks/useTheme.js'
import { useBootstrapStatus } from './hooks/useBootstrapStatus.js'
import Sidebar from './components/primitives/Sidebar.js'
import Dashboard from './components/Dashboard/Dashboard.js'
import BootstrapCard from './components/Dashboard/BootstrapCard.js'
import ProjectView from './components/Project/Project.js'
import Kickoff from './components/Kickoff/Kickoff.js'
import ActiveRun from './components/ActiveRun/ActiveRun.js'
import ReviewGate from './components/ReviewGate/ReviewGate.js'
import ImportView from './components/Import/ImportView.js'

type Route = 'dashboard' | 'project' | 'kickoff' | 'run' | 'gate' | 'import'

export default function App() {
  const { theme, setTheme } = useTheme()
  const { status: bootstrapStatus, retry: retryBootstrap } = useBootstrapStatus()
  const bootstrapReady = bootstrapStatus.state === 'ready'
  const [route, setRoute] = useState<Route>('dashboard')
  const [repoId, setRepoId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [prefillRunId, setPrefillRunId] = useState<string | null>(null)
  const [gateId, setGateId] = useState<string | null>(null)
  const [gateKind, setGateKind] = useState<string | null>(null)
  const [, setGateQuestions] = useState<string[]>([])
  const [gateSpecPlan, setGateSpecPlan] = useState<SpecPlanGateEventPayload | null>(null)

  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [isAddMode, setIsAddMode] = useState(false)
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  const [repos, setRepos] = useState<Repo[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [lastVisitedRepoId, setLastVisitedRepoId] = useState<string | null>(null)

  const refreshRepos = useCallback(() => {
    if (!activeProjectId) return
    api.getRepos(activeProjectId).then(setRepos).catch(console.error)
  }, [activeProjectId])

  const refreshRuns = useCallback(() => {
    if (!activeProjectId) return
    api.getRuns(activeProjectId).then(setRuns).catch(console.error)
  }, [activeProjectId])

  // Initial load: fetch projects and determine active project
  useEffect(() => {
    Promise.all([api.getProjects(), api.getActiveProject()])
      .then(([allProjects, activeRes]) => {
        setProjects(allProjects)
        if (activeRes.activeProject) {
          setActiveProjectId(activeRes.activeProjectId)
        } else if (allProjects.length > 0) {
          const sorted = [...allProjects].sort((a, b) =>
            (b.lastActiveAt ?? b.createdAt ?? '').localeCompare(a.lastActiveAt ?? a.createdAt ?? '')
          )
          const pick = sorted[0]!
          api.setActiveProject(pick.id).then(() => {
            setActiveProjectId(pick.id)
          }).catch(console.error)
        } else {
          setRoute('import')
        }
      })
      .catch(console.error)
  }, [])

  // Refetch repos and runs whenever activeProjectId changes
  useEffect(() => {
    if (!activeProjectId) return
    refreshRepos()
    refreshRuns()
    const id = setInterval(refreshRuns, 30_000)
    return () => clearInterval(id)
  }, [activeProjectId, refreshRepos, refreshRuns])

  function goRepo(id: string) {
    setLastVisitedRepoId(id)
    setRepoId(id)
    setRoute('project')
  }

  function goKickoff() {
    setPrefillRunId(null)
    setRoute('kickoff')
  }

  function goRun(id: string) {
    setRunId(id)
    setRoute('run')
  }

  function goKickoffWithPrefill(sourceRunId: string) {
    api.getRun(sourceRunId)
      .then((run) => {
        setRepoId(run.repoId)
        setPrefillRunId(sourceRunId)
        setRoute('kickoff')
      })
      .catch((err) => console.error('Failed to load source run for restart:', err))
  }

  function goGate(
    gId: string,
    kind?: string,
    questions?: string[],
    specPlan?: SpecPlanGateEventPayload | null,
  ) {
    setGateId(gId)
    setGateKind(kind ?? null)
    setGateQuestions(questions ?? [])
    setGateSpecPlan(specPlan ?? null)
    setRoute('gate')
  }

  function goDashboard() {
    setRoute('dashboard')
  }

  async function handleDeleteProject(projectId: string) {
    try {
      await api.deleteProject(projectId)
      refreshRepos()
      setRoute('dashboard')
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  }

  function startFeature() {
    const lastVisited = repos.find(r => r.id === lastVisitedRepoId)
    const target =
      (lastVisited && foundationExists(lastVisited.prereqs) ? lastVisited : null) ??
      repos.find(r => foundationExists(r.prereqs))
    if (!target) return
    setRepoId(target.id)
    setRoute('kickoff')
  }

  function handleSwitchProject(id: string) {
    api.setActiveProject(id).then(res => {
      setActiveProjectId(res.activeProjectId)
      api.getProjects().then(setProjects).catch(console.error)
      setRoute('dashboard')
    }).catch(console.error)
  }

  function handleAddProject() {
    setIsAddMode(true)
    setRoute('import')
  }

  function handleAttachProject(project: Project) {
    setProjects(prev => {
      const existing = prev.find(p => p.id === project.id)
      return existing ? prev.map(p => p.id === project.id ? project : p) : [...prev, project]
    })
    setActiveProjectId(project.id)
    setRoute('dashboard')
    setIsAddMode(false)
  }

  function renderMain() {
    if (route === 'import') {
      return <ImportView isAddMode={isAddMode} onAttach={handleAttachProject} onCancel={() => setRoute('dashboard')} />
    }
    if (route === 'project' && repoId) {
      return <ProjectView projectId={repoId} projects={repos} onStartFeature={goKickoff} onDeleteProject={handleDeleteProject} onRunCreated={goRun} bootstrapReady={bootstrapReady} />
    }
    if (route === 'kickoff' && repoId) {
      return <Kickoff projectId={repoId} prefillRunId={prefillRunId} onRunCreated={goRun} onBackToProject={goRepo} />
    }
    if (route === 'run' && runId) {
      return <ActiveRun runId={runId} onReviewGate={goGate} onRestart={goKickoffWithPrefill} />
    }
    if (route === 'gate' && runId && gateId) {
      if (gateKind === 'clarify') {
        return <ActiveRun runId={runId} onReviewGate={goGate} onRestart={goKickoffWithPrefill} />
      }
      const snapshot: SpecPlanGateSnapshot | null = gateSpecPlan?.snapshot ?? null
      return (
        <ReviewGate
          runId={runId}
          gateId={gateId}
          workspaceRoot={gateSpecPlan?.workspaceRoot}
          specFiles={snapshot?.specFiles}
          plan={snapshot?.plan ?? null}
          onResolved={() => goRun(runId)}
        />
      )
    }
    const anyRepoReady = repos.some((r) => foundationExists(r.prereqs))
    return (
      <Dashboard
        repos={repos}
        runs={runs}
        refreshRepos={refreshRepos}
        onRepoClick={goRepo}
        onStartFeature={repos.length > 0 ? startFeature : undefined}
        startFeatureDisabled={repos.length > 0 && !anyRepoReady}
        onOpenRun={goRun}
        activeProject={activeProject}
      />
    )
  }

  return (
    <div className="app__root">
      <Sidebar
        activeRoute={route}
        repos={repos}
        runs={runs}
        lastVisitedRepoId={lastVisitedRepoId}
        theme={theme}
        setTheme={setTheme}
        onNavigateDashboard={goDashboard}
        onNavigateRepo={goRepo}
        onStartFeature={startFeature}
        onNavigateRun={goRun}
        onNavigateGate={(rId, gId, kind, questions, specPlan) => {
          if (kind === 'clarify') {
            goRun(rId)
          } else {
            setRunId(rId)
            setGateId(gId)
            setGateKind(kind ?? null)
            setGateQuestions(questions ?? [])
            setGateSpecPlan(specPlan ?? null)
            setRoute('gate')
          }
        }}
        activeProject={activeProject}
        projects={projects}
        onSwitchProject={handleSwitchProject}
        onAddProject={handleAddProject}
      />
      <main className="app__main">
        <BootstrapCard status={bootstrapStatus} onRetry={retryBootstrap} />
        {renderMain()}
      </main>
    </div>
  )
}
